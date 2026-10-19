import { supabase } from '../lib/supabase';
import type { ReplacementWorkChangeRequest, ReplacementWorkChangeStatus, ReplacementWorkChangeType } from '../types/database';

export type ReplacementWorkChangeReviewItem = ReplacementWorkChangeRequest & {
  employee: { full_name: string; employee_code: string | null } | null;
};

export type ReplacementWorkChangeReviewHistoryItem = {
  id: string; employee_name: string; employee_code: string | null; region_id: string | null; region_code: string | null;
  change_type: ReplacementWorkChangeType; original_makeup_date: string; requested_makeup_date: string | null;
  original_start_time: string; requested_start_time: string | null; reason: string; status: Extract<ReplacementWorkChangeStatus, 'approved' | 'rejected'>;
  reviewer_name: string | null; reviewed_at: string | null; created_at: string; total_count: number;
};

export type ReplacementWorkChangeReviewHistoryFilters = {
  year: number; month: number; changeType?: string; regionId?: string; status?: string; search?: string; page: number; pageSize: number;
};

export type NewReplacementWorkChangeType = Extract<ReplacementWorkChangeType, 'reschedule'>;

export type ReplacementWorkChangeFormValues = {
  changeType: NewReplacementWorkChangeType;
  requestedMakeupDate?: string;
  reason: string;
};

export const replacementWorkChangeLabels: Record<ReplacementWorkChangeType, string> = {
  reschedule: '更换补班日期', annual_leave: '申请年假', unpaid_leave: '申请无薪假', work_time: '调整补班工时',
};

export const newReplacementWorkChangeLabels: Record<NewReplacementWorkChangeType, string> = {
  reschedule: replacementWorkChangeLabels.reschedule,
};

export const replacementWorkChangeService = {
  async listMyChanges() {
    const { data, error } = await supabase
      .from('replacement_work_change_requests')
      .select('*')
      .order('reviewed_at', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false });
    if (error) throw error;
    return (data ?? []) as ReplacementWorkChangeRequest[];
  },
  async listMyClockInDates(profileId: string) {
    const { data, error } = await supabase.from('attendance_records').select('punched_at').eq('profile_id', profileId).eq('punch_type', 'clock_in');
    if (error) throw error;
    return new Set((data ?? []).map((record) => new Date(record.punched_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' })));
  },
  async create(sourceId: string, values: ReplacementWorkChangeFormValues) {
    if (values.changeType !== 'reschedule') {
      throw new Error('调休补班变更仅支持更换补班日期。');
    }

    const { data, error } = await supabase.rpc('create_replacement_work_change_request', {
      p_source_replacement_leave_request_id: sourceId,
      p_change_type: values.changeType,
      p_requested_makeup_date: values.requestedMakeupDate || null,
      p_requested_start_time: null,
      p_reason: values.reason,
    });
    if (error) throw error;
    return data;
  },
  async listPending() {
    const { data, error } = await supabase.from('replacement_work_change_requests').select('*').eq('status', 'pending').order('created_at', { ascending: true });
    if (error) throw error;
    const changes = (data ?? []) as ReplacementWorkChangeRequest[];
    if (changes.length === 0) return [] as ReplacementWorkChangeReviewItem[];
    const { data: employees, error: employeeError } = await supabase.from('employees').select('id, full_name, employee_code').in('id', [...new Set(changes.map((change) => change.employee_id))]);
    if (employeeError) throw employeeError;
    const byId = new Map((employees ?? []).map((employee) => [employee.id, { full_name: employee.full_name, employee_code: employee.employee_code }]));
    return changes.map((change) => ({ ...change, employee: byId.get(change.employee_id) ?? null }));
  },
  async listReviewHistory(filters: ReplacementWorkChangeReviewHistoryFilters) {
    const { data, error } = await (supabase as any).rpc('list_replacement_work_change_review_history', {
      p_year: filters.year, p_month: filters.month, p_change_type: filters.changeType || null, p_region_id: filters.regionId || null,
      p_status: filters.status || null, p_search: filters.search?.trim() || null, p_page: filters.page, p_page_size: filters.pageSize,
    });
    if (error) throw error;
    return (data ?? []) as ReplacementWorkChangeReviewHistoryItem[];
  },
  async review(id: string, status: Extract<ReplacementWorkChangeStatus, 'approved' | 'rejected'>, note: string) {
    const { error } = await supabase.rpc('review_replacement_work_change_request', { p_request_id: id, p_status: status, p_note: note || null });
    if (error) throw error;
  },
};
