import { supabase } from '../lib/supabase';
import type {
  AttendanceRecord,
  Employee,
  EmploymentType,
  JobTitle,
  LeaveRequest,
  PublicHoliday,
  Region,
} from '../types/database';

export type AttendanceEmployee = Pick<
  Employee,
  | 'id'
  | 'full_name'
  | 'nickname'
  | 'employee_code'
  | 'region_id'
  | 'profile_id'
  | 'start_work_time'
  | 'end_work_time'
  | 'require_attendance'
> & {
  region: Pick<Region, 'id' | 'code' | 'name'> | null;
  employment_type: Pick<EmploymentType, 'id' | 'name'> | null;
  job_title: Pick<JobTitle, 'id' | 'name'> | null;
};

export type AttendancePeriodData = {
  employees: AttendanceEmployee[];
  attendanceRecords: AttendanceRecord[];
  leaveRequests: LeaveRequest[];
  restDays: AttendanceRestDay[];
  publicHolidays: PublicHoliday[];
  regions: Region[];
  range: AttendancePeriodRange;
};

export type AttendanceRestDay = {
  rest_day_id: string;
  employee_id: string;
  profile_id: string;
  employee_name: string;
  employee_code: string | null;
  region_id: string | null;
  region_code: string | null;
  rest_date: string;
  source: 'manual' | 'auto';
  status: 'confirmed' | 'cancelled';
};

export type AttendancePeriodRange = {
  startIso: string;
  endIso: string;
  startDate: string;
  endDate: string;
};

type EmployeeRowWithRelations = Pick<
  Employee,
  | 'id'
  | 'full_name'
  | 'nickname'
  | 'employee_code'
  | 'region_id'
  | 'profile_id'
  | 'start_work_time'
  | 'end_work_time'
  | 'require_attendance'
> & {
  regions: Pick<Region, 'id' | 'code' | 'name'> | null;
  employment_types: Pick<EmploymentType, 'id' | 'name'> | null;
  job_titles: Pick<JobTitle, 'id' | 'name'> | null;
};

export const attendanceManagementService = {
  async getAttendancePhotoSignedUrl(photoPath: string): Promise<string> {
    const { data, error } = await supabase.storage.from('attendance-photos').createSignedUrl(photoPath, 60);

    if (error) {
      throw error;
    }

    return data.signedUrl;
  },

  async getPeriodData(month: string, regionId: string): Promise<AttendancePeriodData> {
    const range = getAttendancePeriodRange(month);
    const employeesQuery = supabase
      .from('employees')
      .select(
        `
        id,
        full_name,
        nickname,
        employee_code,
        profile_id,
        region_id,
        start_work_time,
        end_work_time,
        require_attendance,
        regions:region_id(id, code, name),
        employment_types:employment_type_id(id, name),
        job_titles:job_title_id(id, name)
      `,
      )
      .is('deleted_at', null)
      .order('full_name', { ascending: true });

    const scopedEmployeesQuery = regionId ? employeesQuery.eq('region_id', regionId) : employeesQuery;

    const [yearText, monthText] = month.split('-');
    let publicHolidaysQuery = supabase
      .from('public_holidays')
      .select('*')
      .eq('is_active', true)
      .gte('holiday_date', range.startDate)
      .lte('holiday_date', range.endDate);

    if (regionId) {
      publicHolidaysQuery = publicHolidaysQuery.or(`region_id.is.null,region_id.eq.${regionId}`);
    }

    const [
      employeesResult,
      attendanceResult,
      leaveResult,
      replacementLeaveResult,
      restResult,
      publicHolidaysResult,
      regionsResult,
    ] = await Promise.all([
      scopedEmployeesQuery,
      supabase
        .from('attendance_records')
        .select('*')
        .gte('punched_at', range.startIso)
        .lt('punched_at', range.endIso)
        .order('punched_at', { ascending: true }),
      supabase
        .from('leave_requests')
        .select('*')
        .neq('leave_type', 'replacement')
        .lte('start_date', range.endDate)
        .gte('end_date', range.startDate)
        .order('start_date', { ascending: true }),
      supabase
        .from('leave_requests')
        .select('*')
        .eq('leave_type', 'replacement')
        .or(
          `and(start_date.gte.${range.startDate},start_date.lte.${range.endDate}),and(end_date.gte.${range.startDate},end_date.lte.${range.endDate})`,
        )
        .order('start_date', { ascending: true }),
      supabase.rpc('get_rest_day_calendar', {
        cycle_year: Number(yearText),
        cycle_month: Number(monthText),
        region_filter: regionId || null,
      }),
      publicHolidaysQuery,
      supabase.from('regions').select('*').eq('is_active', true).order('sort_order', { ascending: true }),
    ]);

    if (employeesResult.error) {
      throw employeesResult.error;
    }

    if (attendanceResult.error) {
      throw attendanceResult.error;
    }

    if (leaveResult.error) {
      throw leaveResult.error;
    }

    if (replacementLeaveResult.error) {
      throw replacementLeaveResult.error;
    }

    if (restResult.error) {
      throw restResult.error;
    }

    if (publicHolidaysResult.error) {
      throw publicHolidaysResult.error;
    }

    if (regionsResult.error) {
      throw regionsResult.error;
    }

    return {
      employees: ((employeesResult.data ?? []) as unknown as EmployeeRowWithRelations[]).map(mapEmployeeRow),
      attendanceRecords: attendanceResult.data ?? [],
      leaveRequests: mergeLeaveRequests(leaveResult.data ?? [], replacementLeaveResult.data ?? []),
      restDays: (restResult.data ?? []) as AttendanceRestDay[],
      publicHolidays: publicHolidaysResult.data ?? [],
      regions: regionsResult.data ?? [],
      range,
    };
  },
};

export function getAttendancePeriodRange(month: string): AttendancePeriodRange {
  const [yearText, monthText] = month.split('-');
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const start = new Date(year, monthIndex - 1, 26);
  const end = new Date(year, monthIndex, 26);
  const lastDay = new Date(year, monthIndex, 25);

  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    startDate: toDateKey(start),
    endDate: toDateKey(lastDay),
  };
}

function mapEmployeeRow(row: EmployeeRowWithRelations): AttendanceEmployee {
  return {
    id: row.id,
    full_name: row.full_name,
    nickname: row.nickname,
    employee_code: row.employee_code,
    profile_id: row.profile_id,
    region_id: row.region_id,
    start_work_time: row.start_work_time,
    end_work_time: row.end_work_time,
    require_attendance: row.require_attendance,
    region: row.regions,
    employment_type: row.employment_types,
    job_title: row.job_titles,
  };
}

function mergeLeaveRequests(primary: LeaveRequest[], secondary: LeaveRequest[]) {
  const map = new Map<string, LeaveRequest>();

  [...primary, ...secondary].forEach((request) => {
    map.set(request.id, request);
  });

  return [...map.values()];
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}
