import { supabase } from '../lib/supabase';
import type {
  AttendanceAbnormalReviewHistory,
  AttendanceAbnormalReviewStatus,
  AttendanceRecord,
  Database,
  Employee,
  EmploymentType,
  JobTitle,
  LeaveRequest,
  PublicHoliday,
  Region,
} from '../types/database';

export type AttendanceEffectiveWorkTime =
  Database['public']['Functions']['get_attendance_effective_work_times']['Returns'][number];

export type AttendanceEmployee = Pick<
  Employee,
  | 'id'
  | 'full_name'
  | 'nickname'
  | 'employee_code'
  | 'region_id'
  | 'profile_id'
  | 'status'
  | 'employment_end_date'
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
  abnormalReviewHistory: AttendanceAbnormalReviewHistory[];
  leaveRequests: LeaveRequest[];
  restDays: AttendanceRestDay[];
  publicHolidays: PublicHoliday[];
  effectiveWorkTimes: AttendanceEffectiveWorkTime[];
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
  | 'status'
  | 'employment_end_date'
  | 'start_work_time'
  | 'end_work_time'
  | 'require_attendance'
> & {
  regions: Pick<Region, 'id' | 'code' | 'name'> | null;
  employment_types: Pick<EmploymentType, 'id' | 'name'> | null;
  job_titles: Pick<JobTitle, 'id' | 'name'> | null;
};

const ATTENDANCE_RECORDS_PAGE_SIZE = 1000;

export const attendanceManagementService = {
  async getAttendancePhotoSignedUrl(photoPath: string): Promise<string> {
    const { data, error } = await supabase.storage.from('attendance-photos').createSignedUrl(photoPath, 60);

    if (error) {
      throw error;
    }

    return data.signedUrl;
  },

  async reviewAbnormalRecord(payload: {
    attendanceRecordId: string;
    reviewStatus: AttendanceAbnormalReviewStatus;
    sourceAbnormalTypes: string[];
    reason?: string | null;
  }): Promise<string> {
    const { data, error } = await supabase.rpc('review_attendance_abnormal_record', {
      p_attendance_record_id: payload.attendanceRecordId,
      p_review_status: payload.reviewStatus,
      p_source_abnormal_types: payload.sourceAbnormalTypes,
      p_reason: payload.reason ?? null,
    });

    if (error) {
      throw error;
    }

    return data;
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
        status,
        employment_end_date,
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
      abnormalReviewHistoryResult,
      publicHolidaysResult,
      effectiveWorkTimesResult,
      regionsResult,
    ] = await Promise.all([
      scopedEmployeesQuery,
      fetchAttendanceRecordsByPeriod(range),
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
      supabase.rpc('get_attendance_abnormal_review_history', {
        p_start_at: range.startIso,
        p_end_at: range.endIso,
        p_region_id: regionId || null,
      }),
      publicHolidaysQuery,
      supabase.rpc('get_attendance_effective_work_times', {
        p_start_date: range.startDate,
        p_end_date: range.endDate,
        p_region_id: regionId || null,
      }),
      supabase.from('regions').select('*').eq('is_active', true).order('sort_order', { ascending: true }),
    ]);

    if (employeesResult.error) {
      throw employeesResult.error;
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

    if (abnormalReviewHistoryResult.error) {
      throw abnormalReviewHistoryResult.error;
    }

    if (publicHolidaysResult.error) {
      throw publicHolidaysResult.error;
    }

    if (effectiveWorkTimesResult.error) {
      throw effectiveWorkTimesResult.error;
    }

    if (regionsResult.error) {
      throw regionsResult.error;
    }

    return {
      employees: ((employeesResult.data ?? []) as unknown as EmployeeRowWithRelations[])
        .map(mapEmployeeRow)
        .filter((employee) => shouldShowEmployeeForPeriod(employee, range.startDate)),
      attendanceRecords: attendanceResult,
      abnormalReviewHistory: abnormalReviewHistoryResult.data ?? [],
      leaveRequests: mergeLeaveRequests(leaveResult.data ?? [], replacementLeaveResult.data ?? []),
      restDays: (restResult.data ?? []) as AttendanceRestDay[],
      publicHolidays: publicHolidaysResult.data ?? [],
      effectiveWorkTimes: effectiveWorkTimesResult.data ?? [],
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
    status: row.status,
    employment_end_date: row.employment_end_date,
    start_work_time: row.start_work_time,
    end_work_time: row.end_work_time,
    require_attendance: row.require_attendance,
    region: row.regions,
    employment_type: row.employment_types,
    job_title: row.job_titles,
  };
}

function shouldShowEmployeeForPeriod(employee: AttendanceEmployee, startDate: string) {
  if (employee.status === 'active' || employee.status === 'probation') {
    return true;
  }

  if (employee.status === 'left') {
    return Boolean(employee.employment_end_date && employee.employment_end_date > startDate);
  }

  return false;
}

async function fetchAttendanceRecordsByPeriod(range: AttendancePeriodRange): Promise<AttendanceRecord[]> {
  const records: AttendanceRecord[] = [];

  for (let offset = 0; ; offset += ATTENDANCE_RECORDS_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('attendance_records')
      .select('*')
      .gte('punched_at', range.startIso)
      .lt('punched_at', range.endIso)
      .order('punched_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + ATTENDANCE_RECORDS_PAGE_SIZE - 1);

    if (error) {
      throw error;
    }

    records.push(...(data ?? []));

    if (!data || data.length < ATTENDANCE_RECORDS_PAGE_SIZE) {
      return records;
    }
  }
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
