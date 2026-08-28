import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Edit3, Plus, Power, RefreshCw, Search, UserPlus, X } from 'lucide-react';
import { SystemModal } from '../components/SystemModal';
import { usePermissions } from '../hooks/usePermissions';
import {
  formatOfflineLiveRoomRevenue,
  getOfflineLiveRoomRevenueUnit,
  offlineLiveRoomService,
  platformLabels,
  type OfflineLiveRoom,
  type OfflineLiveRoomCreatorEntity,
  type OfflineLiveRoomDashboard,
  type OfflineLiveRoomDashboardRoom,
  type OfflineLiveRoomFormInput,
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
  const todayIso = useMemo(() => formatLocalDate(new Date()), []);
  const currentMonth = todayIso.slice(0, 7);
  const [regions, setRegions] = useState<Region[]>([]);
  const [regionId, setRegionId] = useState('');
  const [quickRange, setQuickRange] = useState<QuickRange>('week');
  const [customStart, setCustomStart] = useState(todayIso);
  const [customEnd, setCustomEnd] = useState(todayIso);
  const [periodsByMonth, setPeriodsByMonth] = useState<Record<string, OfflineLiveRoomPeriodRange[]>>({});
  const [dashboard, setDashboard] = useState<OfflineLiveRoomDashboard>(emptyDashboard);
  const [loading, setLoading] = useState(true);
  const [periodLoading, setPeriodLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [roomModal, setRoomModal] = useState<{ mode: 'create' | 'edit'; room: OfflineLiveRoom | null } | null>(null);
  const [assignmentRoom, setAssignmentRoom] = useState<OfflineLiveRoomDashboardRoom | null>(null);

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
    if (!regionId || visiblePeriods.length === 0) return;
    setLoading(true);
    setError('');
    try {
      const nextDashboard = await offlineLiveRoomService.listRoomDashboard({ regionId, periods: visiblePeriods, statusPeriods });
      setDashboard(nextDashboard);
    } catch (loadError) {
      setError(`读取线下直播间失败：${getErrorMessage(loadError)}`);
    } finally {
      setLoading(false);
    }
  }, [regionId, statusPeriods, visiblePeriods]);

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
    if (!regionId || visiblePeriods.length === 0) return;
    void loadDashboard();
  }, [loadDashboard, regionId, visiblePeriods.length]);

  async function saveRoom(values: RoomFormValues) {
    const payload = normalizeRoomForm(values);
    if (roomModal?.mode === 'edit' && roomModal.room) {
      await offlineLiveRoomService.updateRoom(roomModal.room.id, payload);
      setMessage('直播间已更新。');
    } else {
      await offlineLiveRoomService.createRoom(payload);
      setMessage('直播间已添加。');
    }
    setRoomModal(null);
    await loadDashboard();
  }

  async function deactivateRoom(room: OfflineLiveRoom) {
    await offlineLiveRoomService.deactivateRoom(room.id);
    setMessage('直播间已停用。');
    await loadDashboard();
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
      <header className="offline-live-room-header">
        <div>
          <span>管理</span>
          <h2>线下直播间管理</h2>
          <p>{activeRegion ? `${activeRegion.code || activeRegion.name} / ${formatDateRangeText(visiblePeriods[0]?.startIso ?? selectedRange.startIso, visiblePeriods[visiblePeriods.length - 1]?.endIso ?? selectedRange.endIso)}` : '读取区域中'}</p>
        </div>
        <div className="offline-live-room-header-actions">
          <button className="secondary-button compact-button" type="button" onClick={loadDashboard} disabled={busy || !regionId}>
            <RefreshCw size={16} /> 刷新
          </button>
          <button className="primary-button compact-button" type="button" onClick={() => setRoomModal({ mode: 'create', room: null })} disabled={!canUse || !regionId}>
            <Plus size={16} /> 添加直播间
          </button>
        </div>
      </header>

      {message ? <p className="form-success offline-live-room-alert">{message}</p> : null}
      {error ? <p className="form-alert offline-live-room-alert">{error}</p> : null}

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
      </section>

      <section className="offline-live-room-kpis">
        <KpiCard label="当前周期流水" value={<RevenuePair tiktok={dashboard.tiktokTotal} douyin={dashboard.douyinTotal} />} />
        <KpiCard label="已更新直播间" value={dashboard.updatedRoomCount} detail="全部主播平台已填写" tone="updated" />
        <KpiCard label="待更新直播间" value={dashboard.pendingRoomCount} detail="含未配置主播房间" tone="pending" />
        <KpiCard label="当前周期主播人数" value={dashboard.creatorCount} detail="按主播本人去重" />
      </section>

      <section className="offline-live-room-grid" aria-busy={busy}>
        {busy ? <div className="offline-live-room-state">正在读取直播间...</div> : null}
        {!busy && dashboard.rooms.length === 0 ? <div className="offline-live-room-state">暂无线下直播间</div> : null}
        {!busy ? dashboard.rooms.map((room) => (
          <RoomCard
            key={room.room.id}
            item={room}
            canUse={canUse}
            onEdit={() => setRoomModal({ mode: 'edit', room: room.room })}
            onDeactivate={() => void deactivateRoom(room.room)}
            onManageCreators={() => setAssignmentRoom(room)}
          />
        )) : null}
      </section>

      {roomModal ? (
        <RoomModal
          regions={regions}
          room={roomModal.room}
          defaultRegionId={regionId}
          saving={loading}
          onClose={() => setRoomModal(null)}
          onSubmit={(values) => void saveRoom(values)}
        />
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
      <b>TikTok {formatOfflineLiveRoomRevenue(tiktok)} <small>钻石</small></b>
      <b>抖音 {formatOfflineLiveRoomRevenue(douyin)} <small>音浪</small></b>
    </span>
  );
}

function RoomCard({ item, canUse, onEdit, onDeactivate, onManageCreators }: {
  item: OfflineLiveRoomDashboardRoom;
  canUse: boolean;
  onEdit: () => void;
  onDeactivate: () => void;
  onManageCreators: () => void;
}) {
  return (
    <article className={`offline-live-room-card offline-live-room-card--${item.status}`}>
      <div className="offline-live-room-card-head">
        <div>
          <span>{item.room.region?.code ?? item.room.region?.name ?? '-'}</span>
          <h3>{item.room.room_number}号直播间</h3>
          <p>{item.room.name}</p>
        </div>
        <StatusBadge status={item.status} />
      </div>

      <div className="offline-live-room-creator-list">
        {item.creators.length === 0 ? <p className="offline-live-room-empty-line">未配置主播</p> : null}
        {item.creators.map((creator) => (
          <div className="offline-live-room-creator" key={creator.entityId}>
            <strong>{creator.displayName}</strong>
            <div>
              {creator.profiles.map(({ profile, record, total }) => (
                <span key={profile.id} className={`offline-live-room-platform-line offline-live-room-platform-line--${profile.platform}`}>
                  <em>{platformLabels[profile.platform]}</em>
                  <b>{record ? formatOfflineLiveRoomRevenue(total) : '--'}</b>
                  <small>{getOfflineLiveRoomRevenueUnit(profile.platform)}</small>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="offline-live-room-card-total">
        <span>TikTok TOTAL <b>{formatOfflineLiveRoomRevenue(item.tiktokTotal)}</b> 钻石</span>
        <span>抖音 TOTAL <b>{formatOfflineLiveRoomRevenue(item.douyinTotal)}</b> 音浪</span>
      </div>

      <footer className="offline-live-room-card-footer">
        <span>最后更新：{item.latestUpdatedAt ? formatDateTime(item.latestUpdatedAt) : '--'}</span>
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

function StatusBadge({ status }: { status: OfflineLiveRoomUpdateStatus }) {
  return <span className={`offline-live-room-status offline-live-room-status--${status}`}>{statusLabels[status]}</span>;
}

function RoomModal({ regions, room, defaultRegionId, saving, onClose, onSubmit }: {
  regions: Region[];
  room: OfflineLiveRoom | null;
  defaultRegionId: string;
  saving: boolean;
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
      {error ? <p className="form-alert">{error}</p> : null}
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

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error && 'message' in error && typeof error.message === 'string') return error.message;
  return '操作失败。';
}
