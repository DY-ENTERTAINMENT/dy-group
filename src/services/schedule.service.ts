import { supabase } from '../lib/supabase';
import type { LeaveType, Region } from '../types/database';

export type CalendarLeaveType = LeaveType;

export type LeaveCalendarItem = {
  leave_request_id: string;
  employee_id: string;
  employee_name: string;
  employee_code: string | null;
  region_id: string | null;
  region_code: string | null;
  leave_type: CalendarLeaveType;
  source_type: LeaveType;
  start_date: string;
  end_date: string;
  leave_date: string;
  applicant_name: string | null;
  reviewer_name: string | null;
  reviewed_at: string | null;
  source?: 'manual' | 'auto';
};

export type LeaveCalendarMonthData = {
  leaves: LeaveCalendarItem[];
  publicHolidays: PublicHolidayCalendarItem[];
  regions: Region[];
};

export type PublicHolidayCalendarItem = {
  id: string;
  holiday_name: string;
  holiday_date: string;
  region_id: string | null;
  note: string | null;
};

type LeaveCalendarRpcRow = Omit<LeaveCalendarItem, 'leave_type' | 'source_type' | 'source'> & {
  leave_type: LeaveType;
};

export const scheduleService = {
  async getLeaveCalendar(month: string, regionId: string): Promise<LeaveCalendarMonthData> {
    const range = getMonthRange(month);

    let publicHolidaysQuery = supabase
      .from('public_holidays')
      .select('id, holiday_name, holiday_date, region_id, note')
      .eq('is_active', true)
      .gte('holiday_date', range.startDate)
      .lte('holiday_date', range.endDate)
      .order('holiday_date', { ascending: true });

    if (regionId) {
      publicHolidaysQuery = publicHolidaysQuery.or(`region_id.is.null,region_id.eq.${regionId}`);
    }

    const [leavesResult, regionsResult, publicHolidaysResult] = await Promise.all([
      supabase.rpc('get_leave_calendar', {
        month_start: range.startDate,
        month_end: range.endDate,
        region_filter: regionId || null,
      }),
      supabase.from('regions').select('*').eq('is_active', true).order('sort_order', { ascending: true }),
      publicHolidaysQuery,
    ]);

    if (leavesResult.error) {
      throw leavesResult.error;
    }

    if (regionsResult.error) {
      throw regionsResult.error;
    }

    if (publicHolidaysResult.error) {
      throw publicHolidaysResult.error;
    }

    const approvedLeaves = ((leavesResult.data ?? []) as LeaveCalendarRpcRow[]).map((leave) => ({
        ...leave,
        leave_type: leave.leave_type as CalendarLeaveType,
        source_type: leave.leave_type,
      }));

    return {
      leaves: dedupeLeaves(approvedLeaves),
      publicHolidays: (publicHolidaysResult.data ?? []) as PublicHolidayCalendarItem[],
      regions: regionsResult.data ?? [],
    };
  },

  async canCancelCalendarLeave() {
    const { data, error } = await supabase.rpc('current_user_can_cancel_calendar_leave');

    if (error) {
      throw error;
    }

    return Boolean(data);
  },

  async cancelLeaveCalendarItem(item: LeaveCalendarItem, reason: string) {
    const { error } = await supabase.rpc('cancel_calendar_leave_item', {
      item_id: item.leave_request_id,
      item_type: item.source_type,
      cancel_reason: reason,
    });

    if (error) {
      throw error;
    }
  },
};

export function getMonthRange(month: string) {
  const [yearText, monthText] = month.split('-');
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const start = new Date(year, monthIndex, 1);
  const end = new Date(year, monthIndex + 1, 0);

  return {
    startDate: toDateKey(start),
    endDate: toDateKey(end),
  };
}

function dedupeLeaves(leaves: LeaveCalendarItem[]) {
  const map = new Map<string, LeaveCalendarItem>();

  leaves.forEach((leave) => {
    map.set(`${leave.leave_request_id}:${leave.leave_date}:${leave.employee_id}:${leave.source_type}`, leave);
  });

  return [...map.values()];
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}
