import type { AttendanceEmployee, AttendanceEffectiveReplacementWorkChange, AttendanceRestDay } from '../services/attendanceManagement.service';
import type { CompanyActivityDay, LeaveRequest, PublicHoliday } from '../types/database';

export const MALAYSIA_TIME_ZONE = 'Asia/Kuala_Lumpur';
export function malaysiaDateKey(value: Date | string) { return new Intl.DateTimeFormat('en-CA', { timeZone: MALAYSIA_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)); }
export function isEmployeeActiveOnDate(employee: Pick<AttendanceEmployee, 'status' | 'employment_end_date'>, date: string) { return employee.status !== 'left' || !employee.employment_end_date || date < employee.employment_end_date; }

export type EffectiveAttendanceDay = { shouldCountEmployeeDate: boolean; weekend: boolean; nonWorkingDay: boolean; activityExempt: boolean; exemptFromRules: boolean; requiresAttendance: boolean };

/** Exact exemption ordering used by AttendanceManagementPage; late/early/overtime remain there. */
export function resolveEffectiveAttendanceDay(input: { employee: AttendanceEmployee; date: string; leave: LeaveRequest | null; restDay: AttendanceRestDay | null; publicHoliday: PublicHoliday | null; companyActivity: CompanyActivityDay | null; hasReplacementMakeUpDate: boolean; replacementLeaveEffect: 'annual_leave' | 'unpaid_leave' | null }): EffectiveAttendanceDay {
  const shouldCountEmployeeDate = isEmployeeActiveOnDate(input.employee, input.date);
  const weekend = isWeekend(input.date);
  const nonWorkingDay = Boolean(input.publicHoliday) || (weekend && (!input.hasReplacementMakeUpDate || Boolean(input.replacementLeaveEffect)));
  const activityExempt = Boolean(input.companyActivity?.id) && !Boolean(input.publicHoliday);
  const exemptFromRules = nonWorkingDay || activityExempt;
  return { shouldCountEmployeeDate, weekend, nonWorkingDay, activityExempt, exemptFromRules, requiresAttendance: input.employee.require_attendance && shouldCountEmployeeDate && !exemptFromRules && !input.leave && !input.restDay };
}

export function createEffectiveAttendanceDayResolver(input: { leaves: LeaveRequest[]; restDays: AttendanceRestDay[]; holidays: PublicHoliday[]; activities: CompanyActivityDay[]; replacementChanges: AttendanceEffectiveReplacementWorkChange[]; dates: string[] }) {
  const dateSet = new Set(input.dates); const leaves = new Map<string, LeaveRequest>();
  input.leaves.forEach((request) => { if (!request.employee_id || request.status !== 'approved') return; if (request.leave_type === 'replacement') { if (dateSet.has(request.end_date)) leaves.set(`${request.employee_id}:${request.end_date}`, request); return; } forEachDate(request.start_date, request.end_date, (date) => { if (dateSet.has(date)) leaves.set(`${request.employee_id}:${date}`, request); }); });
  const restDays = new Map(input.restDays.map((item) => [`${item.employee_id}:${item.rest_date}`, item]));
  const holidays = new Map(input.holidays.map((item) => [`${item.region_id ?? 'all'}:${item.holiday_date}`, item]));
  const activities = new Map(input.activities.map((item) => [`${item.region_id ?? 'all'}:${item.activity_date}`, item]));
  const replacementMakeup = new Set(input.replacementChanges.filter((item) => dateSet.has(item.effective_makeup_date)).map((item) => `${item.employee_id}:${item.effective_makeup_date}`));
  const replacementEffects = new Map(input.replacementChanges.filter((item) => item.leave_effect === 'annual_leave' || item.leave_effect === 'unpaid_leave').map((item) => [`${item.employee_id}:${item.effective_makeup_date}`, item.leave_effect as 'annual_leave' | 'unpaid_leave']));
  return (employee: AttendanceEmployee, date: string) => resolveEffectiveAttendanceDay({ employee, date, leave: leaves.get(`${employee.id}:${date}`) ?? null, restDay: restDays.get(`${employee.id}:${date}`) ?? null, publicHoliday: holidays.get(`all:${date}`) ?? (employee.region_id ? holidays.get(`${employee.region_id}:${date}`) ?? null : null), companyActivity: activities.get(`all:${date}`) ?? (employee.region_id ? activities.get(`${employee.region_id}:${date}`) ?? null : null), hasReplacementMakeUpDate: replacementMakeup.has(`${employee.id}:${date}`), replacementLeaveEffect: replacementEffects.get(`${employee.id}:${date}`) ?? null });
}
function isWeekend(date: string) { const day = new Date(`${date}T00:00:00+08:00`).getDay(); return day === 0 || day === 6; }
function forEachDate(startDate: string, endDate: string, callback: (date: string) => void) { const date = new Date(`${startDate}T00:00:00+08:00`); const end = new Date(`${endDate}T00:00:00+08:00`); while (date <= end) { callback(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`); date.setUTCDate(date.getUTCDate() + 1); } }
