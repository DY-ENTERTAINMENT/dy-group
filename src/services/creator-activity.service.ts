import { supabase } from '../lib/supabase';
import type { CreatorActivity, CreatorActivityType } from '../types/database';

export type CreatorActivityForm = { creator_entity_id: string; title: string; activity_date: string; activity_time: string; activity_type: CreatorActivityType; agent_remark: string; };
export type CalendarActivity = CreatorActivity & { creator_name: string; region_id: string; agent_name: string; };
export type CalendarMilestoneSource = { creator_entity_id: string; creator_name: string; guild_joined_date: string | null; birthday: string | null; manager_employee_id: string | null; manager_name: string | null; region_id: string; platforms: string[]; joined_dates: string[]; };
export type CalendarRegionLabel = { id: string; code: string; name: string; };
export const creatorActivityTypeLabels: Record<CreatorActivityType, string> = { guild_activity: '公会活动', live: '直播活动', shooting: '拍摄', offline_activity: '线下活动', other: '其他' };

function monthDate(month: string) { return `${month}-01`; }
export const creatorActivityService = {
  async listMine(month: string) { const { data, error } = await (supabase as any).rpc('list_my_creator_activities', { p_month: monthDate(month) }); if (error) throw error; return (data ?? []) as CreatorActivity[]; },
  async create(values: CreatorActivityForm) { const { data, error } = await (supabase as any).rpc('create_creator_activity', { p_creator_entity_id: values.creator_entity_id, p_title: values.title, p_activity_date: values.activity_date, p_activity_time: values.activity_time || null, p_activity_type: values.activity_type, p_agent_remark: values.agent_remark || null }); if (error) throw error; return data as CreatorActivity; },
  async update(id: string, values: CreatorActivityForm) { const { data, error } = await (supabase as any).rpc('update_creator_activity', { p_id: id, p_title: values.title, p_activity_date: values.activity_date, p_activity_time: values.activity_time || null, p_activity_type: values.activity_type, p_agent_remark: values.agent_remark || null }); if (error) throw error; return data as CreatorActivity; },
  async listCalendar(month: string) { const { data, error } = await (supabase as any).rpc('list_creator_activity_calendar', { p_month: monthDate(month) }); if (error) throw error; return (data ?? []) as CalendarActivity[]; },
  async listMilestoneSources() { const { data, error } = await (supabase as any).rpc('list_creator_activity_calendar_milestone_sources'); if (error) throw error; return (data ?? []) as CalendarMilestoneSource[]; },
  async listRegionLabels(regionIds: string[]): Promise<CalendarRegionLabel[]> { const ids = [...new Set(regionIds.filter(Boolean))]; if (!ids.length) return []; const { data, error } = await supabase.from('regions').select('id, code, name').in('id', ids); if (error) throw error; return (data ?? []) as CalendarRegionLabel[]; },
  async updateLeadRemark(id: string, remark: string) { const { data, error } = await (supabase as any).rpc('update_creator_activity_lead_remark', { p_id: id, p_lead_remark: remark || null }); if (error) throw error; return data as CreatorActivity; },
  async saveMilestoneNote(creatorEntityId: string, type: string, date: string, remark: string) { const { data, error } = await (supabase as any).rpc('upsert_creator_milestone_note', { p_creator_entity_id: creatorEntityId, p_milestone_type: type, p_milestone_date: date, p_agent_remark: remark || null }); if (error) throw error; return data; },
  async getMilestoneNote(creatorEntityId: string, type: string, date: string): Promise<{ agent_remark: string | null } | null> { const { data, error } = await (supabase as any).rpc('get_creator_milestone_note', { p_creator_entity_id: creatorEntityId, p_milestone_type: type, p_milestone_date: date }); if (error) throw error; return data ?? null; },
};
