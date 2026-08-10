import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { MonthSelect } from '../components/MonthSelect';
import { SystemModal } from '../components/SystemModal';
import { useAuth } from '../hooks/useAuth';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import {
  type CalendarLeaveType,
  type LeaveCalendarItem,
  type PublicHolidayCalendarItem,
  getMonthRange,
  scheduleService,
} from '../services/schedule.service';
import { type EmployeeListItem, staffService } from '../services/staff.service';
import type { Region } from '../types/database';

const leaveTypeLabels: Record<CalendarLeaveType, string> = {
  annual: '年假',
  medical: '病假',
  unpaid: '无薪假',
  replacement: '调休',
};

const cancellationReasons = ['人员取消申请', '录入错误', '重复申请', 'HR调整', '其他'] as const;
const leaveTypeOptions = Object.keys(leaveTypeLabels) as CalendarLeaveType[];

type CalendarDayItem =
  { type: 'public-holiday'; holiday: PublicHolidayCalendarItem } |
  { type: 'leave'; leave: LeaveCalendarItem };

type EmployeeSelection = 'all' | string[];

export function SchedulePage() {
  const { profile } = useAuth();
  const [month, setMonth] = useState(getCurrentRestCycle());
  const [regionId, setRegionId] = useState('');
  const [regions, setRegions] = useState<Region[]>([]);
  const [leaves, setLeaves] = useState<LeaveCalendarItem[]>([]);
  const [publicHolidays, setPublicHolidays] = useState<PublicHolidayCalendarItem[]>([]);
  const [employees, setEmployees] = useState<EmployeeListItem[]>([]);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<EmployeeSelection>('all');
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [selectedLeaveTypes, setSelectedLeaveTypes] = useState<CalendarLeaveType[]>(leaveTypeOptions);
  const [peopleFilterOpen, setPeopleFilterOpen] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedLeave, setSelectedLeave] = useState<LeaveCalendarItem | null>(null);
  const [cancellingLeave, setCancellingLeave] = useState<LeaveCalendarItem | null>(null);
  const [cancelReason, setCancelReason] = useState<(typeof cancellationReasons)[number]>('人员取消申请');
  const [customCancelReason, setCustomCancelReason] = useState('');
  const [canCancelLeaves, setCanCancelLeaves] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const canViewAllRegions = profile?.role === 'super_admin' || Boolean(profile?.can_view_all_regions);
  const monthRange = useMemo(() => getMonthRange(month), [month]);
  const calendarCells = useMemo(
    () => getCalendarCells(monthRange.startDate, monthRange.endDate),
    [monthRange.startDate, monthRange.endDate],
  );
  const employeeOptions = useMemo(() => {
    const currentDisplayName = getDisplayName(profile?.nickname, profile?.full_name);
    const options = employees
      .filter((employee) => !regionId || employee.region_id === regionId)
      .map((employee) => ({
        id: employee.id,
        name: getDisplayName(employee.nickname, employee.full_name),
        fullName: employee.full_name,
        employeeCode: employee.employee_code,
        regionCode: employee.region?.code ?? null,
      }));

    return options.sort((first, second) => {
      const firstIsCurrent = currentDisplayName && first.name === currentDisplayName;
      const secondIsCurrent = currentDisplayName && second.name === currentDisplayName;

      if (firstIsCurrent && !secondIsCurrent) return -1;
      if (!firstIsCurrent && secondIsCurrent) return 1;

      return first.name.localeCompare(second.name, 'zh-CN');
    });
  }, [employees, profile?.full_name, profile?.nickname, regionId]);
  const visibleEmployeeOptions = useMemo(() => {
    const keyword = employeeSearch.trim().toLowerCase();
    if (!keyword) return employeeOptions;

    return employeeOptions.filter((employee) =>
      [employee.name, employee.fullName, employee.employeeCode, employee.regionCode].filter(Boolean).join(' ').toLowerCase().includes(keyword),
    );
  }, [employeeOptions, employeeSearch]);
  const activeEmployeeIds = selectedEmployeeIds === 'all' ? employeeOptions.map((employee) => employee.id) : selectedEmployeeIds;
  const peopleSummary = useMemo(() => {
    if (selectedEmployeeIds === 'all') {
      return '所有人';
    }

    const selectedEmployees = employeeOptions.filter((employee) => activeEmployeeIds.includes(employee.id));
    if (selectedEmployees.length === 1) return selectedEmployees[0].name;
    if (selectedEmployees.length > 1) return `${selectedEmployees[0].name} +${selectedEmployees.length - 1}`;

    return '未选择人员';
  }, [activeEmployeeIds, employeeOptions, selectedEmployeeIds]);
  const leaveTypeFilterValue = selectedLeaveTypes.length === leaveTypeOptions.length ? '' : selectedLeaveTypes[0];
  const filteredLeaves = useMemo(
    () =>
      leaves.filter(
        (leave) => activeEmployeeIds.includes(leave.employee_id) && selectedLeaveTypes.includes(leave.leave_type),
      ),
    [activeEmployeeIds, leaves, selectedLeaveTypes],
  );
  const leavesByDate = useMemo(() => {
    const map = new Map<string, LeaveCalendarItem[]>();

    filteredLeaves.forEach((leave) => {
      const current = map.get(leave.leave_date) ?? [];
      current.push(leave);
      current.sort((a, b) => a.employee_name.localeCompare(b.employee_name, 'zh-CN'));
      map.set(leave.leave_date, current);
    });

    return map;
  }, [filteredLeaves]);
  const publicHolidaysByDate = useMemo(() => {
    const map = new Map<string, PublicHolidayCalendarItem[]>();

    publicHolidays.forEach((holiday) => {
      const current = map.get(holiday.holiday_date) ?? [];
      current.push(holiday);
      current.sort((a, b) => a.holiday_name.localeCompare(b.holiday_name, 'zh-CN'));
      map.set(holiday.holiday_date, current);
    });

    return map;
  }, [publicHolidays]);
  const selectedDayItems = selectedDay ? getCalendarDayItems(publicHolidaysByDate, leavesByDate, selectedDay) : [];

  useEffect(() => {
    void loadLeaveCalendar();
  }, [month, regionId]);

  usePullToRefresh(async () => {
    await Promise.all([loadLeaveCalendar(), loadEmployees(), loadCancelPermission()]);
  }, [month, regionId, profile?.id]);

  useEffect(() => {
    void loadCancelPermission();
  }, [profile?.id]);

  useEffect(() => {
    void loadEmployees();
  }, []);

  useEffect(() => {
    if (selectedEmployeeIds === 'all') return;

    const availableIds = new Set(employeeOptions.map((employee) => employee.id));
    setSelectedEmployeeIds((current) => {
      if (current === 'all') return current;

      const nextIds = current.filter((employeeId) => availableIds.has(employeeId));
      return nextIds.length === current.length ? current : nextIds;
    });
  }, [employeeOptions, selectedEmployeeIds]);

  async function loadLeaveCalendar() {
    setLoading(true);
    setError('');

    try {
      const data = await scheduleService.getLeaveCalendar(month, regionId);
      setLeaves(data.leaves);
      setPublicHolidays(data.publicHolidays);
      setRegions(data.regions);
    } catch (loadError) {
      setError(`读取休假日历失败：${getErrorMessage(loadError)}`);
    } finally {
      setLoading(false);
    }
  }

  async function loadEmployees() {
    try {
      const staffList = await staffService.listEmployees();
      setEmployees(staffList);
    } catch (loadError) {
      setError(`读取工作人员失败：${getErrorMessage(loadError)}`);
    }
  }

  async function loadCancelPermission() {
    try {
      const allowed = await scheduleService.canCancelCalendarLeave();
      setCanCancelLeaves(allowed);
    } catch {
      setCanCancelLeaves(false);
    }
  }

  function toggleEmployee(employeeId: string) {
    const currentIds = selectedEmployeeIds === 'all' ? employeeOptions.map((employee) => employee.id) : selectedEmployeeIds;
    const nextIds = currentIds.includes(employeeId)
      ? currentIds.filter((id) => id !== employeeId)
      : [...currentIds, employeeId];

    setSelectedEmployeeIds(nextIds.length === employeeOptions.length ? 'all' : nextIds);
  }

  function openCancelModal(leave: LeaveCalendarItem) {
    if (!canCancelLeaves) return;

    setCancelReason('人员取消申请');
    setCustomCancelReason('');
    setCancellingLeave(leave);
  }

  async function handleConfirmCancel() {
    if (!cancellingLeave) return;

    const reason = cancelReason === '其他' ? customCancelReason.trim() : cancelReason;
    if (!reason) {
      setError('请填写取消原因。');
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');

    try {
      await scheduleService.cancelLeaveCalendarItem(cancellingLeave, reason);
      setMessage('假期已取消。');
      setCancellingLeave(null);
      setSelectedLeave(null);
      await loadLeaveCalendar();
    } catch (cancelError) {
      setError(`取消假期失败：${getErrorMessage(cancelError)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="schedule-page">
      {error ? <p className="form-alert">{error}</p> : null}
      {message ? <p className="form-success">{message}</p> : null}

      <div className="staff-list-panel schedule-filter-panel">
        <div className="attendance-filters schedule-v2-filters">
          <label className="form-field">
            <span>月份</span>
            <MonthSelect value={month} onChange={setMonth} />
          </label>

          <label className="form-field">
            <span>区域</span>
            <select
              value={regionId}
              disabled={!canViewAllRegions}
              onChange={(event) => setRegionId(event.target.value)}
            >
              <option value="">全部可查看区域</option>
              {regions.map((region) => (
                <option key={region.id} value={region.id}>
                  {region.code}
                </option>
              ))}
            </select>
          </label>

          <div className="form-field schedule-filter-box">
            <span>所有人</span>
            <button className="filter-modal-trigger" type="button" onClick={() => setPeopleFilterOpen(true)}>
              <span>{peopleSummary}</span>
              <ChevronDown size={16} />
            </button>
          </div>

          <div className="form-field schedule-filter-box">
            <span>假别</span>
            <select
              value={leaveTypeFilterValue}
              onChange={(event) => {
                const nextValue = event.target.value as CalendarLeaveType | '';
                setSelectedLeaveTypes(nextValue ? [nextValue] : leaveTypeOptions);
              }}
            >
              <option value="">全部假别</option>
              {leaveTypeOptions.map((type) => (
                <option key={type} value={type}>
                  {leaveTypeLabels[type]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="leave-calendar-legend" aria-label="假期类型颜色">
          <span className="leave-chip leave-type-public-holiday">公共假期（PH）</span>
          {leaveTypeOptions.map((type) => (
            <span className={`leave-chip leave-type-${type}`} key={type}>
              {leaveTypeLabels[type]}
            </span>
          ))}
        </div>
      </div>

      <div className="staff-list-panel schedule-calendar-panel">
        {loading ? (
          <div className="table-state">正在读取休假日历...</div>
        ) : (
          <div className="leave-calendar-grid">
            {calendarCells.map((date, index) => {
              if (!date) {
                return <div className="leave-calendar-empty" key={`empty-${index}`} />;
              }

              const dayItems = getCalendarDayItems(publicHolidaysByDate, leavesByDate, date);
              const visibleItems = dayItems.slice(0, 3);
              const hiddenCount = Math.max(dayItems.length - visibleItems.length, 0);
              const weekend = isWeekend(date);

              return (
                <article className={weekend ? 'leave-calendar-day weekend-day' : 'leave-calendar-day'} key={date}>
                  <header>
                    <strong>{formatDayMonth(date)}</strong>
                    <span>{weekdayLabel(date)}</span>
                  </header>

                  {dayItems.length === 0 ? (
                    <p>暂无休假</p>
                  ) : (
                    <div className="leave-calendar-list">
                      {visibleItems.map((item) =>
                        item.type === 'public-holiday' ? (
                          <span className="leave-chip leave-type-public-holiday" key={`holiday:${item.holiday.id}`}>
                            {item.holiday.holiday_name}
                          </span>
                        ) : (
                          <button
                            type="button"
                            className={`leave-chip leave-type-${item.leave.leave_type}`}
                            key={`${item.leave.leave_request_id}:${item.leave.leave_date}:${item.leave.employee_id}`}
                            onClick={() => setSelectedLeave(item.leave)}
                          >
                            {item.leave.employee_name}（{leaveTypeLabels[item.leave.leave_type]}）
                          </button>
                        ),
                      )}
                      {hiddenCount > 0 ? (
                        <button type="button" className="leave-more-button" onClick={() => setSelectedDay(date)}>
                          +{hiddenCount}
                        </button>
                      ) : null}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>

      {peopleFilterOpen ? (
        <SystemModal
          title="所有人"
          ariaLabel="选择人员"
          onClose={() => setPeopleFilterOpen(false)}
          footer={<button className="secondary-button compact-button" type="button" onClick={() => setPeopleFilterOpen(false)}>关闭</button>}
        >
          <label className="filter-search modal-filter-search">
            <Search size={16} />
            <input
              type="search"
              placeholder="搜索姓名 / 昵称"
              value={employeeSearch}
              onChange={(event) => setEmployeeSearch(event.target.value)}
            />
          </label>
          <div className="filter-check-list modal-filter-list">
            <label className="filter-check-row">
              <input
                type="checkbox"
                checked={selectedEmployeeIds === 'all'}
                onChange={(event) => setSelectedEmployeeIds(event.target.checked ? 'all' : [])}
              />
              <span>所有人</span>
            </label>
            {visibleEmployeeOptions.length === 0 ? (
              <span className="filter-empty">暂无人员</span>
            ) : (
              visibleEmployeeOptions.map((employee) => (
                <label className="filter-check-row" key={employee.id}>
                  <input
                    type="checkbox"
                    checked={activeEmployeeIds.includes(employee.id)}
                    onChange={() => toggleEmployee(employee.id)}
                  />
                  <span>{employee.name}</span>
                  {employee.regionCode ? <em>{employee.regionCode}</em> : null}
                </label>
              ))
            )}
          </div>
        </SystemModal>
      ) : null}

      {selectedDay ? (
        <SystemModal
          title={`${formatDateLabel(selectedDay)}休假名单`}
          ariaLabel="休假名单"
          onClose={() => setSelectedDay(null)}
          footer={<button className="secondary-button compact-button" type="button" onClick={() => setSelectedDay(null)}>关闭</button>}
        >
          <div className="leave-day-list">
            {selectedDayItems.map((item) =>
              item.type === 'public-holiday' ? (
                <div className="leave-day-row" key={`holiday:${item.holiday.id}`}>
                  <strong>{item.holiday.holiday_name}</strong>
                  <span className="leave-chip leave-type-public-holiday">PH</span>
                </div>
              ) : (
                <button
                  type="button"
                  className="leave-day-row"
                  key={`${item.leave.leave_request_id}:${item.leave.leave_date}:${item.leave.employee_id}`}
                  onClick={() => {
                    setSelectedDay(null);
                    setSelectedLeave(item.leave);
                  }}
                >
                  <strong>{item.leave.employee_name}</strong>
                  <span className={`leave-chip leave-type-${item.leave.leave_type}`}>{leaveTypeLabels[item.leave.leave_type]}</span>
                </button>
              ),
            )}
          </div>
        </SystemModal>
      ) : null}

      {selectedLeave ? (
        <SystemModal
          title="休假详情"
          ariaLabel="休假详情"
          onClose={() => setSelectedLeave(null)}
          footer={
            <>
              <button className="secondary-button compact-button" type="button" onClick={() => setSelectedLeave(null)}>
                关闭
              </button>
              {canCancelLeaves ? (
                <button className="secondary-button compact-button danger-text-button" type="button" onClick={() => openCancelModal(selectedLeave)}>
                  取消假期
                </button>
              ) : null}
            </>
          }
        >
          <DetailGrid
            items={[
              ['人员', selectedLeave.employee_name],
              ['区域', selectedLeave.region_code],
              ['假别', leaveTypeLabels[selectedLeave.leave_type]],
              [selectedLeave.leave_type === 'replacement' ? '补班日期' : '开始日期', selectedLeave.start_date],
              [selectedLeave.leave_type === 'replacement' ? '调休日期' : '结束日期', selectedLeave.end_date],
              ['申请人', selectedLeave.applicant_name],
              ['审核人', selectedLeave.reviewer_name],
              ['审核时间', formatDateTime(selectedLeave.reviewed_at)],
            ]}
          />
        </SystemModal>
      ) : null}

      {cancellingLeave ? (
        <SystemModal
          title="确认取消假期"
          ariaLabel="确认取消假期"
          onClose={() => setCancellingLeave(null)}
          footer={
            <>
              <button className="secondary-button compact-button" type="button" onClick={() => setCancellingLeave(null)} disabled={saving}>
                关闭
              </button>
              <button className="primary-button compact-button" type="button" onClick={handleConfirmCancel} disabled={saving}>
                确认取消
              </button>
            </>
          }
        >
          <div className="cancel-leave-confirm">
            <p>
              确定要取消{cancellingLeave.employee_name}
              <br />
              {cancellingLeave.leave_date} 的{leaveTypeLabels[cancellingLeave.leave_type]}吗？
            </p>

            <label className="form-field">
              <span>取消原因</span>
              <select value={cancelReason} onChange={(event) => setCancelReason(event.target.value as typeof cancelReason)}>
                {cancellationReasons.map((reason) => (
                  <option key={reason} value={reason}>
                    {reason}
                  </option>
                ))}
              </select>
            </label>

            {cancelReason === '其他' ? (
              <label className="form-field">
                <span>其他原因</span>
                <textarea value={customCancelReason} onChange={(event) => setCustomCancelReason(event.target.value)} rows={3} />
              </label>
            ) : null}
          </div>
        </SystemModal>
      ) : null}
    </section>
  );
}

function DetailGrid({ items }: { items: Array<[string, string | null | undefined]> }) {
  return (
    <div className="modal-detail-grid">
      {items.map(([label, value]) => (
        <div className="modal-detail-item" key={label}>
          <span>{label}</span>
          <strong>{value?.trim() || '未填写'}</strong>
        </div>
      ))}
    </div>
  );
}

function getCurrentRestCycle() {
  const now = new Date();
  return `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, '0')}`;
}

function getCalendarCells(startDate: string, endDate: string) {
  const date = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  const dates: Array<string | null> = [];
  const mondayOffset = (date.getDay() + 6) % 7;

  for (let index = 0; index < mondayOffset; index += 1) {
    dates.push(null);
  }

  while (date <= end) {
    dates.push(toDateKey(date));
    date.setDate(date.getDate() + 1);
  }

  return dates;
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function weekdayLabel(date: string) {
  return new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(new Date(`${date}T00:00:00`));
}

function formatDayMonth(date: string) {
  const value = new Date(`${date}T00:00:00`);
  return `${String(value.getDate()).padStart(2, '0')}/${value.getMonth() + 1}`;
}

function formatDateLabel(date: string) {
  const value = new Date(`${date}T00:00:00`);
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(value);
}

function getCalendarDayItems(
  publicHolidaysByDate: Map<string, PublicHolidayCalendarItem[]>,
  leavesByDate: Map<string, LeaveCalendarItem[]>,
  date: string,
): CalendarDayItem[] {
  const holidays = (publicHolidaysByDate.get(date) ?? []).map((holiday) => ({
    type: 'public-holiday' as const,
    holiday,
  }));
  const leaveItems = (leavesByDate.get(date) ?? []).map((leave) => ({
    type: 'leave' as const,
    leave,
  }));

  return [...holidays, ...leaveItems];
}

function isWeekend(date: string) {
  const day = new Date(`${date}T00:00:00`).getDay();
  return day === 0 || day === 6;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '';

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function getDisplayName(nickname?: string | null, fullName?: string | null) {
  return nickname?.trim() || fullName?.trim() || '';
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;

    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }

  return '未知错误';
}
