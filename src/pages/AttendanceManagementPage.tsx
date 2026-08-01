import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, Eye, RefreshCw } from 'lucide-react';
import { MonthSelect } from '../components/MonthSelect';
import { SystemModal } from '../components/SystemModal';
import { useAuth } from '../hooks/useAuth';
import { usePermissions } from '../hooks/usePermissions';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import {
  AttendanceEmployee,
  AttendanceRestDay,
  attendanceManagementService,
  getAttendancePeriodRange,
} from '../services/attendanceManagement.service';
import type { AttendanceRecord, LeaveRequest, LeaveType, PublicHoliday, Region } from '../types/database';

type DailyRecord = {
  date: string;
  clockIn: AttendanceRecord | null;
  breakStart: AttendanceRecord | null;
  breakEnd: AttendanceRecord | null;
  clockOut: AttendanceRecord | null;
  workHours: number | null;
  breakMinutes: number;
  status: string;
};

type EmployeeAttendanceSummary = {
  employee: AttendanceEmployee;
  lateCount: number;
  earlyLeaveCount: number;
  absentCount: number;
  overtimeBreakCount: number;
  abnormalPunchCount: number;
  leaveCounts: Record<LeaveType, number>;
  dailyRecords: DailyRecord[];
  abnormalRecords: AbnormalRecord[];
};

type AbnormalRecord = {
  id: string;
  employee: AttendanceEmployee;
  type: string;
  punchedAt: string;
  gps: string;
  ip: string;
  deviceInfo: string;
  photoPath: string;
};

const leaveTypeLabels: Record<LeaveType, string> = {
  annual: '年假',
  medical: '病假',
  unpaid: '无薪假',
  replacement: '换休假',
};

export function AttendanceManagementPage() {
  const { profile } = useAuth();
  const permissions = usePermissions();
  const canUseAttendance = permissions.canUse('attendance-management');
  const [month, setMonth] = useState(getCurrentMonth());
  const [regionId, setRegionId] = useState('');
  const [regions, setRegions] = useState<Region[]>([]);
  const [summaries, setSummaries] = useState<EmployeeAttendanceSummary[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [showAbnormalCenter, setShowAbnormalCenter] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const canViewAllRegions = profile?.role === 'super_admin' || Boolean(profile?.can_view_all_regions);
  const range = useMemo(() => getAttendancePeriodRange(month), [month]);
  const selectedSummary = summaries.find((summary) => summary.employee.id === selectedEmployeeId) ?? null;
  const abnormalRecords = summaries.flatMap((summary) => summary.abnormalRecords);
  const abnormalEmployeeCount = summaries.filter((summary) => summary.abnormalPunchCount > 0).length;

  useEffect(() => {
    loadAttendanceData();
  }, [month, regionId]);

  usePullToRefresh(loadAttendanceData, [month, regionId]);

  async function loadAttendanceData() {
    setLoading(true);
    setError('');

    try {
      const data = await attendanceManagementService.getPeriodData(month, regionId);
      setRegions(data.regions);
      setSummaries(
        buildSummaries(
          data.employees,
          data.attendanceRecords,
          data.leaveRequests,
          data.restDays,
          data.publicHolidays,
          data.range.startDate,
          data.range.endDate,
        ),
      );
      setSelectedEmployeeId('');
      setShowAbnormalCenter(false);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取考勤数据失败。');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="attendance-management-page">
      <div className="staff-toolbar">
        <div className="page-heading">
          <span>工作工具 / 人事部</span>
          <h2>考勤</h2>
          <p>{range.startDate} 至 {range.endDate}，按公司考勤周期统计迟到、早退、旷工与异常打卡。</p>
        </div>

        <button className="secondary-action" type="button" onClick={loadAttendanceData} disabled={loading}>
          <RefreshCw size={17} />
          <span>刷新</span>
        </button>
      </div>

      {canUseAttendance ? (
        <button className="abnormal-banner" type="button" onClick={() => setShowAbnormalCenter(true)}>
          <AlertTriangle size={20} />
          <span>异常打卡提醒</span>
          <strong>{abnormalEmployeeCount} 位员工</strong>
        </button>
      ) : null}

      <p className="abnormal-cycle-count">本周期异常次数：{abnormalRecords.length}</p>

      <div className="attendance-filters">
        <label className="form-field">
          <span>考勤月份</span>
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
      </div>

      <div className="staff-list-panel">
        <div className="list-header">
          <div>
            <span>考勤主表</span>
            <h3>{summaries.length} 位员工</h3>
          </div>
        </div>

        {error ? <p className="form-alert table-alert">{error}</p> : null}

        {loading ? (
          <div className="table-state">正在读取考勤数据...</div>
        ) : summaries.length === 0 ? (
          <div className="table-state">暂无考勤数据。</div>
        ) : (
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead>
                <tr>
                  <th>昵称</th>
                  <th>迟到</th>
                  <th>早退</th>
                  <th>旷工</th>
                  <th>超时</th>
                  <th>异常</th>
                  {canUseAttendance ? <th className="attendance-detail-col">查看详情</th> : null}
                </tr>
              </thead>
              <tbody>
                {summaries.map((summary) => (
                  <tr key={summary.employee.id}>
                    <td>
                      {canUseAttendance ? (
                        <button
                          className="text-link-button"
                          type="button"
                          onClick={() => {
                            setSelectedEmployeeId(summary.employee.id);
                            setShowAbnormalCenter(false);
                          }}
                        >
                          {getEmployeeDisplayName(summary.employee)}
                        </button>
                      ) : (
                        getEmployeeDisplayName(summary.employee)
                      )}
                    </td>
                    <td>{summary.lateCount}</td>
                    <td>{summary.earlyLeaveCount}</td>
                    <td>{summary.absentCount}</td>
                    <td>{summary.overtimeBreakCount}</td>
                    <td>{summary.abnormalPunchCount}</td>
                    {canUseAttendance ? (
                      <td className="attendance-detail-col">
                        <button
                          className="secondary-button compact-button"
                          type="button"
                          onClick={() => {
                            setSelectedEmployeeId(summary.employee.id);
                            setShowAbnormalCenter(false);
                          }}
                        >
                          <Eye size={16} />
                          <span>查看详情</span>
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAbnormalCenter && canUseAttendance ? <AbnormalEmployeeCenter records={abnormalRecords} onClose={() => setShowAbnormalCenter(false)} /> : null}
      {selectedSummary && canUseAttendance ? <EmployeeDetail summary={selectedSummary} onClose={() => setSelectedEmployeeId('')} /> : null}
    </section>
  );
}

function EmployeeDetail({ summary, onClose }: { summary: EmployeeAttendanceSummary; onClose: () => void }) {
  return (
    <SystemModal
      title={getEmployeeDisplayName(summary.employee)}
      subtitle="员工考勤详情"
      ariaLabel="员工考勤详情"
      onClose={onClose}
      footer={
        <button className="secondary-button compact-button" type="button" onClick={onClose}>
          关闭
        </button>
      }
    >
      <div className="employee-detail-sections">
        <section className="employee-detail-section">
          <h4>基础资料</h4>
          <div className="detail-list">
            <div><span>昵称</span><strong>{getEmployeeDisplayName(summary.employee)}</strong></div>
            <div><span>员工编号</span><strong>{summary.employee.employee_code ?? '-'}</strong></div>
            <div><span>区域</span><strong>{summary.employee.region?.code ?? '-'}</strong></div>
          </div>
        </section>

        <section className="employee-detail-section">
          <h4>工作资料</h4>
          <div className="leave-stats-grid">
            <StatCard label="迟到次数" value={summary.lateCount} />
            <StatCard label="早退次数" value={summary.earlyLeaveCount} />
            <StatCard label="旷工次数" value={summary.absentCount} />
            <StatCard label="超时休息次数" value={summary.overtimeBreakCount} />
          </div>
        </section>

        <section className="employee-detail-section">
          <h4>薪资资料</h4>
          <div className="leave-stats-grid">
            <StatCard label="年假次数" value={summary.leaveCounts.annual} />
            <StatCard label="病假次数" value={summary.leaveCounts.medical} />
            <StatCard label="无薪假次数" value={summary.leaveCounts.unpaid} />
            <StatCard label="换休次数" value={summary.leaveCounts.replacement} />
          </div>
        </section>

        <section className="employee-detail-section">
          <h4>班次资料</h4>
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead>
                <tr>
                  <th>日期</th>
                  <th>上班时间</th>
                  <th>开始休息</th>
                  <th>结束休息</th>
                  <th>下班时间</th>
                  <th>工作时长</th>
                  <th>休息时长</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {summary.dailyRecords.map((record) => (
                  <tr key={record.date}>
                    <td>{record.date}</td>
                    <td>{formatRecordTime(record.clockIn)}</td>
                    <td>{formatRecordTime(record.breakStart)}</td>
                    <td>{formatRecordTime(record.breakEnd)}</td>
                    <td>{formatRecordTime(record.clockOut)}</td>
                    <td>{record.workHours === null ? '-' : `${record.workHours.toFixed(1)} 小时`}</td>
                    <td>{record.breakMinutes ? `${record.breakMinutes} 分钟` : '-'}</td>
                    <td>{record.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </SystemModal>
  );
}

function AbnormalEmployeeCenter({ records, onClose }: { records: AbnormalRecord[]; onClose: () => void }) {
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const groupedEmployees = useMemo(() => {
    const map = new Map<string, { employee: AttendanceEmployee; records: AbnormalRecord[] }>();

    records.forEach((record) => {
      const current = map.get(record.employee.id) ?? { employee: record.employee, records: [] };
      current.records.push(record);
      map.set(record.employee.id, current);
    });

    return [...map.values()].sort((a, b) => b.records.length - a.records.length);
  }, [records]);
  const selected = groupedEmployees.find((item) => item.employee.id === selectedEmployeeId) ?? null;

  return (
    <SystemModal
      title={selected ? `${getEmployeeDisplayName(selected.employee)} 的异常记录` : `${records.length} 次异常`}
      subtitle="异常打卡中心"
      ariaLabel="异常打卡中心"
      onClose={onClose}
      footer={
        <>
          {selected ? (
            <button className="secondary-button compact-button" type="button" onClick={() => setSelectedEmployeeId('')}>
              返回员工列表
            </button>
          ) : null}
          <button className="primary-button compact-button" type="button" onClick={onClose}>
            关闭
          </button>
        </>
      }
    >
      <div className="employee-detail-sections">
        <section className="employee-detail-section">
          <h4>基础资料</h4>
          <div className="detail-list">
            <div>
              <span>异常员工</span>
              <strong>{selected ? selected.employee.full_name : `${groupedEmployees.length} 位员工`}</strong>
            </div>
            <div>
              <span>异常次数</span>
              <strong>{selected ? selected.records.length : records.length}</strong>
            </div>
          </div>
        </section>

        <section className="employee-detail-section">
          <h4>工作资料</h4>
          {records.length === 0 ? (
            <div className="table-state">当前周期暂无异常打卡。</div>
          ) : selected ? (
            <div className="staff-table-wrap">
              <table className="staff-table">
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>异常类型</th>
                    <th>原因</th>
                    <th>打卡时间</th>
                    <th>备注</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.records.map((record) => (
                    <tr key={record.id}>
                      <td>{toDateKey(new Date(record.punchedAt))}</td>
                      <td>{record.type}</td>
                      <td>{record.type}</td>
                      <td>{new Date(record.punchedAt).toLocaleString('zh-CN')}</td>
                      <td className="device-cell">GPS：{record.gps} / IP：{record.ip} / 设备：{record.deviceInfo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="staff-table-wrap">
              <table className="staff-table">
                <thead>
                  <tr>
                    <th>员工姓名</th>
                    <th>异常次数</th>
                    <th>查看</th>
                  </tr>
                </thead>
                <tbody>
                  {groupedEmployees.map((item) => (
                    <tr key={item.employee.id}>
                      <td><strong>{getEmployeeDisplayName(item.employee)}</strong></td>
                      <td>异常 {item.records.length} 次</td>
                      <td>
                        <button className="secondary-button compact-button" type="button" onClick={() => setSelectedEmployeeId(item.employee.id)}>
                          <Eye size={16} />
                          <span>查看详情</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="employee-detail-section">
          <h4>薪资资料</h4>
          <div className="detail-list">
            <div>
              <span>薪资处理</span>
              <strong>按 HR 审核结果处理</strong>
            </div>
          </div>
        </section>

        <section className="employee-detail-section">
          <h4>班次资料</h4>
          <div className="detail-list">
            <div>
              <span>异常来源</span>
              <strong>打卡时间、GPS、IP、设备</strong>
            </div>
          </div>
        </section>
      </div>
    </SystemModal>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="leave-stat-card">
      <BarChart3 size={20} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function getEmployeeDisplayName(employee: Pick<AttendanceEmployee, 'full_name' | 'nickname'>) {
  return employee.nickname?.trim() || employee.full_name;
}

function buildSummaries(
  employees: AttendanceEmployee[],
  attendanceRecords: AttendanceRecord[],
  leaveRequests: LeaveRequest[],
  restDays: AttendanceRestDay[],
  publicHolidays: PublicHoliday[],
  startDate: string,
  endDate: string,
) {
  const dates = getDateRange(startDate, endDate);
  const today = toDateKey(new Date());
  const recordsByEmployeeDate = groupAttendanceRecords(attendanceRecords);
  const leavesByEmployeeDate = groupLeaveRequests(leaveRequests, dates);
  const replacementMakeUpDatesByEmployeeDate = groupApprovedReplacementMakeUpDates(leaveRequests, dates);
  const restDaysByEmployeeDate = groupRestDays(restDays);
  const publicHolidaysByRegionDate = groupPublicHolidays(publicHolidays);

  return employees.map((employee) => {
    const leaveCounts: Record<LeaveType, number> = {
      annual: 0,
      medical: 0,
      unpaid: 0,
      replacement: 0,
    };
    const abnormalRecords: AbnormalRecord[] = [];
    let lateCount = 0;
    let earlyLeaveCount = 0;
    let absentCount = 0;
    let overtimeBreakCount = 0;
    let abnormalPunchCount = 0;

    const employeeRecords = attendanceRecords.filter((record) => record.employee_id === employee.id);
    const expectedIp = mostFrequent(employeeRecords.map((record) => record.ip_address).filter(Boolean) as string[]);
    const expectedDevice = mostFrequent(employeeRecords.map((record) => record.device_info).filter(Boolean));
    const expectedGps = mostFrequent(employeeRecords.map((record) => gpsKey(record)).filter(Boolean));

    const dailyRecords = dates.map((date) => {
      const records = recordsByEmployeeDate.get(`${employee.id}:${date}`) ?? [];
      const clockIn = records.find((record) => record.punch_type === 'clock_in') ?? null;
      const breakStart = records.find((record) => record.punch_type === 'break_start') ?? null;
      const breakEnd = records.find((record) => record.punch_type === 'break_end') ?? null;
      const clockOut = [...records].reverse().find((record) => record.punch_type === 'clock_out') ?? null;
      const leave = leavesByEmployeeDate.get(`${employee.id}:${date}`) ?? null;
      const replacementMakeUpDate = replacementMakeUpDatesByEmployeeDate.get(`${employee.id}:${date}`) ?? null;
      const restDay = restDaysByEmployeeDate.get(`${employee.id}:${date}`) ?? null;
      const publicHoliday = getPublicHolidayForDate(publicHolidaysByRegionDate, employee.region_id, date);
      const breakMinutes = breakStart && breakEnd ? minutesBetween(breakStart.punched_at, breakEnd.punched_at) : 0;
      const workHours = clockIn && clockOut ? minutesBetween(clockIn.punched_at, clockOut.punched_at) / 60 : null;
      const statuses: string[] = [];
      const isPastOrToday = date <= today;
      const weekend = isWeekend(date);
      const nonWorkingDay = Boolean(publicHoliday) || (weekend && !replacementMakeUpDate);

      if (publicHoliday) {
        statuses.push('公共假期');
      } else if (weekend && !replacementMakeUpDate) {
        statuses.push('周末');
      }

      if (!nonWorkingDay && leave?.status === 'approved') {
        statuses.push(`${leaveTypeLabels[leave.leave_type]}已通过`);
        leaveCounts[leave.leave_type] += 1;
      }

      if (restDay) {
        statuses.push('排休');
      }

      if (employee.require_attendance && !nonWorkingDay && !leave && !restDay && isPastOrToday && !clockIn) {
        statuses.push('旷工');
        absentCount += 1;
      }

      if (employee.require_attendance && !nonWorkingDay && !restDay && clockIn && employee.start_work_time && isAfterWorkTime(clockIn.punched_at, employee.start_work_time)) {
        statuses.push('迟到');
        lateCount += 1;
        abnormalPunchCount += 1;
        abnormalRecords.push(toAbnormal(clockIn, employee, '异常时间打卡'));
      }

      if (employee.require_attendance && !nonWorkingDay && !restDay && clockOut && employee.end_work_time && isBeforeWorkTime(clockOut.punched_at, employee.end_work_time)) {
        statuses.push('早退');
        earlyLeaveCount += 1;
        abnormalPunchCount += 1;
        abnormalRecords.push(toAbnormal(clockOut, employee, '异常时间打卡'));
      }

      if (employee.require_attendance && !nonWorkingDay && breakMinutes > 60 && breakEnd) {
        statuses.push('超时休息');
        overtimeBreakCount += 1;
        abnormalPunchCount += 1;
        abnormalRecords.push(toAbnormal(breakEnd, employee, '超时休息'));
      }

      if (!nonWorkingDay) {
        records.forEach((record) => {
          const abnormalTypes = getDeviceAbnormalTypes(record, expectedIp, expectedGps, expectedDevice);

          abnormalTypes.forEach((type) => {
            abnormalPunchCount += 1;
            abnormalRecords.push(toAbnormal(record, employee, type));
          });
        });
      }

      if (!statuses.length && (clockIn || clockOut)) {
        statuses.push('正常');
      }

      return {
        date,
        clockIn,
        breakStart,
        breakEnd,
        clockOut,
        workHours,
        breakMinutes,
        status: statuses.join('、') || '-',
      };
    });

    return {
      employee,
      lateCount,
      earlyLeaveCount,
      absentCount,
      overtimeBreakCount,
      abnormalPunchCount,
      leaveCounts,
      dailyRecords,
      abnormalRecords,
    };
  });
}

function groupRestDays(restDays: AttendanceRestDay[]) {
  const map = new Map<string, AttendanceRestDay>();

  restDays.forEach((restDay) => {
    map.set(`${restDay.employee_id}:${restDay.rest_date}`, restDay);
  });

  return map;
}

function groupAttendanceRecords(records: AttendanceRecord[]) {
  const map = new Map<string, AttendanceRecord[]>();

  records.forEach((record) => {
    if (!record.employee_id) {
      return;
    }

    const key = `${record.employee_id}:${toDateKey(new Date(record.punched_at))}`;
    const current = map.get(key) ?? [];
    current.push(record);
    current.sort((a, b) => new Date(a.punched_at).getTime() - new Date(b.punched_at).getTime());
    map.set(key, current);
  });

  return map;
}

function groupLeaveRequests(requests: LeaveRequest[], dates: string[]) {
  const map = new Map<string, LeaveRequest>();
  const dateSet = new Set(dates);

  requests.forEach((request) => {
    if (!request.employee_id || request.status === 'rejected') {
      return;
    }

    if (request.leave_type === 'replacement') {
      if (request.status === 'approved' && dateSet.has(request.end_date)) {
        map.set(`${request.employee_id}:${request.end_date}`, request);
      }

      return;
    }

    getDateRange(request.start_date, request.end_date).forEach((date) => {
      if (dateSet.has(date)) {
        map.set(`${request.employee_id}:${date}`, request);
      }
    });
  });

  return map;
}

function groupApprovedReplacementMakeUpDates(requests: LeaveRequest[], dates: string[]) {
  const map = new Map<string, LeaveRequest>();
  const dateSet = new Set(dates);

  requests.forEach((request) => {
    if (
      !request.employee_id ||
      request.leave_type !== 'replacement' ||
      request.status !== 'approved' ||
      !dateSet.has(request.start_date)
    ) {
      return;
    }

    map.set(`${request.employee_id}:${request.start_date}`, request);
  });

  return map;
}

function groupPublicHolidays(publicHolidays: PublicHoliday[]) {
  const map = new Map<string, PublicHoliday>();

  publicHolidays.forEach((holiday) => {
    map.set(`${holiday.region_id ?? 'all'}:${holiday.holiday_date}`, holiday);
  });

  return map;
}

function getPublicHolidayForDate(
  publicHolidaysByRegionDate: Map<string, PublicHoliday>,
  regionId: string | null,
  date: string,
) {
  return publicHolidaysByRegionDate.get(`all:${date}`) ?? (regionId ? publicHolidaysByRegionDate.get(`${regionId}:${date}`) : null);
}

function getDateRange(startDate: string, endDate: string) {
  const date = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  const dates: string[] = [];

  while (date <= end) {
    dates.push(toDateKey(date));
    date.setDate(date.getDate() + 1);
  }

  return dates;
}

function isWeekend(date: string) {
  const day = new Date(`${date}T00:00:00`).getDay();
  return day === 0 || day === 6;
}

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, '0')}`;
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function minutesBetween(startValue: string, endValue: string) {
  return Math.max(0, Math.round((new Date(endValue).getTime() - new Date(startValue).getTime()) / 60000));
}

function isAfterWorkTime(value: string, workTime: string) {
  return minutesOfDay(new Date(value)) > minutesFromTime(workTime);
}

function isBeforeWorkTime(value: string, workTime: string) {
  return minutesOfDay(new Date(value)) < minutesFromTime(workTime);
}

function minutesOfDay(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

function minutesFromTime(value: string) {
  const [hourText, minuteText] = value.slice(0, 5).split(':');
  return Number(hourText) * 60 + Number(minuteText);
}

function mostFrequent(values: string[]) {
  const counts = new Map<string, number>();

  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));

  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}

function gpsKey(record: AttendanceRecord) {
  if (record.latitude === null || record.longitude === null) {
    return '';
  }

  return `${Number(record.latitude).toFixed(3)},${Number(record.longitude).toFixed(3)}`;
}

function getDeviceAbnormalTypes(record: AttendanceRecord, expectedIp: string, expectedGps: string, expectedDevice: string) {
  const types: string[] = [];

  if (expectedIp && record.ip_address && record.ip_address !== expectedIp) {
    types.push('IP异常');
  }

  if (expectedGps && gpsKey(record) && gpsKey(record) !== expectedGps) {
    types.push('GPS异常');
  }

  if (expectedDevice && record.device_info && record.device_info !== expectedDevice) {
    types.push('设备异常');
  }

  return types;
}

function toAbnormal(record: AttendanceRecord, employee: AttendanceEmployee, type: string): AbnormalRecord {
  return {
    id: `${record.id}:${type}`,
    employee,
    type,
    punchedAt: record.punched_at,
    gps: `${Number(record.latitude).toFixed(5)}, ${Number(record.longitude).toFixed(5)}`,
    ip: record.ip_address ?? '-',
    deviceInfo: record.device_info,
    photoPath: record.photo_path,
  };
}

function formatRecordTime(record: AttendanceRecord | null) {
  if (!record) {
    return '-';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(record.punched_at));
}
