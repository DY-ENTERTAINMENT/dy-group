import { supabase } from '../lib/supabase';
import type { EmployeeStatus, LeaveBalanceAdjustment, LeaveType, Region } from '../types/database';

const db = supabase as any;

export type LeaveBalanceManagementStatusFilter = 'working' | EmployeeStatus | 'all';

export type LeaveBalanceDetail = {
  leave_type: Extract<LeaveType, 'annual' | 'medical'>;
  base_entitlement: number;
  adjustment_total: number;
  effective_entitlement: number;
  used_days: number;
  remaining_days: number;
};

export type ManagementLeaveBalanceRow = {
  employee_id: string;
  profile_id: string | null;
  employee_name: string;
  employee_code: string | null;
  region_id: string | null;
  region_code: string | null;
  region_name: string | null;
  job_title: string | null;
  employee_status: EmployeeStatus;
  probation_confirm_date: string | null;
  annual_base_entitlement: number;
  annual_adjustment_total: number;
  annual_effective_entitlement: number;
  annual_used_days: number;
  annual_remaining_days: number;
  medical_base_entitlement: number;
  medical_adjustment_total: number;
  medical_effective_entitlement: number;
  medical_used_days: number;
  medical_remaining_days: number;
};

export type LeaveBalanceManagementFilters = {
  year: number;
  regionId: string;
  employeeStatus: LeaveBalanceManagementStatusFilter;
  search: string;
};

export type LeaveBalanceAdjustmentHistoryItem = LeaveBalanceAdjustment & {
  adjusted_by_name: string | null;
};

export type LeaveBalanceAdjustmentValues = {
  employeeId: string;
  leaveYear: number;
  leaveType: Extract<LeaveType, 'annual' | 'medical'>;
  adjustmentDays: number;
  reason: string;
};

export const leaveBalanceManagementService = {
  async listAuthorizedRegions(): Promise<Region[]> {
    const { data: regionIds, error: regionError } = await db.rpc('current_user_authorized_region_ids');

    if (regionError) {
      throw regionError;
    }

    const authorizedRegionIds = (regionIds ?? []) as string[];
    if (authorizedRegionIds.length === 0) {
      return [];
    }

    const { data, error } = await supabase
      .from('regions')
      .select('*')
      .eq('is_active', true)
      .in('id', authorizedRegionIds)
      .order('sort_order', { ascending: true });

    if (error) {
      throw error;
    }

    return data ?? [];
  },

  async listBalances(filters: LeaveBalanceManagementFilters): Promise<ManagementLeaveBalanceRow[]> {
    const { data, error } = await db.rpc('get_management_leave_balances', {
      p_year: filters.year,
      p_region_id: filters.regionId || null,
      p_employee_status: filters.employeeStatus,
      p_search: filters.search.trim() || null,
    });

    if (error) {
      throw error;
    }

    return (data ?? []) as ManagementLeaveBalanceRow[];
  },

  async adjustBalance(values: LeaveBalanceAdjustmentValues): Promise<LeaveBalanceAdjustment> {
    const { data, error } = await db.rpc('adjust_employee_leave_balance', {
      p_employee_id: values.employeeId,
      p_leave_year: values.leaveYear,
      p_leave_type: values.leaveType,
      p_adjustment_days: values.adjustmentDays,
      p_reason: values.reason.trim(),
    });

    if (error) {
      throw error;
    }

    return (Array.isArray(data) ? data[0] : data) as LeaveBalanceAdjustment;
  },

  async listAdjustmentHistory(employeeId: string, year?: number): Promise<LeaveBalanceAdjustmentHistoryItem[]> {
    const { data, error } = await db.rpc('list_employee_leave_balance_adjustments', {
      p_employee_id: employeeId,
      p_year: year ?? null,
    });

    if (error) {
      throw error;
    }

    return (data ?? []) as LeaveBalanceAdjustmentHistoryItem[];
  },
};
