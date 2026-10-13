import { supabase } from '../lib/supabase';
export type RevenueCycle = 'weekly' | 'monthly' | 'none';
export type MonthlyRevenueRecord = {
  id: string; creator_profile_id: string; revenue_month: string; platform: 'tiktok' | 'douyin';
  revenue_amount: number; revenue_unit: 'diamond' | 'yinlang'; agent_note: string | null; version: number;
};
export type RevenueMonthContext = {
  creator_profile_id: string; effective_cycle: RevenueCycle | null;
  cycle_source: 'VERIFIED' | 'LEGACY_CURRENT_WEEKLY' | 'LEGACY_UNKNOWN'; monthly_record: MonthlyRevenueRecord | null; can_write: boolean;
};
const rpc = supabase as any;
export const revenueCycleService = {
  async monthContext(ids: string[], month: string): Promise<RevenueMonthContext[]> {
    const result: RevenueMonthContext[] = [];
    for (let offset = 0; offset < ids.length; offset += 500) {
      const { data, error } = await rpc.rpc('list_creator_revenue_month_context', { p_profile_ids: ids.slice(offset, offset + 500), p_month: `${month}-01` });
      if (error) throw error;
      result.push(...(data ?? []).map((row: RevenueMonthContext) => ({ ...row, monthly_record: row.monthly_record ? { ...row.monthly_record, revenue_amount: Number(row.monthly_record.revenue_amount) } : null })));
    }
    return result;
  },
  async saveMonthly(input: { profileId: string; month: string; amount: number; note: string; version: number; requestId: string }): Promise<MonthlyRevenueRecord> {
    const { data, error } = await rpc.rpc('save_creator_monthly_revenue', {
      p_profile_id: input.profileId, p_month: `${input.month}-01`, p_amount: input.amount,
      p_note: input.note, p_expected_version: input.version, p_idempotency_key: input.requestId,
    });
    if (error) throw error;
    return { ...data, revenue_amount: Number(data.revenue_amount) };
  },
};
