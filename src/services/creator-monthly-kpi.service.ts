import { supabase } from '../lib/supabase';
import type { CreatorPlatform } from './scout.service';

export type CreatorMonthlyKpiStatus = 'all' | 'pending' | 'updated' | 'achieved';
export type CreatorMonthlyKpiEnrollmentStatus = 'required' | 'not_required' | null;
export type CreatorMonthlyKpiPlatform = {
  platform: CreatorPlatform;
  platform_account: string | null;
  platform_user_id: string | null;
  revenue_target: number | null;
  revenue_current: number;
};

export type CreatorMonthlyKpiCard = {
  creator_entity_id: string;
  creator_name: string;
  manager_employee_id: string | null;
  manager_name: string | null;
  live_hours_target: number | null;
  live_days_target: number | null;
  live_hours_current: number;
  live_days_current: number;
  week_updated: boolean;
  kpi_enrollment_status: CreatorMonthlyKpiEnrollmentStatus;
  last_updated_at: string | null;
  platforms: CreatorMonthlyKpiPlatform[];
};

export type CreatorMonthlyKpiHistory = {
  id: string;
  week_start_date: string;
  live_hours_cumulative: number;
  live_days_cumulative: number;
  update_kind: 'reported' | 'confirmed_no_change';
  updated_by_name: string | null;
  created_at: string;
};

export type CreatorMonthlyKpiTargetInput = {
  creatorEntityId: string;
  liveHoursTarget: number;
  liveDaysTarget: number;
  platformTargets: Array<{ platform: CreatorPlatform; revenueTarget: number }>;
};

const db = supabase as any;

export const creatorMonthlyKpiService = {
  async listCards(input: { month: string; search?: string; status?: CreatorMonthlyKpiStatus; managerEmployeeId?: string }) {
    const { data, error } = await db.rpc('list_creator_monthly_kpi_cards', {
      p_month: `${input.month}-01`,
      p_search: input.search?.trim() || null,
      p_status: input.status && input.status !== 'all' ? input.status : null,
      p_manager_employee_id: input.managerEmployeeId || null,
    });
    if (error) throw error;
    return (data ?? []).map(mapCard);
  },

  async listManagerOptions() {
    const { data, error } = await db.rpc('list_creator_monthly_kpi_manager_options');
    if (error) throw error;
    return (data ?? []) as Array<{ id: string; display_name: string }>;
  },

  async getHistory(creatorEntityId: string, month: string) {
    const { data, error } = await db.rpc('get_creator_monthly_kpi_history', { p_creator_entity_id: creatorEntityId, p_month: `${month}-01` });
    if (error) throw error;
    return (data ?? []).map((row: any) => ({ ...row, live_hours_cumulative: Number(row.live_hours_cumulative), live_days_cumulative: Number(row.live_days_cumulative) })) as CreatorMonthlyKpiHistory[];
  },

  async saveTargets(month: string, targets: CreatorMonthlyKpiTargetInput[]) {
    const { error } = await db.rpc('save_creator_monthly_kpi_targets', {
      p_month: `${month}-01`,
      p_targets: targets.map((target) => ({ creator_entity_id: target.creatorEntityId, live_hours_target: target.liveHoursTarget, live_days_target: target.liveDaysTarget, platform_targets: target.platformTargets.map((platform) => ({ platform: platform.platform, revenue_target: platform.revenueTarget })) })),
    });
    if (error) throw error;
  },

  async saveEnrollments(month: string, enrollments: Array<{ creatorEntityId: string; status: Exclude<CreatorMonthlyKpiEnrollmentStatus, null> }>) {
    if (!enrollments.length) return;
    const { error } = await db.rpc('save_creator_monthly_kpi_enrollments', {
      p_month: `${month}-01`,
      p_enrollments: enrollments.map((item) => ({ creator_entity_id: item.creatorEntityId, status: item.status })),
    });
    if (error) throw error;
  },

  async copyPreviousMonth(sourceMonth: string, targetMonth: string) {
    const { data, error } = await db.rpc('copy_creator_monthly_kpi_targets', { p_source_month: `${sourceMonth}-01`, p_target_month: `${targetMonth}-01` });
    if (error) throw error;
    return data as { copied: number; skipped_existing: number; skipped_no_source: number };
  },

  async saveWeeklyUpdate(input: { creatorEntityId: string; month: string; hours: number; days: number; noChange: boolean; idempotencyKey: string }) {
    const { error } = await db.rpc('save_creator_monthly_kpi_weekly_update', {
      p_creator_entity_id: input.creatorEntityId, p_month: `${input.month}-01`, p_live_hours_cumulative: input.hours,
      p_live_days_cumulative: input.days, p_update_kind: input.noChange ? 'confirmed_no_change' : 'reported', p_idempotency_key: input.idempotencyKey,
    });
    if (error) throw error;
  },
};

function mapCard(row: any): CreatorMonthlyKpiCard {
  return {
    ...row,
    live_hours_target: row.live_hours_target == null ? null : Number(row.live_hours_target),
    live_days_target: row.live_days_target == null ? null : Number(row.live_days_target),
    live_hours_current: Number(row.live_hours_current) || 0,
    live_days_current: Number(row.live_days_current) || 0,
    platforms: (row.platforms ?? []).map((platform: any) => ({ ...platform, revenue_target: platform.revenue_target == null ? null : Number(platform.revenue_target), revenue_current: Number(platform.revenue_current) || 0 })),
  };
}
