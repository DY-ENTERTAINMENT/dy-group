import { attendanceManagementService, type AttendancePeriodData } from './attendanceManagement.service';

/** Loads only the attendance cycle containing one requested calendar day. */
export function getEmployeeRestManagementDayData(date: string, regionId: string): Promise<AttendancePeriodData> {
  const [yearText, monthText, dayText] = date.split('-');
  const cycleMonth = Number(dayText) <= 25 ? new Date(Number(yearText), Number(monthText) - 1, 1) : new Date(Number(yearText), Number(monthText), 1);
  const month = `${cycleMonth.getFullYear()}-${String(cycleMonth.getMonth() + 1).padStart(2, '0')}`;
  return attendanceManagementService.getPeriodData(month, regionId);
}

/** Loads the two attendance cycles which can overlap one natural calendar month. */
export async function getEmployeeRestManagementData(month: string, regionId: string): Promise<AttendancePeriodData> {
  const [yearText, monthText] = month.split('-');
  const year = Number(yearText);
  const monthNumber = Number(monthText);
  const next = new Date(year, monthNumber, 1);
  const nextMonth = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
  const [first, second] = await Promise.all([
    attendanceManagementService.getPeriodData(month, regionId),
    attendanceManagementService.getPeriodData(nextMonth, regionId),
  ]);
  const unique = <T extends { id: string }>(items: T[]) => [...new Map(items.map((item) => [item.id, item])).values()];
  return {
    ...first,
    employees: unique([...first.employees, ...second.employees]),
    attendanceRecords: unique([...first.attendanceRecords, ...second.attendanceRecords]),
    leaveRequests: unique([...first.leaveRequests, ...second.leaveRequests]),
    restDays: unique([...first.restDays.map((item) => ({ ...item, id: item.rest_day_id })), ...second.restDays.map((item) => ({ ...item, id: item.rest_day_id }))]).map(({ id: _id, ...item }) => item),
    publicHolidays: unique([...first.publicHolidays, ...second.publicHolidays]),
    companyActivities: unique([...first.companyActivities, ...second.companyActivities]),
    effectiveWorkTimes: unique([...first.effectiveWorkTimes.map((item) => ({ ...item, id: item.detail_id })), ...second.effectiveWorkTimes.map((item) => ({ ...item, id: item.detail_id }))]).map(({ id: _id, ...item }) => item),
    effectiveReplacementWorkChanges: unique([...first.effectiveReplacementWorkChanges.map((item) => ({ ...item, id: item.change_request_id ?? item.source_replacement_leave_request_id })), ...second.effectiveReplacementWorkChanges.map((item) => ({ ...item, id: item.change_request_id ?? item.source_replacement_leave_request_id }))]).map(({ id: _id, ...item }) => item),
    regions: first.regions,
  };
}
