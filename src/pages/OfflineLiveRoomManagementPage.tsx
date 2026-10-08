import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Edit3, Plus, Power, RefreshCw, Search, UserPlus, X } from 'lucide-react';
import { SystemModal } from '../components/SystemModal';
import { usePermissions } from '../hooks/usePermissions';
import { permissionRuntimeService } from '../services/permission-runtime.service';
import tiktokLogoUrl from '../assets/icons/tiktok-logo.png';
import douyinLogoUrl from '../assets/icons/douyin-logo.png';
import {
  formatOfflineLiveRoomRevenue,
  getOfflineLiveRoomRevenueUnit,
  offlineLiveRoomService,
  platformLabels,
  type OfflineLiveRoom,
  type OfflineLiveRoomCreatorAssignment,
  type OfflineLiveRoomCreatorEntity,
  type OfflineLiveRoomDashboard,
  type OfflineLiveRoomDashboardRoom,
  type OfflineLiveRoomFormInput,
  type OfflineLiveRoomPeriodRange,
  type OfflineLiveRoomUpdateStatus,
  type OfflineLiveRoomSchedule,
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
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleView, setScheduleView] = useState(false);
  const [scheduleUse, setScheduleUse] = useState(false);
  const [scheduleDate, setScheduleDate] = useState(todayIso);
  const [schedules, setSchedules] = useState<OfflineLiveRoomSchedule[]>([]);
  const [scheduleLoadState, setScheduleLoadState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const dashboardRequestIdRef = useRef(0);
  const scheduleRequestIdRef = useRef(0);

  const selectedRange = useMemo(() => getSelectedDateRange(quickRange, todayIso, customStart, customEnd), [customEnd, customStart, quickRange, todayIso]);
  const monthsToLoad = useMemo(() => getMonthsForDateRange(selectedRange), [selectedRange]);
  const selectedPeriods = useMemo(() => getRevenuePeriodsForDateRange(selectedRange, periodsByMonth), [periodsByMonth, selectedRange]);
  const currentPeriod = useMemo(() => findRevenuePeriodForDate(periodsByMonth[currentMonth] ?? [], todayIso), [currentMonth, periodsByMonth, todayIso]);
  const visiblePeriods = useMemo(
    () => (quickRange === 'week' && currentPeriod ? [currentPeriod] : selectedPeriods),
    [currentPeriod, quickRange, selectedPeriods],
  );
  const statusPeriods = useMemo(() => visiblePeriods.filter((period) => period.startIso <= todayIso), [todayIso, visiblePeriods]);

  const loadDashboard = useCallback(async () => {
    if (!regionId || (showRevenue && visiblePeriods.length === 0)) return;
    const requestId = ++dashboardRequestIdRef.current;
    setLoading(true);
    setError('');
    try {
      const nextDashboard = showRevenue
        ? await offlineLiveRoomService.listRoomDashboard({ regionId, periods: visiblePeriods, statusPeriods })
        : await listBasicRoomDashboard(regionId);
      if (requestId === dashboardRequestIdRef.current) setDashboard(nextDashboard);
    } catch (loadError) {
      if (requestId === dashboardRequestIdRef.current) setError(`读取线下直播间失败：${getErrorMessage(loadError)}`);
    } finally {
      if (requestId === dashboardRequestIdRef.current) setLoading(false);
    }
  }, [regionId, showRevenue, statusPeriods, visiblePeriods]);

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

  useEffect(() => { let active=true; Promise.all([permissionRuntimeService.hasExplicitPermission('management-offline-live-room-schedule','view'), permissionRuntimeService.hasExplicitPermission('management-offline-live-room-schedule','use')]).then(([view,use])=>{if(active){setScheduleView(view);setScheduleUse(use);setShowSchedule(view);}}).catch(()=>{if(active){setScheduleView(false);setScheduleUse(false);}}); return()=>{active=false;}; }, []);
  const loadSchedules = useCallback(async () => {
    if (!regionId || !showSchedule || !scheduleView) return;
    const requestId = ++scheduleRequestIdRef.current;
    setScheduleLoadState('loading');
    setSchedules([]);
    try {
      const nextSchedules = await offlineLiveRoomService.listSchedules(regionId, scheduleDate);
      if (requestId === scheduleRequestIdRef.current) {
        setSchedules(nextSchedules);
        setScheduleLoadState('ready');
      }
    } catch (e) {
      if (requestId === scheduleRequestIdRef.current) {
        setScheduleLoadState('error');
        setError(`读取直播时间失败：${friendlyScheduleError(e)}`);
      }
    }
  }, [regionId, scheduleDate, scheduleView, showSchedule]);
  useEffect(() => {
    if (!showSchedule || !scheduleView) {
      scheduleRequestIdRef.current += 1;
      setSchedules([]);
      setScheduleLoadState('idle');
      return;
    }
    void loadSchedules();
  }, [loadSchedules, scheduleView, showSchedule]);
  const schedulesByRoom = useMemo(() => new Map(dashboard.rooms.map((room) => [room.room.id, schedules.filter((item) => item.room_id === room.room.id)])), [dashboard.rooms, schedules]);

  useEffect(() => {
    let active = true;
    if (!showRevenue) {
      setPeriodLoading(false);
      return;
    }
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
  }, [monthsToLoad, periodsByMonth, showRevenue]);

  useEffect(() => {
    if (!regionId || (showRevenue && visiblePeriods.length === 0)) return;
    void loadDashboard();
  }, [loadDashboard, regionId, showRevenue, visiblePeriods.length]);

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

      <section className="offline-live-room-filterbar">
        <div className="offline-live-room-filter-group offline-live-room-filter-group--primary">
          <div className="offline-live-room-display-controls" role="group" aria-label="显示内容"><label><input type="checkbox" checked={showRevenue} onChange={(e)=>setShowRevenue(e.target.checked)} /> <span>流水</span></label>{scheduleView ? <label><input type="checkbox" checked={showSchedule} onChange={(e)=>setShowSchedule(e.target.checked)} /> <span>直播时间</span></label> : null}</div>
          {showSchedule ? <div className="offline-live-room-schedule-date"><span>直播日期</span><div className="offline-live-room-schedule-date-controls"><button type="button" aria-label="前一天" onClick={()=>setScheduleDate(shiftIsoDate(scheduleDate,-1))}>‹</button><input type="date" value={scheduleDate} onChange={(e)=>setScheduleDate(e.target.value)} /><button type="button" aria-label="后一天" onClick={()=>setScheduleDate(shiftIsoDate(scheduleDate,1))}>›</button><button type="button" onClick={()=>setScheduleDate(todayIso)}>今天</button></div></div> : null}
          {showRevenue ? <div className="offline-live-room-segmented" role="group" aria-label="时间范围">
            {quickRangeOptions.map((option) => (
              <button key={option.value} className={quickRange === option.value ? 'active' : ''} type="button" onClick={() => setQuickRange(option.value)}>
                {option.label}
              </button>
            ))}
          </div> : null}
          <label className="form-field">
            <span>区域</span>
            <select value={regionId} onChange={(event) => setRegionId(event.target.value)}>
              {regions.map((region) => <option key={region.id} value={region.id}>{region.code || region.name}</option>)}
            </select>
          </label>
          {showRevenue ? <div className="offline-live-room-period-context">
            <span>当前周期</span>
            <strong>{activeRegion ? formatDateRangeText(visiblePeriods[0]?.startIso ?? selectedRange.startIso, visiblePeriods[visiblePeriods.length - 1]?.endIso ?? selectedRange.endIso) : '读取中'}</strong>
          </div> : null}
        </div>
        {showRevenue && quickRange === 'custom' ? (
          <div className="offline-live-room-filter-group offline-live-room-filter-group--custom">
            <label className="form-field">
              <span>开始日期</span>
              <input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} />
            </label>
            <label className="form-field">
              <span>结束日期</span>
              <input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} />
            </label>
          </div>
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
      </section>

      {showRevenue ? <section className="offline-live-room-kpis">
        <KpiCard label="当前周期流水" value={<RevenuePair tiktok={dashboard.tiktokTotal} douyin={dashboard.douyinTotal} />} />
        <KpiCard label="已更新直播间" value={dashboard.updatedRoomCount} detail="全部主播平台已填写" tone="updated" />
        <KpiCard label="待更新直播间" value={dashboard.pendingRoomCount} detail="含未配置主播房间" tone="pending" />
        <KpiCard label="当前周期主播人数" value={dashboard.creatorCount} detail="按主播本人去重" />
      </section> : null}

      <section className="offline-live-room-grid" aria-busy={busy}>
        {busy ? <div className="offline-live-room-state">正在读取直播间...</div> : null}
        {!busy && dashboard.rooms.length === 0 ? <div className="offline-live-room-state">暂无线下直播间</div> : null}
        {!busy ? dashboard.rooms.map((room) => (
          <RoomCard
            key={room.room.id}
            item={room}
            canUse={canUse}
            showRevenue={showRevenue}
            onEdit={() => { setRoomSubmitError(''); setRoomModal({ mode: 'edit', room: room.room }); }}
            onDeactivate={() => void deactivateRoom(room.room)}
            onManageCreators={() => setAssignmentRoom(room)}
            schedules={showSchedule ? schedulesByRoom.get(room.room.id) ?? [] : []}
            showSchedule={showSchedule}
            scheduleUse={scheduleUse}
            scheduleLoadState={scheduleLoadState}
          />
        )) : null}
      </section>
      {!busy && !showRevenue && !showSchedule ? <p className="offline-live-room-display-empty">已隐藏流水与直播时间，仅显示直播间基本资料及固定主播。</p> : null}

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
    </div>
  );
}

async function listBasicRoomDashboard(regionId: string): Promise<OfflineLiveRoomDashboard> {
  const rooms = await offlineLiveRoomService.listRooms({ regionId });
  if (rooms.length === 0) return emptyDashboard;

  const assignments = await offlineLiveRoomService.listRoomCreatorAssignments({ roomIds: rooms.map((room) => room.id) });
  const entities = await offlineLiveRoomService.listAvailableCreatorEntities(regionId);
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));

  return {
    rooms: rooms.map((room) => {
      const roomAssignments = assignments.filter((assignment) => assignment.room_id === room.id);
      return {
        room,
        assignments: roomAssignments,
        creators: roomAssignments.flatMap((assignment: OfflineLiveRoomCreatorAssignment) => {
          const entity = entityById.get(assignment.creator_entity_id);
          return entity ? [{
            entityId: entity.id,
            displayName: entity.display_name,
            profiles: entity.profiles.map((profile) => ({ profile, records: [], total: 0, record: null })),
          }] : [];
        }),
        tiktokTotal: 0,
        douyinTotal: 0,
        status: 'unconfigured' as const,
        updatedProfileCount: 0,
        expectedProfileCount: 0,
        latestUpdatedAt: null,
      };
    }),
    tiktokTotal: 0,
    douyinTotal: 0,
    updatedRoomCount: 0,
    pendingRoomCount: 0,
    creatorCount: 0,
  };
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

function RoomCard({ item, canUse, showRevenue, onEdit, onDeactivate, onManageCreators, schedules, showSchedule, scheduleUse, scheduleLoadState }: {
  item: OfflineLiveRoomDashboardRoom;
  canUse: boolean;
  showRevenue: boolean;
  onEdit: () => void;
  onDeactivate: () => void;
  onManageCreators: () => void;
  schedules: OfflineLiveRoomSchedule[];
  showSchedule: boolean;
  scheduleUse: boolean;
  scheduleLoadState: 'idle' | 'loading' | 'ready' | 'error';
}) {
  const [temporaryLiveOpen, setTemporaryLiveOpen] = useState(false);
  const temporarySchedules = schedules.filter((schedule) => schedule.usage_type === 'temporary');
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
        {item.creators.length === 0 ? <p className="offline-live-room-empty-line">未配置主播</p> : null}
        {item.creators.map((creator) => {
          const creatorSchedules = schedules.filter((schedule) => schedule.usage_type === 'fixed' && schedule.creator_entity_id === creator.entityId);
          return (
          <div className="offline-live-room-creator" key={creator.entityId}>
            <div className="offline-live-room-creator-header"><strong title={creator.displayName}>{creator.displayName}</strong><em className="offline-live-room-schedule-badge offline-live-room-schedule-badge--fixed">固定主播</em></div>
            {showRevenue ? <div className="offline-live-room-platform-list">
              {creator.profiles.map(({ profile, record, total }) => (
                <span key={profile.id} className={`offline-live-room-platform-line offline-live-room-platform-line--${profile.platform}`}>
                  <em>{platformLabels[profile.platform]}</em>
                  <b>{record ? formatOfflineLiveRoomRevenue(total) : '--'}</b>
                  <small>{getOfflineLiveRoomRevenueUnit(profile.platform)}</small>
                </span>
              ))}
            </div> : null}
            {showSchedule ? <div className="offline-live-room-creator-schedule"><span>直播时间</span>{scheduleLoadState === 'loading' ? <small>正在读取...</small> : scheduleLoadState === 'error' ? <small>读取失败</small> : creatorSchedules.length ? <div className="offline-live-room-creator-schedule-list">{creatorSchedules.map((schedule) => <ScheduleTime key={schedule.id} schedule={schedule} scheduleUse={scheduleUse} />)}</div> : <small>未安排</small>}</div> : null}
          </div>
          );
        })}
      </div>

      {showRevenue ? <div className="offline-live-room-card-total">
        <PlatformMetric platform="tiktok" value={item.tiktokTotal} unit="钻石" total />
        <PlatformMetric platform="douyin" value={item.douyinTotal} unit="音浪" total />
      </div> : null}
      <footer className="offline-live-room-card-footer">
        {showRevenue ? <span>最后更新：{item.latestUpdatedAt ? formatDateTime(item.latestUpdatedAt) : '--'}</span> : <span>直播间资料</span>}
        <div className="offline-live-room-card-actions">
          {showSchedule ? <button className="secondary-button compact-button offline-live-room-temporary-trigger" type="button" onClick={() => setTemporaryLiveOpen(true)}>临时直播</button> : null}
          <div className="offline-live-room-card-icon-actions">
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
        </div>
      </footer>
      {temporaryLiveOpen ? <TemporaryLiveModal roomName={`${item.room.room_number}号直播间`} schedules={temporarySchedules} scheduleLoadState={scheduleLoadState} scheduleUse={scheduleUse} onClose={() => setTemporaryLiveOpen(false)} /> : null}
    </article>
  );
}

function TemporaryLiveModal({ roomName, schedules, scheduleLoadState, scheduleUse, onClose }: {
  roomName: string;
  schedules: OfflineLiveRoomSchedule[];
  scheduleLoadState: 'idle' | 'loading' | 'ready' | 'error';
  scheduleUse: boolean;
  onClose: () => void;
}) {
  return <SystemModal title="临时直播" subtitle={`${roomName} · MYT 当日安排`} ariaLabel="临时直播时间" onClose={onClose} footer={<button className="secondary-button compact-button" type="button" onClick={onClose}>关闭</button>}>
    <div className="offline-live-room-temporary-modal-content">
      {scheduleLoadState === 'loading' ? <p className="offline-live-room-temporary-modal-note">正在读取临时直播时间...</p> : null}
      {scheduleLoadState === 'error' ? <p className="form-alert">临时直播时间读取失败，请刷新后重试。</p> : null}
      {scheduleLoadState === 'ready' && schedules.length === 0 ? <p className="offline-live-room-temporary-modal-note">当天暂无临时直播时间</p> : null}
      {scheduleLoadState === 'ready' && schedules.length > 0 ? <div className="offline-live-room-schedule-list">{schedules.map((schedule) => <ScheduleTime key={schedule.id} schedule={schedule} scheduleUse={scheduleUse} showCreator />)}</div> : null}
      {scheduleUse ? <p className="offline-live-room-temporary-modal-note">当前账号具有临时直播管理权限。</p> : null}
    </div>
  </SystemModal>;
}

function ScheduleTime({ schedule, scheduleUse, showCreator = false }: { schedule: OfflineLiveRoomSchedule; scheduleUse: boolean; showCreator?: boolean }) {
  return (
    <div className={`offline-live-room-schedule-item${showCreator ? '' : ' offline-live-room-schedule-item--time-only'}`}>
      <span className="offline-live-room-schedule-time">{formatScheduleTime(schedule.starts_at, schedule.ends_at)}</span>
      {showCreator ? <div className="offline-live-room-schedule-creator"><strong>{schedule.creator_display_name}</strong>{scheduleUse ? <small>可编辑 / 取消</small> : null}</div> : null}
      <em className={`offline-live-room-schedule-badge offline-live-room-schedule-badge--${schedule.usage_type}`}>{schedule.usage_type === 'fixed' ? '固定主播' : '临时主播'}</em>
    </div>
  );
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

function shiftIsoDate(value: string, amount: number) { const date = parseIsoDate(value); date.setDate(date.getDate() + amount); return formatLocalDate(date); }
function formatScheduleTime(start: string, end: string) { const a = new Date(start); const b = new Date(end); const time = (d: Date) => d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', hour12: false }); return `${time(a)}–${b.getUTCDate() !== a.getUTCDate() ? '次日 ' : ''}${time(b)}`; }
function friendlyScheduleError(error: unknown) { const message = getErrorMessage(error); if (/room schedule conflicts/i.test(message)) return '该直播间此时间已有直播时间安排'; if (/creator schedule conflicts/i.test(message)) return '该主播此时间已有其他直播时间安排'; if (/fixed schedule creator/i.test(message)) return '该主播目前不是此直播间的固定主播'; if (/room region/i.test(message)) return '该主播不属于此直播间区域'; if (/permission|access denied/i.test(message)) return '你没有此直播时间操作权限'; if (/24 hours/i.test(message)) return '单次直播时间不能超过24小时'; if (/chronological|end/i.test(message)) return '结束时间必须晚于开始时间'; return message; }

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error && 'message' in error && typeof error.message === 'string') return error.message;
  return '操作失败。';
}

function isDuplicateRoomError(error: unknown) {
  if (typeof error !== 'object' || !error) return false;
  return 'code' in error && error.code === '23505';
}
