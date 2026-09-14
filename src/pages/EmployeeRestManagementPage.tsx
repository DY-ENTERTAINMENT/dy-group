import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Coffee, Eye } from 'lucide-react';
import { SystemModal } from '../components/SystemModal';
import type { AttendanceEmployee, AttendancePeriodData } from '../services/attendanceManagement.service';
import { getEmployeeRestManagementDayData } from '../services/employee-rest-management.service';
import type { AttendanceRecord } from '../types/database';
import { createEffectiveAttendanceDayResolver, MALAYSIA_TIME_ZONE, malaysiaDateKey } from '../utils/attendance-effective-day';

type TodayStatus = 'not_started' | 'in_progress' | 'completed';
type MonthlyStatus = 'completed' | 'missed' | 'unfinished' | 'observing';
type DayRow = { date: string; employee: AttendanceEmployee; start: AttendanceRecord | null; end: AttendanceRecord | null; todayStatus: TodayStatus; monthlyStatus: MonthlyStatus; duration: number | null; outsideWorkHours: boolean };
type Summary = { employee: AttendanceEmployee; rows: DayRow[]; completed: number; missed: number; unfinished: number; observing: number; avgStart: number | null; avgEnd: number | null; avgDuration: number | null };

const todayLabels: Record<TodayStatus, string> = { not_started: '未休息', in_progress: '休息中', completed: '已休息' };
const monthlyLabels: Record<MonthlyStatus, string> = { completed: '已休息', missed: '未休息', unfinished: '未结束', observing: '待观察' };

export function EmployeeRestManagementPage() {
  const today = malaysiaDateKey(new Date());
  const [date, setDate] = useState(today);
  const [regionId, setRegionId] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<TodayStatus | ''>('');
  const [data, setData] = useState<AttendancePeriodData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => { void load(); }, [date, regionId]);
  useEffect(() => { setStatus(''); }, [date]);
  async function load() { setLoading(true); setError(''); try { setData(await getEmployeeRestManagementDayData(date, regionId)); } catch (reason) { setError(reason instanceof Error ? reason.message : '读取休息记录失败。'); } finally { setLoading(false); } }

  const dates = useMemo(() => [date], [date]);
  const rows = useMemo(() => data ? buildRows(data, dates, today) : [], [data, dates, today]);
  const displayedRows = rows.filter((row) => (!status || row.todayStatus === status) && matches(row.employee, search)).sort(compareToday);
  const todayCounts = { total: rows.length, notStarted: rows.filter((row) => row.todayStatus === 'not_started').length, inProgress: rows.filter((row) => row.todayStatus === 'in_progress').length, completed: rows.filter((row) => row.todayStatus === 'completed').length };
  const toggleStatus = (value: TodayStatus) => setStatus((current) => current === value ? '' : value);

  return <section className="employee-rest-management-page">
    <div className="attendance-filters rest-management-filters">
      <label className="form-field"><span>日期</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} max={today} /></label>
      <label className="form-field"><span>区域</span><select value={regionId} onChange={(event) => setRegionId(event.target.value)}><option value="">全部可查看区域</option>{data?.regions.map((region) => <option key={region.id} value={region.id}>{region.code}</option>)}</select></label>
      <label className="form-field"><span>状态</span><select value={status} onChange={(event) => setStatus(event.target.value as TodayStatus | '')}><option value="">全部状态</option>{Object.entries(todayLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="form-field rest-search-field"><span>员工搜索</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="姓名或职位" /></label>
    </div>
    {error ? <p className="form-alert">{error}</p> : null}
    <div className="rest-stat-grid"><Stat label="今日考勤" value={todayCounts.total} active={!status} onClick={() => setStatus('')} /><Stat label="未休息" value={todayCounts.notStarted} active={status === 'not_started'} onClick={() => toggleStatus('not_started')} /><Stat label="休息中" value={todayCounts.inProgress} active={status === 'in_progress'} onClick={() => toggleStatus('in_progress')} /><Stat label="已休息" value={todayCounts.completed} active={status === 'completed'} onClick={() => toggleStatus('completed')} /></div>
    <TodayList rows={displayedRows} loading={loading} />
  </section>;
}

function buildRows(data: AttendancePeriodData, dates: string[], today: string): DayRow[] {
  const resolver = createEffectiveAttendanceDayResolver({ leaves: data.leaveRequests, restDays: data.restDays, holidays: data.publicHolidays, activities: data.companyActivities, replacementChanges: data.effectiveReplacementWorkChanges, dates });
  const records = new Map<string, AttendanceRecord[]>(); const workTimes = new Map(data.effectiveWorkTimes.map((item) => [`${item.employee_id}:${item.work_date}`, item]));
  data.attendanceRecords.forEach((record) => { if (!record.employee_id) return; const key = `${record.employee_id}:${malaysiaDateKey(record.punched_at)}`; records.set(key, [...(records.get(key) ?? []), record]); });
  return data.employees.flatMap((employee) => dates.filter((date) => resolver(employee, date).requiresAttendance).map((date) => {
    const day = [...(records.get(`${employee.id}:${date}`) ?? [])].sort((a, b) => +new Date(a.punched_at) - +new Date(b.punched_at));
    const start = day.find((record) => record.punch_type === 'break_start') ?? null; const end = day.find((record) => record.punch_type === 'break_end') ?? null;
    const workTime = workTimes.get(`${employee.id}:${date}`); const startWork = workTime?.effective_start_time ?? employee.start_work_time; const endWork = workTime?.effective_end_time ?? employee.end_work_time;
    const duration = start && end ? minutesBetween(start.punched_at, end.punched_at) : null;
    const outsideWorkHours = Boolean(start && startWork && endWork && (minutesOfDay(start.punched_at) < minutesFromTime(startWork) || minutesOfDay(start.punched_at) > minutesFromTime(endWork)));
    const todayStatus: TodayStatus = !start ? 'not_started' : !end ? 'in_progress' : 'completed';
    const monthlyStatus: MonthlyStatus = start && end ? 'completed' : start ? 'unfinished' : date === today && endWork && malaysiaNowMinutes() < minutesFromTime(endWork) ? 'observing' : 'missed';
    return { date, employee, start, end, todayStatus, monthlyStatus, duration, outsideWorkHours };
  }));
}

function buildSummaries(rows: DayRow[]): Summary[] { const groups = new Map<string, DayRow[]>(); rows.forEach((row) => groups.set(row.employee.id, [...(groups.get(row.employee.id) ?? []), row])); return [...groups.values()].map((employeeRows) => ({ employee: employeeRows[0].employee, rows: employeeRows, completed: employeeRows.filter((row) => row.monthlyStatus === 'completed').length, missed: employeeRows.filter((row) => row.monthlyStatus === 'missed').length, unfinished: employeeRows.filter((row) => row.monthlyStatus === 'unfinished').length, observing: employeeRows.filter((row) => row.monthlyStatus === 'observing').length, avgStart: average(employeeRows.filter((row) => row.start).map((row) => minutesOfDay(row.start!.punched_at))), avgEnd: average(employeeRows.filter((row) => row.end).map((row) => minutesOfDay(row.end!.punched_at))), avgDuration: average(employeeRows.filter((row) => row.duration !== null).map((row) => row.duration!)) })); }
function overallAverages(rows: DayRow[]) { return { start: average(rows.filter((row) => row.start).map((row) => minutesOfDay(row.start!.punched_at))), end: average(rows.filter((row) => row.end).map((row) => minutesOfDay(row.end!.punched_at))), duration: average(rows.filter((row) => row.duration !== null).map((row) => row.duration!)) }; }

function TodayList({ rows, loading }: { rows: DayRow[]; loading: boolean }) { return <div className="staff-list-panel">{loading ? <div className="table-state">正在读取休息数据...</div> : <><div className="staff-table-wrap rest-desktop"><table className="staff-table"><thead><tr><th>员工</th><th>职位</th><th>区域</th><th>开始休息</th><th>结束休息</th><th>休息时长</th><th>当前状态</th></tr></thead><tbody>{rows.map((row) => <tr key={row.employee.id}><td><EmployeeCell employee={row.employee} /></td><td>{row.employee.job_title?.name ?? '-'}</td><td>{row.employee.region?.code ?? '-'}</td><td>{time(row.start?.punched_at)}</td><td>{time(row.end?.punched_at)}</td><td>{formatDuration(row.duration)}</td><td><StatusBadges row={row} today /></td></tr>)}</tbody></table></div><div className="rest-mobile">{rows.map((row) => <article className="rest-card" key={row.employee.id}><EmployeeCell employee={row.employee} /><span>{row.employee.job_title?.name ?? '-'} · {row.employee.region?.code ?? '-'}</span><StatusBadges row={row} today /><div>开始休息：{time(row.start?.punched_at)}</div><div>结束休息：{time(row.end?.punched_at)}</div><div>休息时长：{formatDuration(row.duration)}</div></article>)}</div></>}</div> }
function MonthlyList({ rows, loading, onOpen }: { rows: Summary[]; loading: boolean; onOpen: (summary: Summary, filter?: MonthlyStatus | '') => void }) { return <div className="staff-list-panel">{loading ? <div className="table-state">正在读取月度记录...</div> : <><div className="staff-table-wrap rest-desktop"><table className="staff-table"><thead><tr><th>员工</th><th>职位</th><th>区域</th><th>考勤日</th><th>已完成</th><th>未休息</th><th>未结束</th><th>平均开始</th><th>平均结束</th><th>平均时长</th><th>详情</th></tr></thead><tbody>{rows.map((summary) => <tr key={summary.employee.id}><td><EmployeeCell employee={summary.employee} /></td><td>{summary.employee.job_title?.name ?? '-'}</td><td>{summary.employee.region?.code ?? '-'}</td><td>{summary.rows.length}</td><td><button className="text-link-button" onClick={() => onOpen(summary, 'completed')}>{summary.completed}</button></td><td><button className="text-link-button" onClick={() => onOpen(summary, 'missed')}>{summary.missed}</button></td><td><button className="text-link-button" onClick={() => onOpen(summary, 'unfinished')}>{summary.unfinished}</button></td><td>{formatMinute(summary.avgStart)}</td><td>{formatMinute(summary.avgEnd)}</td><td>{formatDuration(summary.avgDuration)}</td><td><button className="secondary-button compact-button" onClick={() => onOpen(summary)}><Eye size={15} />查看</button></td></tr>)}</tbody></table></div><div className="rest-mobile">{rows.map((summary) => <article className="rest-card" key={summary.employee.id}><EmployeeCell employee={summary.employee} /><span>{summary.employee.job_title?.name ?? '-'} · {summary.employee.region?.code ?? '-'}</span><strong className="rest-alert-counts">未休息 {summary.missed}　未结束 {summary.unfinished}</strong><span>考勤日 {summary.rows.length} · 已完成 {summary.completed}{summary.observing ? ` · 待观察 ${summary.observing}` : ''}</span><span>平均开始 {formatMinute(summary.avgStart)}<br />平均结束 {formatMinute(summary.avgEnd)} · 平均时长 {formatDuration(summary.avgDuration)}</span><button className="secondary-button compact-button" onClick={() => onOpen(summary)}>查看详情</button></article>)}</div></>}</div> }
function Detail({ summary, filter, onClose }: { summary: Summary; filter: MonthlyStatus | ''; onClose: () => void }) { const rows = filter ? summary.rows.filter((row) => row.monthlyStatus === filter) : summary.rows; return <SystemModal title={summary.employee.full_name} subtitle="月度休息详情" ariaLabel="月度休息详情" onClose={onClose}><div className="rest-detail-head"><EmployeeCell employee={summary.employee} /><span>{summary.employee.job_title?.name ?? '-'} · {summary.employee.region?.code ?? '-'}</span></div><div className="rest-detail-summary"><span>考勤日 {summary.rows.length}</span><span>已完成 {summary.completed}</span><span>未休息 {summary.missed}</span><span>未结束 {summary.unfinished}</span><span>平均开始 {formatMinute(summary.avgStart)}</span><span>平均结束 {formatMinute(summary.avgEnd)}</span><span>平均时长 {formatDuration(summary.avgDuration)}</span></div><div className="staff-table-wrap"><table className="staff-table"><thead><tr><th>日期</th><th>当日考勤状态</th><th>开始</th><th>结束</th><th>时长</th><th>休息状态</th></tr></thead><tbody>{rows.map((row) => <tr key={row.date}><td>{row.date}</td><td>有效考勤日</td><td>{time(row.start?.punched_at)}</td><td>{time(row.end?.punched_at)}</td><td>{formatDuration(row.duration)}</td><td><StatusBadges row={row} /></td></tr>)}</tbody></table></div></SystemModal> }
function EmployeeCell({ employee }: { employee: AttendanceEmployee }) { return <span className="rest-employee-cell"><Avatar employee={employee} /><strong title={employee.full_name}>{employee.full_name}</strong></span> }
function Avatar({ employee }: { employee: AttendanceEmployee }) { return <span className="employee-avatar">{employee.avatar_url ? <img src={employee.avatar_url} alt="" /> : employee.full_name.slice(0, 1)}</span> }
function StatusBadges({ row, today = false }: { row: DayRow; today?: boolean }) { return <span className="rest-status-badges"><span className={`status-pill rest-${today ? row.todayStatus : row.monthlyStatus}`}>{today ? todayLabels[row.todayStatus] : monthlyLabels[row.monthlyStatus]}</span>{row.outsideWorkHours ? <span className="status-pill rest-outside-hours"><AlertTriangle size={13} />非工作时段休息</span> : null}</span> }
function Stat({ label, value, active, onClick }: { label: string; value: number; active?: boolean; onClick?: () => void }) { return <button type="button" className={`rest-stat ${active ? 'active' : ''}`} onClick={onClick}><Coffee size={18} /><span>{label}</span><strong>{value}</strong></button> }
function TimeStat({ label, value, duration = false }: { label: string; value: number | null; duration?: boolean }) { return <div className="rest-stat"><Coffee size={18} /><span>{label}</span><strong>{duration ? formatDuration(value) : formatMinute(value)}</strong></div> }
function monthDatesThroughToday(month: string, today: string) { if (month > today.slice(0, 7)) return []; const [year, monthNumber] = month.split('-').map(Number); const maxDay = month === today.slice(0, 7) ? Number(today.slice(8, 10)) : new Date(year, monthNumber, 0).getDate(); return Array.from({ length: maxDay }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`); }
function matches(employee: AttendanceEmployee, query: string) { const value = query.trim().toLowerCase(); return !value || [employee.full_name, employee.nickname, employee.job_title?.name, employee.region?.code].some((item) => item?.toLowerCase().includes(value)); }
function compareToday(a: DayRow, b: DayRow) { const rank: Record<TodayStatus, number> = { in_progress: 0, not_started: 1, completed: 2 }; return Number(b.outsideWorkHours) - Number(a.outsideWorkHours) || rank[a.todayStatus] - rank[b.todayStatus] || a.employee.full_name.localeCompare(b.employee.full_name); }
function compareSummary(a: Summary, b: Summary) { return b.missed - a.missed || b.unfinished - a.unfinished || a.employee.full_name.localeCompare(b.employee.full_name); }
function malaysiaNowMinutes() { const parts = new Intl.DateTimeFormat('en-GB', { timeZone: MALAYSIA_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()); return Number(parts.find((part) => part.type === 'hour')?.value ?? 0) * 60 + Number(parts.find((part) => part.type === 'minute')?.value ?? 0); }
function minutesOfDay(value: string) { const parts = new Intl.DateTimeFormat('en-GB', { timeZone: MALAYSIA_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value)); return Number(parts.find((part) => part.type === 'hour')?.value ?? 0) * 60 + Number(parts.find((part) => part.type === 'minute')?.value ?? 0); }
function minutesFromTime(value: string) { const [hour, minute] = value.slice(0, 5).split(':').map(Number); return hour * 60 + minute; }
function minutesBetween(start: string, end: string) { return Math.max(0, Math.round((+new Date(end) - +new Date(start)) / 60000)); }
function average(values: number[]) { return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null; }
function time(value?: string) { return value ? new Intl.DateTimeFormat('zh-CN', { timeZone: MALAYSIA_TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '--'; }
function formatMinute(value: number | null) { if (value === null) return '--'; const rounded = Math.round(value); return `${String(Math.floor(rounded / 60) % 24).padStart(2, '0')}:${String(rounded % 60).padStart(2, '0')}`; }
function formatDuration(value: number | null) { return value === null ? '--' : `${Math.floor(value / 60)}小时${Math.round(value % 60)}分`; }
