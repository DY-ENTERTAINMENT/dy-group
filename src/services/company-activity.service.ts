import { supabase } from '../lib/supabase';
import type { CompanyActivityDay, Region } from '../types/database';

export const GLOBAL_REGION_VALUE = '__global__';
export type CompanyActivityFormValues = { activity_name: string; activity_date: string; region_id: string; notes: string };
export type CompanyActivityListItem = CompanyActivityDay & { region: Pick<Region, 'id' | 'code' | 'name'> | null };

export const companyActivityService = {
  async list(year: number, regionFilter: string) {
    let query = supabase.from('company_activity_days').select('*, region:regions!region_id(id, code, name)')
      .gte('activity_date', `${year}-01-01`).lte('activity_date', `${year}-12-31`).order('activity_date').order('activity_name');
    if (regionFilter === GLOBAL_REGION_VALUE) query = query.is('region_id', null);
    else if (regionFilter) query = query.eq('region_id', regionFilter);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as unknown as CompanyActivityListItem[];
  },
  async create(values: CompanyActivityFormValues) { const { error } = await supabase.from('company_activity_days').insert(normalize(values)); if (error) throw error; },
  async update(id: string, values: CompanyActivityFormValues) {
    const { data, error } = await supabase.from('company_activity_days').update(normalize(values)).eq('id', id).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('未找到可更新的公司活动，或您没有权限操作。');
  },
  async void(id: string) {
    const { data, error } = await supabase.from('company_activity_days').update({ status: 'voided' }).eq('id', id).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('未找到可作废的公司活动，或您没有权限操作。');
  },
};

function normalize(values: CompanyActivityFormValues) { return { activity_name: values.activity_name.trim(), activity_date: values.activity_date, region_id: values.region_id || null, attendance_exempt: true, notes: values.notes.trim() || null }; }
