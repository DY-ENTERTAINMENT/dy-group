import { supabase } from '../lib/supabase';
import type { Employee, LeaveRequest, LeaveRequestStatus, LeaveType, PublicHoliday } from '../types/database';

export type LeaveFormValues = {
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  reason: string;
  medical_attachment_url?: string;
};

const MEDICAL_BUCKET = 'leave-medical-attachments';

export type LeaveRequestItem = LeaveRequest & {
  employee: Pick<Employee, 'id' | 'full_name' | 'phone' | 'employee_code' | 'region_id'> | null;
};

export type LeaveStats = Record<LeaveRequestStatus | 'total', number>;

export type LeaveBalance = {
  annualRemaining: number;
  medicalRemaining: number;
};

export type RestDayCalendarItem = {
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

type LeaveRequestRowWithEmployee = LeaveRequest & {
  employees: Pick<Employee, 'id' | 'full_name' | 'phone' | 'employee_code' | 'region_id'> | null;
};

export const leaveService = {
  async listMyLeaveRequests(profileId: string) {
    const { data, error } = await supabase
      .from('leave_requests')
      .select(
        `
        *,
        employees:employee_id(id, full_name, phone, employee_code, region_id)
      `,
      )
      .eq('profile_id', profileId)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return ((data ?? []) as unknown as LeaveRequestRowWithEmployee[]).map(mapLeaveRequestRow);
  },

  async listPendingLeaveRequests() {
    const { data, error } = await supabase
      .from('leave_requests')
      .select(
        `
        *,
        employees:employee_id(id, full_name, phone, employee_code, region_id)
      `,
      )
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    if (error) {
      throw error;
    }

    return ((data ?? []) as unknown as LeaveRequestRowWithEmployee[]).map(mapLeaveRequestRow);
  },

  async createLeaveRequest(profileId: string, values: LeaveFormValues) {
    const employee = await findEmployeeByProfileId(profileId);

    if (values.leave_type === 'replacement') {
      await validateReplacementLeaveRequest(employee, values);

      const { error } = await supabase.from('leave_requests').insert({
        profile_id: profileId,
        employee_id: employee?.id ?? null,
        leave_type: values.leave_type,
        start_date: values.start_date,
        end_date: values.end_date,
        reason: values.reason.trim(),
        medical_attachment_url: values.medical_attachment_url?.trim() || null,
        status: 'pending',
      });

      if (error) {
        throw error;
      }

      return;
    }

    const publicHolidays = await listPublicHolidaysForRange(values.start_date, values.end_date, employee?.region_id ?? null);
    const workingDays = countWorkingLeaveDays(values.start_date, values.end_date, employee?.region_id ?? null, publicHolidays);

    if (workingDays <= 0) {
      throw new Error('请假日期范围内没有需要扣假的工作日。');
    }

    const { error } = await supabase.from('leave_requests').insert({
      profile_id: profileId,
      employee_id: employee?.id ?? null,
      leave_type: values.leave_type,
      start_date: values.start_date,
      end_date: values.end_date,
      reason: values.reason.trim(),
      medical_attachment_url: values.medical_attachment_url?.trim() || null,
      status: 'pending',
    });

    if (error) {
      throw error;
    }
  },

  async uploadMedicalAttachment(profileId: string, file: File) {
    if (!file.type.startsWith('image/')) {
      throw new Error('病假证明必须是图片格式。');
    }

    const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const path = `${profileId}/${Date.now()}.${extension}`;
    const { error } = await supabase.storage.from(MEDICAL_BUCKET).upload(path, file, {
      cacheControl: '3600',
      contentType: file.type,
      upsert: false,
    });

    if (error) {
      throw error;
    }

    const { data } = supabase.storage.from(MEDICAL_BUCKET).getPublicUrl(path);
    return data.publicUrl;
  },

  async approveLeaveRequest(requestId: string) {
    const { error } = await supabase.rpc('approve_leave_request', { request_id: requestId });

    if (error) {
      throw error;
    }
  },

  async rejectLeaveRequest(requestId: string, note: string) {
    const { error } = await supabase.rpc('reject_leave_request', {
      request_id: requestId,
      note,
    });

    if (error) {
      throw error;
    }
  },

  async listRestDays(cycleYear: number, cycleMonth: number, regionId = '') {
    const { data, error } = await supabase.rpc('get_rest_day_calendar', {
      cycle_year: cycleYear,
      cycle_month: cycleMonth,
      region_filter: regionId || null,
    });

    if (error) {
      throw error;
    }

    return (data ?? []) as RestDayCalendarItem[];
  },

  async getMyLeaveBalances(profileId: string, requests?: LeaveRequestItem[]): Promise<LeaveBalance> {
    const employee = await findEmployeeByProfileId(profileId);
    const entitlement = calculateLeaveEntitlement(employee);
    const approvedRequests = requests ?? (await this.listMyLeaveRequests(profileId));
    const currentYear = new Date().getFullYear();
    const publicHolidaysByYear = await listPublicHolidaysForYear(currentYear, employee?.region_id ?? null);

    const used = approvedRequests.reduce(
      (total, request) => {
        if (request.status !== 'approved') return total;
        if (request.leave_type !== 'annual' && request.leave_type !== 'medical') return total;

        const days = countLeaveWorkingDaysInYear(
          request.start_date,
          request.end_date,
          currentYear,
          request.employee?.region_id ?? employee?.region_id ?? null,
          publicHolidaysByYear,
        );
        return {
          ...total,
          [request.leave_type]: total[request.leave_type] + days,
        };
      },
      { annual: 0, medical: 0 },
    );

    return {
      annualRemaining: Math.max(0, entitlement.annual - used.annual),
      medicalRemaining: Math.max(0, entitlement.medical - used.medical),
    };
  },

  async saveMyRestDays(cycleYear: number, cycleMonth: number, restDates: string[]) {
    const normalizedRestDates = [...new Set(restDates.map(toDateKey))].sort();

    console.info('save_my_rest_days request', {
      cycleYear,
      cycleMonth,
      normalizedDates: normalizedRestDates,
    });

    const { data, error } = await supabase.rpc('save_my_rest_days', {
      cycle_year: cycleYear,
      cycle_month: cycleMonth,
      rest_dates: normalizedRestDates,
    });

    console.info('save_my_rest_days response', {
      data,
      error,
    });

    if (error) {
      throw error;
    }

    return data;
  },

  async autoFillRestDays(cycleYear: number, cycleMonth: number, regionId = '') {
    const { data, error } = await supabase.rpc('auto_fill_rest_days', {
      cycle_year: cycleYear,
      cycle_month: cycleMonth,
      region_filter: regionId || null,
    });

    if (error) {
      throw error;
    }

    return data ?? 0;
  },
};

export function getLeaveStats(requests: LeaveRequestItem[]): LeaveStats {
  return requests.reduce<LeaveStats>(
    (stats, request) => {
      stats.total += 1;
      stats[request.status] += 1;
      return stats;
    },
    {
      total: 0,
      pending: 0,
      approved: 0,
      rejected: 0,
    },
  );
}

async function findEmployeeByProfileId(profileId: string) {
  const { data, error } = await supabase
    .from('employees')
    .select('id, status, hire_date, probation_confirm_date, region_id')
    .eq('profile_id', profileId)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function validateReplacementLeaveRequest(
  employee: Pick<Employee, 'id' | 'region_id'> | null,
  values: LeaveFormValues,
) {
  if (!employee?.id) {
    throw new Error('无法确认员工资料，请先在工作人员页面绑定员工资料。');
  }

  if (!values.reason.trim()) {
    throw new Error('请填写申请原因。');
  }

  const makeUpDate = values.start_date;
  const leaveDate = values.end_date;

  if (!isValidDateKey(makeUpDate) || !isValidDateKey(leaveDate)) {
    throw new Error('请选择有效的调休日日期。');
  }

  if (!isSaturday(makeUpDate)) {
    throw new Error('Make-up Saturday 必须是星期六。');
  }

  if (isSunday(makeUpDate) || isSunday(leaveDate)) {
    throw new Error('调休日日期不能选择星期日。');
  }

  if (!isWeekday(leaveDate)) {
    throw new Error('Leave Date 必须是星期一至星期五。');
  }

  const publicHolidays = await listPublicHolidaysForDates([makeUpDate, leaveDate], employee.region_id);
  if (publicHolidays.length > 0) {
    throw new Error('Make-up Saturday 和 Leave Date 不能是公共假期。');
  }

  const restDayConflict = await findConfirmedRestDayConflict(employee.id, [makeUpDate, leaveDate]);
  if (restDayConflict?.rest_date === makeUpDate) {
    throw new Error('Make-up Saturday 已是排休日，不能申请调休日。');
  }

  if (restDayConflict?.rest_date === leaveDate) {
    throw new Error('Leave Date 已是排休日，不能申请调休日。');
  }

  const approvedLeaveConflict = await hasApprovedLeaveOnDate(employee.id, leaveDate);
  if (approvedLeaveConflict) {
    throw new Error('Leave Date 已有已通过的请假申请。');
  }

  const approvedOrdinaryLeaveConflict = await hasApprovedOrdinaryLeaveOnDate(employee.id, makeUpDate);
  if (approvedOrdinaryLeaveConflict) {
    throw new Error('Make-up Saturday 不可与已批准的年假、病假或无薪假重叠。');
  }

  const replacementConflict = await hasReplacementDateConflict(employee.id, [makeUpDate, leaveDate]);
  if (replacementConflict) {
    throw new Error('该员工已有相同日期的调休日申请。');
  }
}

function calculateLeaveEntitlement(employee: Pick<Employee, 'status' | 'probation_confirm_date'> | null): {
  annual: number;
  medical: number;
} {
  if (!employee || employee.status !== 'active' || !employee.probation_confirm_date) {
    return { annual: 0, medical: 0 };
  }

  const today = new Date();
  const confirmDate = new Date(`${employee.probation_confirm_date}T00:00:00`);

  if (Number.isNaN(confirmDate.getTime()) || confirmDate > today) {
    return { annual: 0, medical: 0 };
  }

  const years = getCompletedYears(confirmDate, today);

  if (years < 2) {
    return { annual: 8, medical: 14 };
  }

  if (years < 5) {
    return { annual: 12, medical: 14 };
  }

  return {
    annual: Math.min(20, 16 + Math.max(0, years - 5)),
    medical: 14,
  };
}

function getCompletedYears(startDate: Date, endDate: Date) {
  let years = endDate.getFullYear() - startDate.getFullYear();
  const anniversary = new Date(endDate.getFullYear(), startDate.getMonth(), startDate.getDate());

  if (endDate < anniversary) {
    years -= 1;
  }

  return Math.max(0, years);
}

async function listPublicHolidaysForYear(year: number, regionId: string | null) {
  return listPublicHolidaysForRange(`${year}-01-01`, `${year}-12-31`, regionId);
}

async function listPublicHolidaysForRange(startDate: string, endDate: string, regionId: string | null) {
  let query = supabase
    .from('public_holidays')
    .select('id, holiday_name, holiday_date, region_id, note, is_active, created_by, updated_by, created_at, updated_at')
    .eq('is_active', true)
    .gte('holiday_date', startDate)
    .lte('holiday_date', endDate);

  query = regionId ? query.or(`region_id.is.null,region_id.eq.${regionId}`) : query.is('region_id', null);

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return (data ?? []) as PublicHoliday[];
}

async function listPublicHolidaysForDates(dates: string[], regionId: string | null) {
  let query = supabase
    .from('public_holidays')
    .select('id, holiday_name, holiday_date, region_id, note, is_active, created_by, updated_by, created_at, updated_at')
    .eq('is_active', true)
    .in('holiday_date', [...new Set(dates)]);

  query = regionId ? query.or(`region_id.is.null,region_id.eq.${regionId}`) : query.is('region_id', null);

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return (data ?? []) as PublicHoliday[];
}

async function findConfirmedRestDayConflict(employeeId: string, dates: string[]) {
  const { data, error } = await supabase
    .from('rest_days')
    .select('rest_date')
    .eq('employee_id', employeeId)
    .eq('status', 'confirmed')
    .in('rest_date', [...new Set(dates)])
    .limit(1);

  if (error) {
    throw error;
  }

  return data?.[0] ?? null;
}

async function hasApprovedLeaveOnDate(employeeId: string, date: string) {
  const { data, error } = await supabase
    .from('leave_requests')
    .select('id')
    .eq('employee_id', employeeId)
    .eq('status', 'approved')
    .lte('start_date', date)
    .gte('end_date', date)
    .limit(1);

  if (error) {
    throw error;
  }

  return Boolean(data?.length);
}

async function hasApprovedOrdinaryLeaveOnDate(employeeId: string, date: string) {
  const { data, error } = await supabase
    .from('leave_requests')
    .select('id')
    .eq('employee_id', employeeId)
    .in('leave_type', ['annual', 'medical', 'unpaid'])
    .eq('status', 'approved')
    .lte('start_date', date)
    .gte('end_date', date)
    .limit(1);

  if (error) {
    throw error;
  }

  return Boolean(data?.length);
}

async function hasReplacementDateConflict(employeeId: string, dates: string[]) {
  const uniqueDates = [...new Set(dates)];
  const dateFilters = uniqueDates.flatMap((date) => [`start_date.eq.${date}`, `end_date.eq.${date}`]).join(',');
  const { data, error } = await supabase
    .from('leave_requests')
    .select('id')
    .eq('employee_id', employeeId)
    .eq('leave_type', 'replacement')
    .neq('status', 'rejected')
    .or(dateFilters)
    .limit(1);

  if (error) {
    throw error;
  }

  return Boolean(data?.length);
}

function countLeaveWorkingDaysInYear(
  startDate: string,
  endDate: string,
  year: number,
  regionId: string | null,
  publicHolidays: PublicHoliday[],
) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < yearStart || start > yearEnd) {
    return 0;
  }

  const effectiveStart = start < yearStart ? yearStart : start;
  const effectiveEnd = end > yearEnd ? yearEnd : end;

  return countWorkingLeaveDays(toDateKeyFromDate(effectiveStart), toDateKeyFromDate(effectiveEnd), regionId, publicHolidays);
}

function countWorkingLeaveDays(startDate: string, endDate: string, regionId: string | null, publicHolidays: PublicHoliday[]) {
  const holidayDates = new Set(
    publicHolidays
      .filter((holiday) => !holiday.region_id || holiday.region_id === regionId)
      .map((holiday) => holiday.holiday_date),
  );
  let count = 0;
  const current = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);

  while (current <= end) {
    const dateKey = toDateKeyFromDate(current);
    if (!isWeekend(dateKey) && !holidayDates.has(dateKey)) {
      count += 1;
    }
    current.setDate(current.getDate() + 1);
  }

  return count;
}

function isWeekend(date: string) {
  const day = new Date(`${date}T00:00:00`).getDay();
  return day === 0 || day === 6;
}

function isSaturday(date: string) {
  return getDayOfWeek(date) === 6;
}

function isSunday(date: string) {
  return getDayOfWeek(date) === 0;
}

function isWeekday(date: string) {
  const day = getDayOfWeek(date);
  return day >= 1 && day <= 5;
}

function getDayOfWeek(date: string) {
  return new Date(`${date}T00:00:00`).getDay();
}

function isValidDateKey(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return false;
  }

  const value = new Date(`${date}T00:00:00`);
  return !Number.isNaN(value.getTime()) && toDateKeyFromDate(value) === date;
}

function toDateKeyFromDate(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function mapLeaveRequestRow(row: LeaveRequestRowWithEmployee): LeaveRequestItem {
  return {
    ...row,
    employee: row.employees,
  };
}

function toDateKey(date: string) {
  return date.slice(0, 10);
}
