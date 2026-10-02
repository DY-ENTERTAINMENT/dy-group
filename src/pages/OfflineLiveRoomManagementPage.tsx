import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Ban, CalendarDays, Clock3, Edit3, Plus, Power, RefreshCw, Search, UserPlus, X } from 'lucide-react';
import { SystemModal } from '../components/SystemModal';
import { usePermissions } from '../hooks/usePermissions';
import tiktokLogoUrl from '../assets/icons/tiktok-logo.png';
import douyinLogoUrl from '../assets/icons/douyin-logo.png';
import {
  formatOfflineLiveRoomRevenue,
  getOfflineLiveRoomRevenueUnit,
  offlineLiveRoomService,
  platformLabels,
  type OfflineLiveRoom,
  type OfflineLiveRoomCreatorEntity,
  type OfflineLiveRoomCreatorSearchResult,
  type OfflineLiveRoomCreatorSummary,
  type OfflineLiveRoomDashboard,
  type OfflineLiveRoomDashboardRoom,
  type OfflineLiveRoomFormInput,
  type OfflineLiveSession,
  type OfflineLiveCreatorSchedule,
  type OfflineLiveCreatorScheduleSlot,
  type OfflineLiveRoomPeriodRange,
  type OfflineLiveRoomUpdateStatus,
} from '../services/offline-live-room.service';
import type { RevenuePeriodSetting } from '../services/agent.service';
import type { Region } from '../types/database';

type QuickRange = 'week' | 'month' | 'custom';

type DateRange = {
  startIso: string;
  endIso: string;
};

type RoomFormValues = {
  regionId: string;
  roomNumber: string;
  name: string;
  sortOrder: string;
};

const emptyDashboard: OfflineLiveRoomDashboard = {
  rooms: [],
  tiktokTotal: 0,
  douyinTotal: 0,
  updatedRoomCount: 0,
  pendingRoomCount: 0,
  creatorCount: 0,
  revenueError: null,
};

const statusLabels: Record<OfflineLiveRoomUpdateStatus, string> = {
  updated: '已更新',
  partial: '部分未更新',
  pending: '待更新',
  unconfigured: '未配置主播',
};

const quickRangeOptions: { value: QuickRange; label: string }[] = [
  { value: 'week', label: '本周' },
  { value: 'month', label: '本月' },
  { value: 'custom', label: '自定义' },
];

export function OfflineLiveRoomManagementPage() {
  const permissions = usePermissions();
  const canUse = permissions.canUse('management-offline-live-rooms');
  const canViewRevenue = permissions.canView('management-offline-live-room-revenue');
  const canViewDuration = permissions.canView('management-offline-live-room-live-duration');
  const canUseDuration = permissions.canUse('management-offline-live-room-live-duration');
  const todayIso = useMemo(() => formatMalaysiaDate(new Date()), []);
  const currentMonth = todayIso.slice(0, 7);
  const [regions, setRegions] = useState<Region[]>([]);
  const [regionId, setRegionId] = useState('');
  const [quickRange, setQuickRange] = useState<QuickRange>('month');
  const [customStart, setCustomStart] = useState(todayIso);
  const [customEnd, setCustomEnd] = useState(todayIso);
  const [periodsByMonth, setPeriodsByMonth] = useState<Record<string, OfflineLiveRoomPeriodRange[]>>({});
  const [dashboard, setDashboard] = useState<OfflineLiveRoomDashboard>(emptyDashboard);
  const [loading, setLoading] = useState(true);
  const [periodLoading, setPeriodLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [roomModal, setRoomModal] = useState<{ mode: 'create' | 'edit'; room: OfflineLiveRoom | null } | null>(null);
  const [roomSaving, setRoomSaving] = useState(false);
  const [roomSubmitError, setRoomSubmitError] = useState('');
  const [inactiveRoomsModalOpen, setInactiveRoomsModalOpen] = useState(false);
  const [inactiveRooms, setInactiveRooms] = useState<OfflineLiveRoom[]>([]);
  const [inactiveRoomsLoading, setInactiveRoomsLoading] = useState(false);
  const [inactiveRoomsError, setInactiveRoomsError] = useState('');
  const [restoreConfirmation, setRestoreConfirmation] = useState<{ room: OfflineLiveRoom; closeRoomModal: boolean } | null>(null);
  const inactiveRoomsRequestIdRef = useRef(0);
  const [assignmentRoom, setAssignmentRoom] = useState<OfflineLiveRoomDashboardRoom | null>(null);
  const [showRevenue, setShowRevenue] = useState(true);
  const [showDuration, setShowDuration] = useState(true);
  const [sessions, setSessions] = useState<OfflineLiveSession[]>([]);
  const [schedules, setSchedules] = useState<OfflineLiveCreatorSchedule[]>([]);
  const [durationError, setDurationError] = useState('');
  const [sessionModal, setSessionModal] = useState<{ room: OfflineLiveRoom; creator: OfflineLiveRoomCreatorSummary; session?: OfflineLiveSession } | null>(null);
  const [voidSession, setVoidSession] = useState<OfflineLiveSession | null>(null);
  const [scheduleCreator, setScheduleCreator] = useState<OfflineLiveRoomCreatorSummary | null>(null);

  const selectedRange = useMemo(() => getSelectedDateRange(quickRange, todayIso, customStart, customEnd), [customEnd, customStart, quickRange, todayIso]);
  const monthsToLoad = useMemo(() => getMonthsForDateRange(selectedRange), [selectedRange]);
  const selectedPeriods = useMemo(() => getRevenuePeriodsForDateRange(selectedRange, periodsByMonth), [periodsByMonth, selectedRange]);
  const currentPeriod = useMemo(() => findRevenuePeriodForDate(periodsByMonth[currentMonth] ?? [], todayIso), [currentMonth, periodsByMonth, todayIso]);
  const visiblePeriods = useMemo(
    () => (quickRange === 'week' && currentPeriod ? [currentPeriod] : selectedPeriods),
    [currentPeriod, quickRange, selectedPeriods],
  );
  const statusPeriods = useMemo(() => visiblePeriods.filter((period) => period.startIso <= todayIso), [todayIso, visiblePeriods]);
  const sessionRange = useMemo(() => getSessionDateRange(quickRange, todayIso, customStart, customEnd), [customEnd, customStart, quickRange, todayIso]);

  const loadDashboard = useCallback(async () => {
    if (!regionId || (canViewRevenue && visiblePeriods.length === 0)) return;
    setLoading(true);
    setError('');
    try {
      const nextDashboard = await offlineLiveRoomService.listRoomDashboard({ regionId, periods: visiblePeriods, statusPeriods, includeRevenue: canViewRevenue });
      setDashboard(nextDashboard);
      setDurationError('');
      if (canViewDuration) {
        const [nextSessions, nextSchedules] = await Promise.all([
          offlineLiveRoomService.listLiveSessions({ regionId, startDate: sessionRange.startIso, endDate: sessionRange.endIso }),
          offlineLiveRoomService.listCreatorSchedules(regionId),
        ]);
        setSessions(nextSessions);
        setSchedules(nextSchedules);
      } else {
        setSessions([]);
        setSchedules([]);
      }
    } catch (loadError) {
      if (canViewDuration && isRpcUnavailable(loadError)) {
        setSessions([]);
        setSchedules([]);
        setDurationError('直播时长服务尚未部署或暂不可用；现有直播间功能不受影响。');
      } else {
        setError(`读取线下直播间失败：${getErrorMessage(loadError)}`);
      }
    } finally {
      setLoading(false);
    }
  }, [canViewDuration, canViewRevenue, regionId, sessionRange.endIso, sessionRange.startIso, statusPeriods, visiblePeriods]);

  useEffect(() => {
    let active = true;
    offlineLiveRoomService.listRegions()
      .then((items) => {
        if (!active) return;
        setRegions(items);
        setRegionId((current) => current || items[0]?.id || '');
      })
      .catch((loadError) => {
        if (active) setError(`读取区域失败：${getErrorMessage(loadError)}`);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const missingMonths = monthsToLoad.filter((month) => !periodsByMonth[month]);
    if (missingMonths.length === 0) return;

    setPeriodLoading(true);
    setError('');
    Promise.all(missingMonths.map((month) => offlineLiveRoomService.listPeriodSettings(month).then((items) => [month, mapRevenuePeriodSettingsToRanges(items)] as const)))
      .then((entries) => {
        if (active) setPeriodsByMonth((current) => ({ ...current, ...Object.fromEntries(entries) }));
      })
      .catch((loadError) => {
        if (active) setError(`读取流水周期失败：${getErrorMessage(loadError)}`);
      })
      .finally(() => {
        if (active) setPeriodLoading(false);
      });

    return () => {
      active = false;
    };
  }, [monthsToLoad, periodsByMonth]);

  useEffect(() => {
    if (!regionId || (canViewRevenue && visiblePeriods.length === 0)) return;
    void loadDashboard();
  }, [canViewRevenue, loadDashboard, regionId, visiblePeriods.length]);

  async function saveRoom(values: RoomFormValues) {
    const payload = normalizeRoomForm(values);
    setRoomSubmitError('');
    setRoomSaving(true);
    try {
      if (roomModal?.mode === 'edit' && roomModal.room) {
        await offlineLiveRoomService.updateRoom(roomModal.room.id, payload);
        setMessage('直播间已更新。');
        setRoomSubmitError('');
        setRoomModal(null);
        await loadDashboard();
        return;
      }

      const existingRoom = await offlineLiveRoomService.findRoomByRegionAndNumber(payload.regionId, payload.roomNumber);
      if (existingRoom?.status === 'active') {
        setRoomSubmitError(`该区域的 ${payload.roomNumber}号直播间已存在。`);
        return;
      }
      if (existingRoom?.status === 'inactive') {
        setRestoreConfirmation({ room: existingRoom, closeRoomModal: true });
        return;
      }

      await offlineLiveRoomService.createRoom(payload);
      setMessage('直播间已添加。');
      setRoomSubmitError('');
      setRoomModal(null);
      await loadDashboard();
    } catch (saveError) {
      setRoomSubmitError(isDuplicateRoomError(saveError)
        ? `该区域的 ${payload.roomNumber}号直播间已存在，请刷新后重试。`
        : `保存直播间失败：${getErrorMessage(saveError)}`);
    } finally {
      setRoomSaving(false);
    }
  }

  async function deactivateRoom(room: OfflineLiveRoom) {
    await offlineLiveRoomService.deactivateRoom(room.id);
    setMessage('直播间已停用。');
    await loadDashboard();
  }

  async function loadInactiveRooms() {
    const requestedRegionId = regionId;
    if (!requestedRegionId) return;
    const requestId = ++inactiveRoomsRequestIdRef.current;
    setInactiveRoomsLoading(true);
    setInactiveRoomsError('');
    try {
      const rooms = await offlineLiveRoomService.listRooms({ includeInactive: true, regionId: requestedRegionId });
      if (requestId !== inactiveRoomsRequestIdRef.current) return;
      setInactiveRooms(rooms.filter((room) => room.status === 'inactive'));
    } catch (loadError) {
      if (requestId !== inactiveRoomsRequestIdRef.current) return;
      setInactiveRoomsError(`读取已停用直播间失败：${getErrorMessage(loadError)}`);
    } finally {
      if (requestId !== inactiveRoomsRequestIdRef.current) return;
      setInactiveRoomsLoading(false);
    }
  }

  function openInactiveRooms() {
    setInactiveRoomsModalOpen(true);
    void loadInactiveRooms();
  }

  function closeInactiveRooms() {
    inactiveRoomsRequestIdRef.current += 1;
    setInactiveRoomsModalOpen(false);
    setInactiveRooms([]);
    setInactiveRoomsError('');
  }

  async function confirmRestoreRoom() {
    if (!restoreConfirmation) return;
    if (restoreConfirmation.closeRoomModal) setRoomSubmitError('');
    setInactiveRoomsError('');
    setRoomSaving(true);
    try {
      await offlineLiveRoomService.restoreRoom(restoreConfirmation.room.id);
      setRestoreConfirmation(null);
      if (restoreConfirmation.closeRoomModal) setRoomModal(null);
      setMessage('直播间已恢复启用。');
      setRoomSubmitError('');
      await Promise.all([loadDashboard(), inactiveRoomsModalOpen ? loadInactiveRooms() : Promise.resolve()]);
    } catch (restoreError) {
      const message = `恢复直播间失败：${getErrorMessage(restoreError)}`;
      if (restoreConfirmation.closeRoomModal) setRoomSubmitError(message);
      else setInactiveRoomsError(message);
    } finally {
      setRoomSaving(false);
    }
  }

  async function assignCreator(roomId: string, creatorEntityId: string) {
    setError('');
    try {
      await offlineLiveRoomService.assignCreatorToRoom(roomId, creatorEntityId);
      setMessage('常驻主播已添加。');
      await loadDashboard();
    } catch (assignError) {
      setError(getErrorMessage(assignError));
    }
  }

  async function removeAssignment(assignmentId: string) {
    await offlineLiveRoomService.deactivateCreatorAssignment(assignmentId);
    setMessage('常驻主播关系已停用。');
    await loadDashboard();
  }

  const activeRegion = regions.find((region) => region.id === regionId) ?? null;
  const busy = loading || periodLoading;

  return (
    <div className="offline-live-room-page">
      {message ? <p className="form-success offline-live-room-alert">{message}</p> : null}
      {error ? <p className="form-alert offline-live-room-alert">{error}</p> : null}
      {durationError ? <p className="form-alert offline-live-room-alert">{durationError}</p> : null}

      <section className="offline-live-room-filterbar">
        <div className="offline-live-room-segmented" role="group" aria-label="时间范围">
          {quickRangeOptions.map((option) => (
            <button key={option.value} className={quickRange === option.value ? 'active' : ''} type="button" onClick={() => setQuickRange(option.value)}>
              {option.label}
            </button>
          ))}
        </div>
        <label className="form-field">
          <span>区域</span>
          <select value={regionId} onChange={(event) => setRegionId(event.target.value)}>
            {regions.map((region) => <option key={region.id} value={region.id}>{region.code || region.name}</option>)}
          </select>
        </label>
        <div className="offline-live-room-period-context">
          <span>当前周期</span>
          <strong>{activeRegion ? formatDateRangeText(visiblePeriods[0]?.startIso ?? selectedRange.startIso, visiblePeriods[visiblePeriods.length - 1]?.endIso ?? selectedRange.endIso) : '读取中'}</strong>
        </div>
        {quickRange === 'custom' ? (
          <>
            <label className="form-field">
              <span>开始日期</span>
              <input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} />
            </label>
            <label className="form-field">
              <span>结束日期</span>
              <input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} />
            </label>
          </>
        ) : null}
        <div className="offline-live-room-filter-actions">
          <button className="secondary-button compact-button" type="button" onClick={loadDashboard} disabled={busy || !regionId}>
            <RefreshCw size={16} /> 刷新
          </button>
          <button className="secondary-button compact-button" type="button" onClick={openInactiveRooms} disabled={!regionId} style={{ whiteSpace: 'nowrap' }}>
            已停用直播间
          </button>
          <button className="primary-button compact-button" type="button" onClick={() => { setRoomSubmitError(''); setRoomModal({ mode: 'create', room: null }); }} disabled={!canUse || !regionId}>
            <Plus size={16} /> 添加直播间
          </button>
        </div>
        {(canViewRevenue || canViewDuration) ? <div className="offline-live-room-content-toggle" role="group" aria-label="显示内容">
          <span>显示内容</span>
          {canViewRevenue ? <label><input type="checkbox" checked={showRevenue} onChange={(event) => setShowRevenue(event.target.checked)} /> 流水</label> : null}
          {canViewDuration ? <label><input type="checkbox" checked={showDuration} onChange={(event) => setShowDuration(event.target.checked)} /> 直播时长</label> : null}
        </div> : null}
      </section>

      {canViewRevenue && showRevenue ? <section className="offline-live-room-kpis">
        <KpiCard label="当前周期流水" value={<RevenuePair tiktok={dashboard.tiktokTotal} douyin={dashboard.douyinTotal} />} />
        <KpiCard label="已更新直播间" value={dashboard.updatedRoomCount} detail="全部主播平台已填写" tone="updated" />
        <KpiCard label="待更新直播间" value={dashboard.pendingRoomCount} detail="含未配置主播房间" tone="pending" />
        <KpiCard label="当前周期主播人数" value={dashboard.creatorCount} detail="按主播本人去重" />
      </section>
      : null}
      {canViewRevenue && showRevenue && dashboard.revenueError ? <p className="form-alert offline-live-room-alert">安全流水服务暂不可用：{dashboard.revenueError}</p> : null}

      <section className="offline-live-room-grid" aria-busy={busy}>
        {busy ? <div className="offline-live-room-state">正在读取直播间...</div> : null}
        {!busy && dashboard.rooms.length === 0 ? <div className="offline-live-room-state">暂无线下直播间</div> : null}
        {!busy ? dashboard.rooms.map((room) => (
          <RoomCard
            key={room.room.id}
            item={room}
            canUse={canUse}
            showRevenue={canViewRevenue && showRevenue && !dashboard.revenueError}
            showDuration={canViewDuration && showDuration}
            canUseDuration={canUseDuration}
            sessions={sessions.filter((session) => session.room_id === room.room.id)}
            schedules={schedules}
            todayIso={todayIso}
            periodRange={sessionRange}
            onEdit={() => { setRoomSubmitError(''); setRoomModal({ mode: 'edit', room: room.room }); }}
            onDeactivate={() => void deactivateRoom(room.room)}
            onManageCreators={() => setAssignmentRoom(room)}
            onSession={(targetRoom, creator, session) => setSessionModal({ room: targetRoom, creator, session })}
            onVoid={(session) => setVoidSession(session)}
            onSchedule={(creator) => setScheduleCreator(creator)}
          />
        )) : null}
      </section>

      {roomModal ? (
        <RoomModal
          regions={regions}
          room={roomModal.room}
          defaultRegionId={regionId}
          saving={roomSaving}
          submitError={roomSubmitError}
          onClose={() => { if (!roomSaving) { setRoomSubmitError(''); setRoomModal(null); } }}
          onSubmit={(values) => void saveRoom(values)}
        />
      ) : null}

      {inactiveRoomsModalOpen ? (
        <InactiveRoomsModal
          rooms={inactiveRooms}
          loading={inactiveRoomsLoading}
          error={inactiveRoomsError}
          canUse={canUse}
          saving={roomSaving}
          onClose={() => { if (!roomSaving) closeInactiveRooms(); }}
          onRestore={(room) => setRestoreConfirmation({ room, closeRoomModal: false })}
        />
      ) : null}

      {restoreConfirmation ? (
        <SystemModal
          title={`确认恢复 ${restoreConfirmation.room.room_number}号直播间？`}
          ariaLabel="确认恢复直播间"
          onClose={() => { if (!roomSaving) setRestoreConfirmation(null); }}
          footer={<><button className="secondary-button compact-button" type="button" onClick={() => setRestoreConfirmation(null)} disabled={roomSaving}>取消</button><button className="primary-button compact-button" type="button" onClick={() => void confirmRestoreRoom()} disabled={!canUse || roomSaving}>{roomSaving ? '恢复中...' : '恢复启用'}</button></>}
        >
          {restoreConfirmation.closeRoomModal ? roomSubmitError ? <p className="form-alert">{roomSubmitError}</p> : null : inactiveRoomsError ? <p className="form-alert">{inactiveRoomsError}</p> : null}
          <p>恢复后将保留原直播间资料，不会自动恢复历史主播绑定。</p>
        </SystemModal>
      ) : null}

      {assignmentRoom ? (
        <AssignmentModal
          room={assignmentRoom}
          regionId={assignmentRoom.room.region_id}
          canUse={canUse}
          onClose={() => setAssignmentRoom(null)}
          onAssign={(creatorEntityId) => void assignCreator(assignmentRoom.room.id, creatorEntityId)}
          onRemove={(assignmentId) => void removeAssignment(assignmentId)}
        />
      ) : null}
      {sessionModal ? <SessionModal room={sessionModal.room} creator={sessionModal.creator} session={sessionModal.session} defaultDate={todayIso} existingSessions={sessions.filter((session) => session.status === 'active')} onClose={() => setSessionModal(null)} onSaved={async (input) => { try { if (sessionModal.session) await offlineLiveRoomService.updateLiveSession({ sessionId: sessionModal.session.id, startedAt: input.startedAt, endedAt: input.endedAt, note: input.note }); else await offlineLiveRoomService.createLiveSession(input); setSessionModal(null); setMessage('直播时间已保存。'); await loadDashboard(); } catch (saveError) { throw saveError; } }} /> : null}
      {voidSession ? <VoidSessionModal session={voidSession} onClose={() => setVoidSession(null)} onSaved={async (status, reason) => { await offlineLiveRoomService.voidLiveSession({ sessionId: voidSession.id, status, reason }); setVoidSession(null); setMessage('直播记录已作废。'); await loadDashboard(); }} /> : null}
      {scheduleCreator ? <ScheduleModal creator={scheduleCreator} schedule={schedules.find((schedule) => schedule.creator_entity_id === scheduleCreator.entityId) ?? null} onClose={() => setScheduleCreator(null)} onSaved={async (input) => { await offlineLiveRoomService.saveCreatorSchedule({ creatorEntityId: scheduleCreator.entityId, ...input }); setScheduleCreator(null); setMessage('直播计划已保存。'); await loadDashboard(); }} /> : null}
    </div>
  );
}

function KpiCard({ label, value, detail, tone }: { label: string; value: ReactNode; detail?: string; tone?: 'updated' | 'pending' }) {
  return (
    <article className={`offline-live-room-kpi${tone ? ` offline-live-room-kpi--${tone}` : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </article>
  );
}

function RevenuePair({ tiktok, douyin }: { tiktok: number; douyin: number }) {
  return (
    <span className="offline-live-room-revenue-pair">
      <PlatformMetric platform="tiktok" value={tiktok} unit="钻石" />
      <PlatformMetric platform="douyin" value={douyin} unit="音浪" />
    </span>
  );
}

function PlatformMetric({ platform, value, unit, total = false }: { platform: 'tiktok' | 'douyin'; value: number; unit: string; total?: boolean }) {
  const label = platform === 'tiktok' ? 'TikTok' : '抖音';
  return (
    <span className={`offline-live-room-platform-metric offline-live-room-platform-metric--${platform}`}>
      <span className="offline-live-room-platform-metric-head">
        <img src={platform === 'tiktok' ? tiktokLogoUrl : douyinLogoUrl} alt="" aria-hidden="true" />
        <em>{label}</em>
        {total ? <small>TOTAL</small> : null}
      </span>
      <b>{formatOfflineLiveRoomRevenue(value)}</b>
      <span className="offline-live-room-platform-metric-unit">{unit}</span>
    </span>
  );
}

function RoomCard({ item, canUse, showRevenue, showDuration, canUseDuration, sessions, schedules, todayIso, periodRange, onEdit, onDeactivate, onManageCreators, onSession, onVoid, onSchedule }: {
  item: OfflineLiveRoomDashboardRoom;
  canUse: boolean;
  showRevenue: boolean;
  showDuration: boolean;
  canUseDuration: boolean;
  sessions: OfflineLiveSession[];
  schedules: OfflineLiveCreatorSchedule[];
  todayIso: string;
  periodRange: DateRange;
  onEdit: () => void;
  onDeactivate: () => void;
  onManageCreators: () => void;
  onSession: (room: OfflineLiveRoom, creator: OfflineLiveRoomCreatorSummary, session?: OfflineLiveSession) => void;
  onVoid: (session: OfflineLiveSession) => void;
  onSchedule: (creator: OfflineLiveRoomCreatorSummary) => void;
}) {
  const temporaryCreatorCards = showDuration ? Array.from(new Map(
    sessions.filter((session) => session.room_context_type === 'temporary' && !item.creators.some((creator) => creator.entityId === session.creator_entity_id))
      .map((session) => [session.creator_entity_id, sessionToTemporaryCreatorSummary(session)]),
  ).values()) : [];
  const displayedCreators = [...item.creators, ...temporaryCreatorCards];
  return (
    <article className={`offline-live-room-card offline-live-room-card--${item.status}`}>
      <div className="offline-live-room-card-head">
        <div>
          <span>{item.room.region?.code ?? item.room.region?.name ?? '-'}</span>
          <h3>{item.room.room_number}号直播间</h3>
          <p>{item.room.name}</p>
        </div>
        {showRevenue ? <StatusBadge status={item.status} /> : null}
      </div>

      <div className="offline-live-room-creator-list">
        {displayedCreators.length === 0 ? <p className="offline-live-room-empty-line">未配置主播</p> : null}
        {displayedCreators.map((creator) => (
          <div className="offline-live-room-creator" key={creator.entityId}>
            <strong>{creator.displayName}{temporaryCreatorCards.some((temporary) => temporary.entityId === creator.entityId) ? <small className="offline-live-room-temporary-tag">临时</small> : null}</strong>
            {showDuration ? <p className="offline-live-room-creator-platforms">{creator.profiles.map(({ profile }) => platformLabels[profile.platform]).join(' · ')}</p> : null}
            {showRevenue ? <div>
              {creator.profiles.map(({ profile, record, total }) => (
                <span key={profile.id} className={`offline-live-room-platform-line offline-live-room-platform-line--${profile.platform}`}>
                  <em>{platformLabels[profile.platform]}</em>
                  <b>{record ? formatOfflineLiveRoomRevenue(total) : '--'}</b>
                  <small>{getOfflineLiveRoomRevenueUnit(profile.platform)}</small>
                </span>
              ))}
            </div> : null}
            {showDuration ? <CreatorDuration room={item.room} creator={creator} sessions={sessions.filter((session) => session.creator_entity_id === creator.entityId && session.status === 'active')} schedule={schedules.find((schedule) => schedule.creator_entity_id === creator.entityId) ?? null} todayIso={todayIso} periodRange={periodRange} canUse={canUseDuration} onSession={onSession} onVoid={onVoid} onSchedule={onSchedule} /> : null}
          </div>
        ))}
      </div>

      {showRevenue ? <div className="offline-live-room-card-total">
        <PlatformMetric platform="tiktok" value={item.tiktokTotal} unit="钻石" total />
        <PlatformMetric platform="douyin" value={item.douyinTotal} unit="音浪" total />
      </div> : null}

      <footer className="offline-live-room-card-footer">
        <span>{showRevenue ? `最后更新：${item.latestUpdatedAt ? formatDateTime(item.latestUpdatedAt) : '--'}` : '直播时长按 MYT 统计'}</span>
        <div>
          <button className="icon-button" type="button" onClick={onManageCreators} disabled={!canUse} aria-label="设置常驻主播">
            <UserPlus size={16} />
          </button>
          <button className="icon-button" type="button" onClick={onEdit} disabled={!canUse} aria-label="编辑直播间">
            <Edit3 size={16} />
          </button>
          <button className="icon-button reject-button" type="button" onClick={onDeactivate} disabled={!canUse} aria-label="停用直播间">
            <Power size={16} />
          </button>
        </div>
      </footer>
    </article>
  );
}

function CreatorDuration({ room, creator, sessions, schedule, todayIso, periodRange, canUse, onSession, onVoid, onSchedule }: {
  room: OfflineLiveRoom;
  creator: OfflineLiveRoomCreatorSummary;
  sessions: OfflineLiveSession[];
  schedule: OfflineLiveCreatorSchedule | null;
  todayIso: string;
  periodRange: DateRange;
  canUse: boolean;
  onSession: (room: OfflineLiveRoom, creator: OfflineLiveRoomCreatorSummary, session?: OfflineLiveSession) => void;
  onVoid: (session: OfflineLiveSession) => void;
  onSchedule: (creator: OfflineLiveRoomCreatorSummary) => void;
}) {
  const sorted = [...sessions].sort((first, second) => first.started_at.localeCompare(second.started_at));
  const todayTotal = sorted.filter((session) => session.broadcast_date === todayIso).reduce((sum, session) => sum + session.duration_seconds, 0);
  const periodTotal = sorted.reduce((sum, session) => sum + session.duration_seconds, 0);
  return <section className="offline-live-room-duration">
    {sorted.length ? <><div className="offline-live-room-session-list">{sorted.map((session) => <div className="offline-live-room-session" key={session.id}><span>{formatMalaysiaTime(session.started_at)} - {session.broadcast_date !== malaysiaDateOf(session.ended_at) ? `次日 ${formatMalaysiaTime(session.ended_at)}` : formatMalaysiaTime(session.ended_at)}{session.room_context_type === 'temporary' ? <small className="offline-live-room-temporary-tag">临时</small> : null}</span><strong>{formatDuration(session.duration_seconds)}</strong>{canUse ? <span className="offline-live-room-session-actions"><button type="button" onClick={() => onSession(room, creator, session)}>编辑</button><button type="button" onClick={() => onVoid(session)}>作废</button></span> : null}</div>)}</div><div className="offline-live-room-duration-total"><span>今日合计：{formatDuration(todayTotal)}</span><span>{periodRange.startIso === periodRange.endIso ? '当日累计' : '当前周期累计'}：{formatDuration(periodTotal)}</span></div></> : <p className="offline-live-room-duration-empty">暂无直播记录</p>}
    {schedule ? <p className="offline-live-room-schedule-summary">计划：{formatScheduleSummary(schedule)}</p> : null}
    {canUse ? <div className="offline-live-room-duration-actions"><button className="secondary-button compact-button" type="button" onClick={() => onSession(room, creator)}><Clock3 size={14} />填写时间</button><button className="secondary-button compact-button" type="button" onClick={() => onSchedule(creator)}><CalendarDays size={14} />直播计划</button></div> : null}
  </section>;
}

function StatusBadge({ status }: { status: OfflineLiveRoomUpdateStatus }) {
  return <span className={`offline-live-room-status offline-live-room-status--${status}`}>{statusLabels[status]}</span>;
}

function RoomModal({ regions, room, defaultRegionId, saving, submitError, onClose, onSubmit }: {
  regions: Region[];
  room: OfflineLiveRoom | null;
  defaultRegionId: string;
  saving: boolean;
  submitError: string;
  onClose: () => void;
  onSubmit: (values: RoomFormValues) => void;
}) {
  const [values, setValues] = useState<RoomFormValues>({
    regionId: room?.region_id ?? defaultRegionId,
    roomNumber: room?.room_number ?? '',
    name: room?.name ?? '',
    sortOrder: String(room?.sort_order ?? 0),
  });
  const [error, setError] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = validateRoomForm(values);
    if (validationError) {
      setError(validationError);
      return;
    }
    onSubmit(values);
  }

  return (
    <SystemModal
      title={room ? '编辑直播间' : '添加直播间'}
      ariaLabel="线下直播间表单"
      onClose={onClose}
      footer={<><button className="secondary-button compact-button" type="button" onClick={onClose}>取消</button><button className="primary-button compact-button" type="submit" form="offline-live-room-form" disabled={saving}>保存</button></>}
    >
      {error || submitError ? <p className="form-alert">{error || submitError}</p> : null}
      <form id="offline-live-room-form" className="form-grid" onSubmit={submit}>
        <label className="form-field">
          <span>区域</span>
          <select value={values.regionId} onChange={(event) => setValues({ ...values, regionId: event.target.value })}>
            {regions.map((region) => <option key={region.id} value={region.id}>{region.code || region.name}</option>)}
          </select>
        </label>
        <TextField label="房间编号" value={values.roomNumber} onChange={(roomNumber) => setValues({ ...values, roomNumber })} required />
        <TextField label="房间名称" value={values.name} onChange={(name) => setValues({ ...values, name })} required />
        <TextField label="排序" type="number" value={values.sortOrder} onChange={(sortOrder) => setValues({ ...values, sortOrder })} />
      </form>
    </SystemModal>
  );
}

function InactiveRoomsModal({ rooms, loading, error, canUse, saving, onClose, onRestore }: {
  rooms: OfflineLiveRoom[];
  loading: boolean;
  error: string;
  canUse: boolean;
  saving: boolean;
  onClose: () => void;
  onRestore: (room: OfflineLiveRoom) => void;
}) {
  return (
    <SystemModal
      title="已停用直播间"
      ariaLabel="已停用直播间"
      onClose={onClose}
      footer={<button className="secondary-button compact-button" type="button" onClick={onClose} disabled={saving}>关闭</button>}
    >
      {error ? <p className="form-alert">{error}</p> : null}
      {loading ? <p className="offline-live-room-empty-line">正在读取已停用直播间...</p> : null}
      {!loading && rooms.length === 0 ? <p className="offline-live-room-empty-line">当前区域暂无已停用直播间。</p> : null}
      {!loading && rooms.map((room) => (
        <div className="offline-live-room-assigned-creator" key={room.id}>
          <div>
            <strong>{room.room_number}号直播间</strong>
            <span>{room.region?.code || room.region?.name || '-'} · {room.name} · 排序 {room.sort_order} · 已停用</span>
          </div>
          <button className="primary-button compact-button" type="button" onClick={() => onRestore(room)} disabled={!canUse || saving}>恢复启用</button>
        </div>
      ))}
    </SystemModal>
  );
}

function AssignmentModal({ room, regionId, canUse, onClose, onAssign, onRemove }: {
  room: OfflineLiveRoomDashboardRoom;
  regionId: string;
  canUse: boolean;
  onClose: () => void;
  onAssign: (creatorEntityId: string) => void;
  onRemove: (assignmentId: string) => void;
}) {
  const [entities, setEntities] = useState<OfflineLiveRoomCreatorEntity[]>([]);
  const [search, setSearch] = useState('');
  const [selectedEntityId, setSelectedEntityId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const assignedEntityIds = useMemo(() => new Set(room.assignments.map((assignment) => assignment.creator_entity_id)), [room.assignments]);
  const options = useMemo(() => entities.filter((entity) => !assignedEntityIds.has(entity.id) && matchesEntitySearch(entity, search)), [assignedEntityIds, entities, search]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    offlineLiveRoomService.listAvailableCreatorEntities(regionId)
      .then((items) => {
        if (!active) return;
        setEntities(items);
        setSelectedEntityId(items.find((item) => !assignedEntityIds.has(item.id))?.id ?? '');
      })
      .catch((loadError) => {
        if (active) setError(`读取主播失败：${getErrorMessage(loadError)}`);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [assignedEntityIds, regionId]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedEntityId) return;
    onAssign(selectedEntityId);
  }

  return (
    <SystemModal
      title="设置常驻主播"
      subtitle={`${room.room.room_number}号直播间`}
      ariaLabel="常驻主播维护"
      onClose={onClose}
      footer={<button className="secondary-button compact-button" type="button" onClick={onClose}>关闭</button>}
    >
      {error ? <p className="form-alert">{error}</p> : null}
      <div className="offline-live-room-assignment">
        <section>
          <h4>当前常驻主播</h4>
          {room.creators.length === 0 ? <p className="offline-live-room-empty-line">未配置主播</p> : null}
          {room.creators.map((creator) => {
            const assignment = room.assignments.find((item) => item.creator_entity_id === creator.entityId);
            return (
              <div className="offline-live-room-assigned-creator" key={creator.entityId}>
                <div>
                  <strong>{creator.displayName}</strong>
                  <span>{creator.profiles.map(({ profile }) => `${platformLabels[profile.platform]} ${profile.platform_user_id}`).join(' / ')}</span>
                </div>
                {assignment ? (
                  <button className="icon-button reject-button" type="button" onClick={() => onRemove(assignment.id)} disabled={!canUse} aria-label="停用常驻主播关系">
                    <X size={16} />
                  </button>
                ) : null}
              </div>
            );
          })}
        </section>

        <form onSubmit={submit}>
          <h4>添加主播</h4>
          <label className="form-field">
            <span>搜索主播</span>
            <div className="offline-live-room-search-input">
              <Search size={16} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="主播名 / UID / 平台账号" />
            </div>
          </label>
          <label className="form-field">
            <span>主播</span>
            <select value={selectedEntityId} onChange={(event) => setSelectedEntityId(event.target.value)} disabled={loading || options.length === 0}>
              <option value="">{loading ? '读取中...' : '请选择主播'}</option>
              {options.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.display_name} / {entity.profiles.map((profile) => `${platformLabels[profile.platform]} ${profile.platform_user_id}`).join(' / ')}
                </option>
              ))}
            </select>
          </label>
          <button className="primary-button compact-button" type="submit" disabled={!canUse || !selectedEntityId}>添加为常驻主播</button>
        </form>
      </div>
    </SystemModal>
  );
}

function SessionModal({ room, creator, session, defaultDate, existingSessions, onClose, onSaved }: {
  room: OfflineLiveRoom;
  creator: OfflineLiveRoomCreatorSummary;
  session?: OfflineLiveSession;
  defaultDate: string;
  existingSessions: OfflineLiveSession[];
  onClose: () => void;
  onSaved: (input: { creatorEntityId: string; roomId: string; roomContextType: 'assigned' | 'temporary'; startedAt: string; endedAt: string; note?: string }) => Promise<void>;
}) {
  const [roomContextType, setRoomContextType] = useState<'assigned' | 'temporary'>(session?.room_context_type ?? 'assigned');
  const [search, setSearch] = useState('');
  const [temporaryCreatorId, setTemporaryCreatorId] = useState(creator.entityId);
  const [candidates, setCandidates] = useState<OfflineLiveRoomCreatorSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [date, setDate] = useState(session?.broadcast_date ?? defaultDate);
  const [start, setStart] = useState(session ? formatMalaysiaTime(session.started_at) : '');
  const [end, setEnd] = useState(session ? formatMalaysiaTime(session.ended_at) : '');
  const [note, setNote] = useState(session?.note ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const selectedCreator = roomContextType === 'temporary' ? candidates.find((item) => item.creator_entity_id === temporaryCreatorId) ?? null : null;
  const effectiveCreatorId = selectedCreator?.creator_entity_id ?? creator.entityId;
  const candidateOptions = candidates;
  const preview = sessionTimes(date, start, end);
  const overlaps = preview ? existingSessions.some((item) => item.creator_entity_id === effectiveCreatorId && item.id !== session?.id && new Date(item.started_at).getTime() < preview.endedAt.getTime() && new Date(item.ended_at).getTime() > preview.startedAt.getTime()) : false;
  useEffect(() => {
    if (roomContextType !== 'temporary' || session || !search.trim()) { setCandidates([]); setSearchError(''); return; }
    let active = true;
    setSearching(true); setSearchError('');
    const timer = window.setTimeout(() => {
      offlineLiveRoomService.searchLiveRoomCreatorEntities({ regionId: room.region_id, query: search })
        .then((items) => { if (active) setCandidates(items); })
        .catch((searchFailure) => { if (active) { setCandidates([]); setSearchError(getErrorMessage(searchFailure)); } })
        .finally(() => { if (active) setSearching(false); });
    }, 200);
    return () => { active = false; window.clearTimeout(timer); };
  }, [room.region_id, roomContextType, search, session]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (roomContextType === 'temporary' && !selectedCreator) { setError('请选择现有临时主播。'); return; }
    if (!preview) { setError('请填写有效的直播日期、开播时间和下播时间。'); return; }
    if (overlaps) { setError('该主播的直播时间与已有记录重叠，请检查时间。'); return; }
    setSaving(true); setError('');
    try { await onSaved({ creatorEntityId: effectiveCreatorId, roomId: room.id, roomContextType, startedAt: preview.startedAt.toISOString(), endedAt: preview.endedAt.toISOString(), note }); } catch (saveError) { setError(friendlyLiveError(saveError)); } finally { setSaving(false); }
  }
  return <SystemModal title={session ? '编辑直播时间' : '填写直播时间'} subtitle={`${room.room_number}号直播间 · ${room.name}`} onClose={onClose} footer={<><button className="secondary-button compact-button" type="button" onClick={onClose} disabled={saving}>取消</button><button className="primary-button compact-button" form="offline-live-session-form" type="submit" disabled={saving || overlaps}>{saving ? '保存中...' : '保存'}</button></>}><form id="offline-live-session-form" className="form-grid offline-live-session-form" onSubmit={submit}>{!session ? <fieldset className="form-field-wide offline-live-room-context-choice"><legend>主播类型</legend><label><input type="radio" checked={roomContextType === 'assigned'} onChange={() => setRoomContextType('assigned')} /> 固定主播</label><label><input type="radio" checked={roomContextType === 'temporary'} onChange={() => setRoomContextType('temporary')} /> 临时主播</label></fieldset> : null}{roomContextType === 'temporary' && !session ? <><label className="form-field"><span>搜索主播</span><input value={search} onChange={(event) => { setSearch(event.target.value); setTemporaryCreatorId(''); }} placeholder="名字 / TikTok ID / 平台账号" /></label><label className="form-field"><span>临时主播</span><select value={temporaryCreatorId} onChange={(event) => setTemporaryCreatorId(event.target.value)} disabled={!search.trim() || searching}><option value="">{searching ? '搜索中...' : '请选择现有主播'}</option>{candidateOptions.map((item) => <option key={item.creator_entity_id} value={item.creator_entity_id}>{item.display_name} / {item.platforms.map((profile) => `${platformLabels[profile.platform]} ${profile.platform_account || profile.platform_user_id || profile.creator_name || ''}`.trim()).join(' / ')}</option>)}</select></label>{searchError ? <p className="form-alert form-field-wide">搜索主播失败：{searchError}</p> : null}</> : <p className="form-field-wide offline-live-session-creator">主播：<strong>{creator.displayName}</strong></p>}<div className="offline-live-session-time-fields form-field-wide"><label className="form-field"><span>直播日期</span><input required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label className="form-field"><span>开播时间</span><input required type="time" value={start} onChange={(event) => setStart(event.target.value)} /></label><label className="form-field"><span>下播时间</span><input required type="time" value={end} onChange={(event) => setEnd(event.target.value)} /></label></div><div className="offline-live-session-preview form-field-wide"><span>{preview?.nextDay ? `${start || '--:--'} → 次日 ${end || '--:--'}` : `${start || '--:--'} → ${end || '--:--'}`}</span><strong>预计时长：{preview ? formatDuration(Math.round((preview.endedAt.getTime() - preview.startedAt.getTime()) / 1000)) : '--'}</strong></div><label className="form-field form-field-wide"><span>备注（可选）</span><input value={note} onChange={(event) => setNote(event.target.value)} /></label>{overlaps ? <p className="form-alert form-field-wide">该主播的直播时间与已有记录重叠，请检查时间。</p> : null}{error ? <p className="form-alert form-field-wide">{error}</p> : null}</form></SystemModal>;
}

function VoidSessionModal({ session, onClose, onSaved }: { session: OfflineLiveSession; onClose: () => void; onSaved: (status: 'void' | 'cancelled', reason: string) => Promise<void> }) {
  const [reason, setReason] = useState('填写错误'); const [detail, setDetail] = useState(''); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  async function submit(event: FormEvent) { event.preventDefault(); const fullReason = [reason, detail.trim()].filter(Boolean).join('：'); if (!fullReason) { setError('请填写作废原因。'); return; } setSaving(true); setError(''); try { await onSaved('void', fullReason); } catch (saveError) { setError(friendlyLiveError(saveError)); } finally { setSaving(false); } }
  return <SystemModal title="作废直播记录" subtitle={`${formatMalaysiaTime(session.started_at)} - ${formatMalaysiaTime(session.ended_at)}`} onClose={onClose} footer={<><button className="secondary-button compact-button" type="button" onClick={onClose} disabled={saving}>取消</button><button className="primary-button compact-button" type="submit" form="void-live-session-form" disabled={saving}>{saving ? '处理中...' : '确认作废'}</button></>}><form id="void-live-session-form" className="form-grid" onSubmit={submit}><label className="form-field"><span>原因</span><select value={reason} onChange={(event) => setReason(event.target.value)}><option>设备问题</option><option>填写错误</option><option>重复记录</option><option>其他</option></select></label><label className="form-field form-field-wide"><span>补充说明（可选）</span><input value={detail} onChange={(event) => setDetail(event.target.value)} /></label>{error ? <p className="form-alert form-field-wide">{error}</p> : null}</form></SystemModal>;
}

function ScheduleModal({ creator, schedule, onClose, onSaved }: { creator: OfflineLiveRoomCreatorSummary; schedule: OfflineLiveCreatorSchedule | null; onClose: () => void; onSaved: (input: { scheduleId?: string; name: string; status: 'active' | 'inactive'; slots: Array<Partial<OfflineLiveCreatorScheduleSlot> & Pick<OfflineLiveCreatorScheduleSlot, 'iso_weekday' | 'started_at_time' | 'ended_at_time'>> }) => Promise<void> }) {
  const [mode, setMode] = useState<'weekdays' | 'daily' | 'custom'>(() => scheduleMode(schedule));
  const [days, setDays] = useState<number[]>(() => scheduleDays(schedule));
  const [slots, setSlots] = useState<Array<Partial<OfflineLiveCreatorScheduleSlot> & Pick<OfflineLiveCreatorScheduleSlot, 'iso_weekday' | 'started_at_time' | 'ended_at_time'>>>(() => uniqueScheduleTimes(schedule));
  const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  function setPreset(next: 'weekdays' | 'daily' | 'custom') { setMode(next); if (next === 'weekdays') setDays([1, 2, 3, 4, 5]); if (next === 'daily') setDays([1, 2, 3, 4, 5, 6, 7]); }
  async function submit(event: FormEvent) { event.preventDefault(); if (!days.length || !slots.length) { setError('请选择至少一天并填写一个时段。'); return; } const desired = days.flatMap((day) => slots.map((slot, index) => ({ ...slot, iso_weekday: day, sort_order: index, status: 'active' as const }))); if (desired.some((slot) => !slot.started_at_time || !slot.ended_at_time || slot.started_at_time === slot.ended_at_time)) { setError('请填写有效且不相同的开始/结束时间。'); return; } const existing = schedule?.slots.filter((slot) => slot.status === 'active').sort((first, second) => first.iso_weekday - second.iso_weekday || first.sort_order - second.sort_order) ?? []; const normalized = [...desired.map((slot, index) => ({ ...slot, id: existing[index]?.id })), ...existing.slice(desired.length).map((slot) => ({ ...slot, status: 'inactive' as const }))]; setSaving(true); setError(''); try { await onSaved({ scheduleId: schedule?.id, name: schedule?.name ?? '常规直播计划', status: 'active', slots: normalized }); } catch (saveError) { setError(friendlyLiveError(saveError)); } finally { setSaving(false); } }
  return <SystemModal title="主播直播计划" subtitle={creator.displayName} onClose={onClose} footer={<><button className="secondary-button compact-button" type="button" onClick={onClose} disabled={saving}>关闭</button><button className="primary-button compact-button" type="submit" form="offline-live-schedule-form" disabled={saving}>{saving ? '保存中...' : '保存计划'}</button></>}><form id="offline-live-schedule-form" className="offline-live-schedule-form" onSubmit={submit}><div className="segmented-choice">{(['weekdays', 'daily', 'custom'] as const).map((value) => <button key={value} type="button" className={mode === value ? 'active' : ''} onClick={() => setPreset(value)}>{value === 'weekdays' ? '工作日' : value === 'daily' ? '每天' : '自定义'}</button>)}</div>{mode === 'custom' ? <div className="offline-live-weekdays">{['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map((label, index) => <label key={label}><input type="checkbox" checked={days.includes(index + 1)} onChange={(event) => setDays((current) => event.target.checked ? [...current, index + 1].sort() : current.filter((day) => day !== index + 1))} /> {label}</label>)}</div> : null}<div className="offline-live-slot-list">{slots.map((slot, index) => <div key={index} className="offline-live-slot"><label><span className="sr-only">开播时间</span><input type="time" value={slot.started_at_time} onChange={(event) => setSlots((current) => current.map((value, currentIndex) => currentIndex === index ? { ...value, started_at_time: event.target.value } : value))} /></label><span className="offline-live-slot-arrow">→</span><label><span className="sr-only">下播时间</span><input type="time" value={slot.ended_at_time} onChange={(event) => setSlots((current) => current.map((value, currentIndex) => currentIndex === index ? { ...value, ended_at_time: event.target.value } : value))} /></label><span className="offline-live-slot-summary">{formatScheduleSlotSummary(slot.started_at_time, slot.ended_at_time)}</span>{slots.length > 1 ? <button type="button" onClick={() => setSlots((current) => current.filter((_, currentIndex) => currentIndex !== index))}>移除</button> : null}</div>)}</div><button className="secondary-button compact-button" type="button" onClick={() => setSlots((current) => [...current, { iso_weekday: 1, started_at_time: '21:00', ended_at_time: '23:00' }])}><Plus size={14} />增加时段</button>{error ? <p className="form-alert">{error}</p> : null}</form></SystemModal>;
}

function TextField({ label, value, onChange, type = 'text', required = false }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean }) {
  return (
    <label className="form-field">
      <span>{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} required={required} />
    </label>
  );
}

function normalizeRoomForm(values: RoomFormValues): OfflineLiveRoomFormInput {
  return {
    regionId: values.regionId,
    roomNumber: values.roomNumber.trim(),
    name: values.name.trim(),
    sortOrder: Number(values.sortOrder) || 0,
  };
}

function validateRoomForm(values: RoomFormValues) {
  if (!values.regionId) return '请选择区域。';
  if (!values.roomNumber.trim()) return '请填写房间编号。';
  if (!values.name.trim()) return '请填写房间名称。';
  return '';
}

function getSelectedDateRange(quickRange: QuickRange, todayIso: string, customStart: string, customEnd: string): DateRange {
  if (quickRange === 'month') return getMonthDateRange(todayIso.slice(0, 7));
  if (quickRange === 'custom') return normalizeDateRange(customStart, customEnd, { startIso: todayIso, endIso: todayIso });
  return { startIso: todayIso, endIso: todayIso };
}

function getSessionDateRange(quickRange: QuickRange, todayIso: string, customStart: string, customEnd: string): DateRange {
  if (quickRange === 'month') return getMonthDateRange(todayIso.slice(0, 7));
  if (quickRange === 'custom') return normalizeDateRange(customStart, customEnd, { startIso: todayIso, endIso: todayIso });
  const today = parseIsoDate(todayIso);
  const day = today.getDay() || 7;
  const start = new Date(today); start.setDate(today.getDate() - day + 1);
  const end = new Date(start); end.setDate(start.getDate() + 6);
  return { startIso: formatLocalDate(start), endIso: formatLocalDate(end) };
}

function mapRevenuePeriodSettingsToRanges(settings: RevenuePeriodSetting[]): OfflineLiveRoomPeriodRange[] {
  return settings
    .filter((setting) => setting.isEnabled)
    .map((setting) => ({
      startIso: setting.startDate,
      endIso: setting.endDate,
      label: setting.label,
      shortLabel: formatPeriodDayRange(setting.startDate, setting.endDate),
      periodNo: setting.periodNo,
    }))
    .sort((first, second) => first.startIso.localeCompare(second.startIso));
}

function getRevenuePeriodsForDateRange(range: DateRange, periodsByMonth: Record<string, OfflineLiveRoomPeriodRange[]>): OfflineLiveRoomPeriodRange[] {
  const periods = new Map<string, OfflineLiveRoomPeriodRange>();
  getMonthsForDateRange(range).forEach((month) => {
    (periodsByMonth[month] ?? [])
      .filter((period) => period.startIso <= range.endIso && period.endIso >= range.startIso)
      .forEach((period) => periods.set(period.startIso, period));
  });
  return Array.from(periods.values()).sort((first, second) => first.startIso.localeCompare(second.startIso));
}

function findRevenuePeriodForDate(periods: OfflineLiveRoomPeriodRange[], dateIso: string) {
  return periods.find((period) => period.startIso <= dateIso && period.endIso >= dateIso) ?? null;
}

function getMonthsForDateRange(range: DateRange) {
  const normalizedRange = normalizeDateRange(range.startIso, range.endIso, range);
  const months: string[] = [];
  const cursor = parseIsoDate(normalizedRange.startIso);
  cursor.setDate(1);
  const end = parseIsoDate(normalizedRange.endIso);
  end.setDate(1);

  while (cursor <= end) {
    months.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return months;
}

function getMonthDateRange(month: string): DateRange {
  const [year, monthNumber] = month.split('-').map(Number);
  const start = new Date(year, monthNumber - 1, 1);
  const end = new Date(year, monthNumber, 0);
  return { startIso: formatLocalDate(start), endIso: formatLocalDate(end) };
}

function normalizeDateRange(startIso: string, endIso: string, fallback: DateRange): DateRange {
  if (!isValidIsoDate(startIso) || !isValidIsoDate(endIso)) return fallback;
  return startIso <= endIso ? { startIso, endIso } : { startIso: endIso, endIso: startIso };
}

function matchesEntitySearch(entity: OfflineLiveRoomCreatorEntity, search: string) {
  const normalizedSearch = search.trim().toLowerCase();
  if (!normalizedSearch) return true;
  return [
    entity.display_name,
    ...entity.profiles.flatMap((profile) => [profile.creator_name, profile.platform_user_id, profile.platform_account, platformLabels[profile.platform]]),
  ].join(' ').toLowerCase().includes(normalizedSearch);
}

function isValidIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = parseIsoDate(value);
  return !Number.isNaN(date.getTime()) && formatLocalDate(date) === value;
}

function parseIsoDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatMalaysiaDate(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const value = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function formatPeriodDayRange(startIso: string, endIso: string) {
  return `${parseIsoDate(startIso).getDate()}日-${parseIsoDate(endIso).getDate()}日`;
}

function formatDateRangeText(startIso: string, endIso: string) {
  return `${formatDate(startIso)} - ${formatDate(endIso)}`;
}

function formatDate(value: string) {
  return value ? new Date(value).toLocaleDateString('zh-MY') : '--';
}

function formatDateTime(value: string) {
  return value ? new Date(value).toLocaleString('zh-MY') : '--';
}

function malaysiaDateOf(value: string) { return formatMalaysiaDate(new Date(value)); }
function formatMalaysiaTime(value: string) { return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)); }
function formatDuration(seconds: number) { const minutes = Math.max(0, Math.round(seconds / 60)); return `${Math.floor(minutes / 60)}小时${String(minutes % 60).padStart(2, '0')}分`; }
function sessionTimes(date: string, start: string, end: string) {
  if (!isValidIsoDate(date) || !/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return null;
  const startedAt = new Date(`${date}T${start}:00+08:00`);
  let endedAt = new Date(`${date}T${end}:00+08:00`);
  if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime())) return null;
  const nextDay = endedAt.getTime() <= startedAt.getTime();
  if (nextDay) endedAt = new Date(endedAt.getTime() + 86_400_000);
  return { startedAt, endedAt, nextDay };
}
function formatScheduleSummary(schedule: OfflineLiveCreatorSchedule) { const slots = schedule.slots.filter((slot) => slot.status === 'active').sort((a, b) => a.iso_weekday - b.iso_weekday || a.sort_order - b.sort_order); if (!slots.length) return '未设置时段'; const days = [...new Set(slots.map((slot) => slot.iso_weekday))]; const dayText = JSON.stringify(days) === JSON.stringify([1, 2, 3, 4, 5]) ? '周一～周五' : days.length === 7 ? '每天' : days.map((day) => `周${['一', '二', '三', '四', '五', '六', '日'][day - 1]}`).join('、'); return `${dayText} · ${slots.filter((slot, index) => index === 0 || slot.started_at_time !== slots[index - 1].started_at_time || slot.ended_at_time !== slots[index - 1].ended_at_time).map((slot) => `${slot.started_at_time.slice(0, 5)}–${slot.ended_at_time.slice(0, 5)}`).join(' / ')}`; }
function formatScheduleSlotSummary(startedAt: string, endedAt: string) { if (!startedAt || !endedAt) return '请选择时间'; const start = startedAt.slice(0, 5); const end = endedAt.slice(0, 5); const [startHour, startMinute] = start.split(':').map(Number); const [endHour, endMinute] = end.split(':').map(Number); if ([startHour, startMinute, endHour, endMinute].some(Number.isNaN)) return '请选择时间'; let minutes = endHour * 60 + endMinute - startHour * 60 - startMinute; const nextDay = minutes <= 0; if (nextDay) minutes += 24 * 60; return `${nextDay ? '次日 ' : ''}${end} · ${formatDuration(minutes * 60)}`; }
function scheduleMode(schedule: OfflineLiveCreatorSchedule | null): 'weekdays' | 'daily' | 'custom' { const days = scheduleDays(schedule); return JSON.stringify(days) === JSON.stringify([1, 2, 3, 4, 5]) ? 'weekdays' : days.length === 7 ? 'daily' : 'custom'; }
function scheduleDays(schedule: OfflineLiveCreatorSchedule | null) { return [...new Set(schedule?.slots.filter((slot) => slot.status === 'active').map((slot) => slot.iso_weekday) ?? [])].sort(); }
function sessionToTemporaryCreatorSummary(session: OfflineLiveSession): OfflineLiveRoomCreatorSummary {
  const profiles = session.creator_platforms.map((platform, index) => ({
    id: `${session.creator_entity_id}:${platform.platform}:${index}`,
    platform: platform.platform,
    creator_name: platform.creator_name ?? session.creator_display_name,
    platform_user_id: platform.platform_user_id ?? '',
    platform_account: platform.platform_account ?? '',
  } as OfflineLiveRoomCreatorEntity['profiles'][number]));
  return {
    entityId: session.creator_entity_id,
    displayName: session.creator_display_name,
    profiles: profiles.map((profile) => ({ profile, records: [], total: 0, record: null })),
  };
}
function uniqueScheduleTimes(schedule: OfflineLiveCreatorSchedule | null) { const seen = new Set<string>(); const values = (schedule?.slots ?? []).filter((slot) => slot.status === 'active').sort((first, second) => first.sort_order - second.sort_order).filter((slot) => { const key = `${slot.started_at_time}:${slot.ended_at_time}`; if (seen.has(key)) return false; seen.add(key); return true; }).map((slot) => ({ started_at_time: slot.started_at_time.slice(0, 5), ended_at_time: slot.ended_at_time.slice(0, 5), iso_weekday: 1 })); return values.length ? values : [{ iso_weekday: 1, started_at_time: '14:00', ended_at_time: '18:30' }]; }
function friendlyLiveError(error: unknown) { const message = getErrorMessage(error); if (/overlap/i.test(message)) return '该主播的直播时间与已有记录重叠，请检查时间。'; if (/function|schema cache|does not exist/i.test(message)) return '直播时长服务尚未部署或暂不可用。'; if (/permission|access denied/i.test(message)) return '没有权限或当前区域不可访问。'; return message; }
function isRpcUnavailable(error: unknown) { return /function|schema cache|does not exist/i.test(getErrorMessage(error)); }

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error && 'message' in error && typeof error.message === 'string') return error.message;
  return '操作失败。';
}

function isDuplicateRoomError(error: unknown) {
  if (typeof error !== 'object' || !error) return false;
  return 'code' in error && error.code === '23505';
}
