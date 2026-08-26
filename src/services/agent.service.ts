import { supabase } from '../lib/supabase';
import { getEmployeeName, platformLabels, creatorTypeLabels, type CreatorPlatform, type CreatorProfile, type CreatorType } from './scout.service';
import type { Employee, Region } from '../types/database';

export type RevenueRecord = {
  id: string;
  creator_profile_id: string;
  revenue_month: string;
  revenue_date: string;
  revenue_amount: number;
  kpi_days: number;
  kpi_hours: number;
  kpi_revenue: number;
  achieved_days: number;
  achieved_hours: number;
  achieved_revenue: number;
  creator: CreatorProfile | null;
};

export type AdjustmentStatus = 'pending' | 'approved' | 'rejected';
export type AdjustmentType = 'to_online' | 'to_company' | 'to_5_1' | 'change_manager' | 'change_scout' | 'change_bank' | 'special';
export type DesignRequestStatus = 'unclaimed' | 'in_progress' | 'confirming' | 'revision' | 'ok' | 'completed' | 'cancelled';
export type DesignRequestType = 'banner' | 'standee' | 'poster' | 'special';
export type PrintMethod = 'print' | 'no_print' | 'self_print';

export type AgentOptions = {
  regions: Region[];
  employees: Array<Pick<Employee, 'id' | 'full_name' | 'nickname' | 'profile_id' | 'region_id' | 'email'>>;
  currentEmployee: Pick<Employee, 'id' | 'full_name' | 'nickname' | 'profile_id' | 'region_id' | 'email'> | null;
};

export type AdjustmentTargetEmployee = Pick<Employee, 'id' | 'employee_code' | 'full_name' | 'nickname' | 'email' | 'region_id'>;
export type AdjustmentTargetType = 'manager' | 'scout';

export type AdjustmentRequest = {
  id: string;
  platform: CreatorPlatform;
  platform_user_id: string | null;
  creator_profile_id: string | null;
  request_type: AdjustmentType;
  effective_date: string | null;
  full_name: string | null;
  bank_name: string | null;
  bank_account: string | null;
  target_nickname: string | null;
  target_email: string | null;
  content: string | null;
  status: AdjustmentStatus;
  created_at: string;
  creator: Pick<CreatorProfile, 'id' | 'creator_name' | 'platform_account' | 'platform_user_id'> | null;
};

type AdjustmentEmployee = Pick<Employee, 'id' | 'full_name' | 'nickname' | 'email'> & { employee_code?: string | null };

export type AdjustmentReviewRequest = AdjustmentRequest & {
  requester_profile_id: string;
  requester_employee_id: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  requester: AdjustmentEmployee | null;
  reviewer: { id: string; full_name: string | null; nickname: string | null; email: string | null } | null;
};

export type AdjustmentFormValues = {
  platform: CreatorPlatform;
  platform_user_id: string;
  request_type: AdjustmentType;
  effective_date: string;
  full_name: string;
  bank_name: string;
  bank_account: string;
  target_nickname: string;
  target_email: string;
  content: string;
};

export type DesignRequest = {
  id: string;
  request_type: DesignRequestType;
  status: DesignRequestStatus;
  platform: CreatorPlatform | null;
  platform_user_id: string | null;
  creator_name: string | null;
  platform_account: string | null;
  fan_nickname: string | null;
  fan_level: string | null;
  design_content: string | null;
  design_elements: string | null;
  print_method: PrintMethod | null;
  special_content: string | null;
  reference_urls: string[];
  design_urls: string[];
  revision_note: string | null;
  agent_employee_id: string | null;
  designer_employee_id: string | null;
  accepted_at: string | null;
  completed_at: string | null;
  created_at: string;
  agent: Pick<Employee, 'id' | 'full_name' | 'nickname'> | null;
  designer: Pick<Employee, 'id' | 'full_name' | 'nickname'> | null;
};

export type DesignFormValues = {
  request_type: DesignRequestType;
  platform: CreatorPlatform;
  platform_user_id: string;
  creator_name: string;
  platform_account: string;
  fan_nickname: string;
  fan_level: string;
  design_content: string;
  design_elements: string;
  print_method: PrintMethod;
  special_content: string;
  reference_urls: string;
};

export type RevenueSummary = {
  total: number;
  plusFiveOne: number;
  nonFiveOne: number;
};

export type WeeklyRevenueStatus = 'draft' | 'submitted' | 'confirmed';

export type WeeklyRevenueRecord = {
  id: string;
  creator_entity_id: string | null;
  creator_profile_id: string;
  platform: CreatorPlatform;
  platform_uid: string;
  week_start_date: string;
  week_end_date: string;
  revenue_amount: number;
  revenue_unit: 'diamond' | 'yinlang';
  source: 'manual' | 'csv' | 'api';
  source_reference: string | null;
  agent_note: string | null;
  manager_note: string | null;
  status: WeeklyRevenueStatus;
  submitted_by_employee_id: string | null;
  submitted_at: string | null;
  confirmed_by_employee_id: string | null;
  confirmed_at: string | null;
  created_by_employee_id: string | null;
  updated_by_employee_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ManagementRevenueStatusFilter = '' | 'pending' | 'confirmed';

export type ManagementRevenueRecord = WeeklyRevenueRecord & {
  creator: CreatorProfile | null;
  submittedBy: Pick<Employee, 'id' | 'full_name' | 'nickname' | 'email'> | null;
  confirmedBy: Pick<Employee, 'id' | 'full_name' | 'nickname' | 'email'> | null;
};

export type ManagementRevenueFilters = {
  startMonth: string;
  endMonth: string;
  managerEmployeeId?: string;
  creatorSearch?: string;
  platform?: '' | CreatorPlatform;
  creatorType?: '' | '5+1' | 'non_5_1';
  regionId?: string;
  status?: ManagementRevenueStatusFilter;
};

export type WeeklyRevenueSaveInput = {
  recordId?: string;
  creatorProfileId: string;
  weekStartDate: string;
  weekEndDate: string;
  revenueAmount: number;
  agentNote: string;
};

const db = supabase as any;

const creatorSelect = `
  id,
  creator_entity_id,
  joined_date,
  platform,
  platform_user_id,
  platform_account,
  region_id,
  creator_name,
  scout_employee_id,
  scout_profile_id,
  manager_employee_id,
  status,
  creator_type,
  bank_name,
  bank_account,
  created_at,
  updated_at,
  regions:region_id(id, code, name),
  scout:employees!creator_profiles_scout_employee_id_fkey(id, full_name, nickname),
  manager:employees!creator_profiles_manager_employee_id_fkey(id, full_name, nickname)
`;

const revenueSelect = `
  id,
  creator_profile_id,
  revenue_month,
  revenue_date,
  revenue_amount,
  kpi_days,
  kpi_hours,
  kpi_revenue,
  achieved_days,
  achieved_hours,
  achieved_revenue,
  creator:creator_profiles!creator_revenue_records_creator_profile_id_fkey(${creatorSelect})
`;

const weeklyRevenueSelect = `
  id,
  creator_entity_id,
  creator_profile_id,
  platform,
  platform_uid,
  week_start_date,
  week_end_date,
  revenue_amount,
  revenue_unit,
  source,
  source_reference,
  agent_note,
  manager_note,
  status,
  submitted_by_employee_id,
  submitted_at,
  confirmed_by_employee_id,
  confirmed_at,
  created_by_employee_id,
  updated_by_employee_id,
  created_at,
  updated_at
`;

const managementWeeklyRevenueSelect = `
  ${weeklyRevenueSelect},
  creator:creator_profiles!inner(${creatorSelect}),
  submitted_by:employees!creator_weekly_revenue_records_submitted_by_employee_id_fkey(id, full_name, nickname, email),
  confirmed_by:employees!creator_weekly_revenue_records_confirmed_by_employee_id_fkey(id, full_name, nickname, email)
`;

const designSelect = `
  id,
  request_type,
  status,
  platform,
  platform_user_id,
  creator_name,
  platform_account,
  fan_nickname,
  fan_level,
  design_content,
  design_elements,
  print_method,
  special_content,
  reference_urls,
  design_urls,
  revision_note,
  agent_employee_id,
  designer_employee_id,
  accepted_at,
  completed_at,
  created_at,
  agent:employees!designer_requests_agent_employee_id_fkey(id, full_name, nickname),
  designer:employees!designer_requests_designer_employee_id_fkey(id, full_name, nickname)
`;

export const adjustmentTypeLabels: Record<AdjustmentType, string> = {
  to_online: '转线上',
  to_company: '转公司提',
  to_5_1: '转5+1',
  change_manager: '转经纪人',
  change_scout: '转星探',
  change_bank: '更换银行户口',
  special: '特殊申请',
};

export const adjustmentStatusLabels: Record<AdjustmentStatus, string> = {
  pending: '审核中',
  approved: '已通过',
  rejected: '不通过',
};

export const designTypeLabels: Record<DesignRequestType, string> = {
  banner: '布条',
  standee: '立牌',
  poster: '海报',
  special: '特殊申请',
};

export const designStatusLabels: Record<DesignRequestStatus, string> = {
  unclaimed: '未接单',
  in_progress: '制作中',
  confirming: '跟主播确认中',
  revision: '调整中',
  ok: 'OK',
  completed: '完成',
  cancelled: '已取消',
};

export const printMethodLabels: Record<PrintMethod, string> = {
  print: '打印',
  no_print: '不打印',
  self_print: '自费打印',
};

export const agentService = {
  async getOptions(profileId?: string): Promise<AgentOptions> {
    const [regionsResult, employeesResult] = await Promise.all([
      supabase.from('regions').select('*').eq('is_active', true).order('sort_order', { ascending: true }),
      supabase.from('employees').select('id, full_name, nickname, profile_id, region_id, email').is('deleted_at', null).order('full_name', { ascending: true }),
    ]);
    if (regionsResult.error) throw regionsResult.error;
    if (employeesResult.error) throw employeesResult.error;
    const employees = (employeesResult.data ?? []) as AgentOptions['employees'];
    return { regions: regionsResult.data ?? [], employees, currentEmployee: employees.find((employee) => employee.profile_id === profileId) ?? null };
  },

  async listManagedCreators(profileId: string, filters: { month?: string; platform?: string; regionId?: string }) {
    const options = await this.getOptions(profileId);
    if (!options.currentEmployee) return [];
    let query = db
      .from('creator_profiles')
      .select(creatorSelect)
      .eq('manager_employee_id', options.currentEmployee.id)
      .eq('status', 'active')
      .order('joined_date', { ascending: false });
    if (filters.platform) query = query.eq('platform', filters.platform);
    if (filters.regionId) query = query.eq('region_id', filters.regionId);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).filter((row: any) => !filters.month || String(row.joined_date).startsWith(filters.month)).map(mapCreatorRow);
  },

  async listRevenueData(input: { profileId?: string; month: string; platform?: string; regionId?: string; management?: boolean }) {
    let creatorIds: string[] | null = null;
    if (!input.management && input.profileId) {
      const creators = await this.listManagedCreators(input.profileId, { platform: input.platform, regionId: input.regionId });
      const nextCreatorIds = creators.map((creator: CreatorProfile) => creator.id);
      if (nextCreatorIds.length === 0) return [];
      creatorIds = nextCreatorIds;
    }

    let query = db.from('creator_revenue_records').select(revenueSelect).eq('revenue_month', input.month).order('revenue_date', { ascending: false });
    if (creatorIds !== null) query = query.in('creator_profile_id', creatorIds);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? [])
      .filter((row: any) => row.creator?.status !== 'invalid')
      .map(mapRevenueRow)
      .filter((row: RevenueRecord) => !input.platform || row.creator?.platform === input.platform)
      .filter((row: RevenueRecord) => !input.regionId || row.creator?.region_id === input.regionId);
  },

  async listWeeklyRevenueRecords(input: { creatorProfileIds: string[]; weekStartDate: string }): Promise<WeeklyRevenueRecord[]> {
    if (input.creatorProfileIds.length === 0) return [];

    const { data, error } = await db
      .from('creator_weekly_revenue_records')
      .select(weeklyRevenueSelect)
      .in('creator_profile_id', input.creatorProfileIds)
      .eq('week_start_date', input.weekStartDate);
    if (error) throw error;
    return (data ?? []).map(mapWeeklyRevenueRow);
  },

  async listManagementRevenueRecords(filters: ManagementRevenueFilters): Promise<ManagementRevenueRecord[]> {
    const normalizedRange = normalizeManagementMonthRange(filters.startMonth, filters.endMonth);
    let query = db
      .from('creator_weekly_revenue_records')
      .select(managementWeeklyRevenueSelect)
      .gte('week_start_date', normalizedRange.startIso)
      .lte('week_start_date', normalizedRange.endIso)
      .in('status', ['submitted', 'confirmed'])
      .order('week_start_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(2000);

    if (filters.platform) query = query.eq('platform', filters.platform);
    if (filters.regionId) query = query.eq('creator.region_id', filters.regionId);
    if (filters.managerEmployeeId) query = query.eq('creator.manager_employee_id', filters.managerEmployeeId);
    if (filters.creatorType === '5+1') query = query.eq('creator.creator_type', '5+1');
    if (filters.creatorType === 'non_5_1') query = query.neq('creator.creator_type', '5+1');
    if (filters.status === 'pending') query = query.eq('status', 'submitted');
    if (filters.status === 'confirmed') query = query.eq('status', 'confirmed');

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? [])
      .map(mapManagementRevenueRow)
      .filter((record: ManagementRevenueRecord) => record.creator?.status !== 'invalid')
      .filter((record: ManagementRevenueRecord) => matchesManagementRevenueSearch(record, filters.creatorSearch ?? ''));
  },

  async confirmManagementWeeklyRevenueRecord(recordId: string): Promise<WeeklyRevenueRecord> {
    const { data, error } = await db.rpc('confirm_creator_weekly_revenue_record', { p_record_id: recordId });
    if (error) throw error;
    return mapWeeklyRevenueRow(data);
  },

  async reviewManagementWeeklyRevenueRecord(recordId: string, managerNote: string | null): Promise<WeeklyRevenueRecord> {
    const normalizedNote = managerNote?.trim() || null;
    const { data, error } = await db.rpc('review_creator_weekly_revenue_record', {
      p_record_id: recordId,
      p_manager_note: normalizedNote,
    });
    if (error) throw error;
    return mapWeeklyRevenueRow(data);
  },

  async cancelManagementWeeklyRevenueEntry(recordId: string, reason: string) {
    const normalizedReason = reason.trim();
    if (!normalizedReason) throw new Error('取消原因必须填写。');
    const { error } = await db.rpc('cancel_creator_weekly_revenue_entry', { p_record_id: recordId, p_reason: normalizedReason });
    if (error) throw error;
  },

  async submitWeeklyRevenue(input: WeeklyRevenueSaveInput): Promise<WeeklyRevenueRecord> {
    return saveWeeklyRevenueRecord(input, 'submitted');
  },

  async listAdjustments(profileId: string): Promise<AdjustmentRequest[]> {
    const { data, error } = await db
      .from('creator_adjustment_requests')
      .select('*, creator:creator_profiles(id, creator_name, platform_account, platform_user_id)')
      .eq('requester_profile_id', profileId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async listAdjustmentReviews(): Promise<AdjustmentReviewRequest[]> {
    const { data, error } = await db
      .from('creator_adjustment_requests')
      .select('*, creator:creator_profiles(id, creator_name, platform_account, platform_user_id), requester:employees!creator_adjustment_requests_requester_employee_id_fkey(id, employee_code, full_name, nickname, email), reviewer:profiles!creator_adjustment_requests_reviewed_by_fkey(id, full_name, nickname, email)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async listAdjustmentTargetEmployees(targetType: AdjustmentTargetType): Promise<AdjustmentTargetEmployee[]> {
    const { data, error } = await db.rpc('get_agent_adjustment_target_employees', { p_target_type: targetType });
    if (error) throw error;
    return data ?? [];
  },

  async createAdjustment(profileId: string, values: AdjustmentFormValues) {
    validateAdjustmentTarget(values);
    const { error } = await db.from('creator_adjustment_requests').insert({ requester_profile_id: profileId, ...normalizeAdjustment(values) });
    if (error) throw error;
  },

  async reviewAdjustmentRequest(profileId: string, input: { id: string; status: Extract<AdjustmentStatus, 'approved' | 'rejected'>; reviewNote?: string }) {
    const trimmedNote = input.reviewNote?.trim() ?? '';
    if (input.status === 'rejected' && !trimmedNote) {
      throw new Error('拒绝原因必须填写。');
    }

    const { data: currentRequest, error: currentRequestError } = await db
      .from('creator_adjustment_requests')
      .select('request_type, target_email, status')
      .eq('id', input.id)
      .maybeSingle();
    if (currentRequestError) throw currentRequestError;
    if (!currentRequest || currentRequest.status !== 'pending') throw new Error('这笔申请已审批或不存在。');
    if (input.status === 'approved' && requiresTargetEmail(currentRequest.request_type as AdjustmentType) && !currentRequest.target_email?.trim()) {
      throw new Error(currentRequest.request_type === 'change_manager' ? '目标经纪人 Email 缺失，请申请人重新提交。' : '目标星探 Email 缺失，请申请人重新提交。');
    }

    const { data, error } = await db
      .from('creator_adjustment_requests')
      .update({
        status: input.status,
        reviewed_by: profileId,
        reviewed_at: new Date().toISOString(),
        review_note: trimmedNote || null,
      })
      .eq('id', input.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('这笔申请已审批或不存在。');
  },

  async listDesignRequests(filters: { profileId?: string; designerProfileId?: string; mode: 'agent' | 'intake' | 'progress' }) {
    let query = db.from('designer_requests').select(designSelect).order('created_at', { ascending: filters.mode === 'intake' });
    if (filters.mode === 'agent' && filters.profileId) query = query.eq('agent_profile_id', filters.profileId);
    if (filters.mode === 'intake') query = query.eq('status', 'unclaimed');
    if (filters.mode === 'progress' && filters.designerProfileId) query = query.eq('designer_profile_id', filters.designerProfileId).neq('status', 'completed').neq('status', 'cancelled');
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map(mapDesignRow);
  },

  async createDesignRequest(profileId: string, values: DesignFormValues) {
    const options = await this.getOptions(profileId);
    const { error } = await db.from('designer_requests').insert({ agent_profile_id: profileId, agent_employee_id: options.currentEmployee?.id ?? null, ...normalizeDesign(values) });
    if (error) throw error;
  },

  async claimDesignRequest(profileId: string, requestId: string) {
    const options = await this.getOptions(profileId);
    const { error } = await db.from('designer_requests').update({ status: 'in_progress', designer_profile_id: profileId, designer_employee_id: options.currentEmployee?.id ?? null, accepted_at: new Date().toISOString() }).eq('id', requestId);
    if (error) throw error;
  },

  async updateDesignStatus(requestId: string, status: DesignRequestStatus, extras: { revisionNote?: string; designUrls?: string } = {}) {
    const payload: Record<string, unknown> = { status };
    if (extras.revisionNote !== undefined) payload.revision_note = extras.revisionNote.trim() || null;
    if (extras.designUrls !== undefined) payload.design_urls = splitLines(extras.designUrls);
    if (status === 'completed') payload.completed_at = new Date().toISOString();
    const { error } = await db.from('designer_requests').update(payload).eq('id', requestId);
    if (error) throw error;
  },
};

export function summarizeRevenue(records: RevenueRecord[]): RevenueSummary {
  return records.reduce<RevenueSummary>((summary, record) => {
    const value = Number(record.revenue_amount) || 0;
    summary.total += value;
    if (record.creator?.creator_type === '5+1') summary.plusFiveOne += value;
    else summary.nonFiveOne += value;
    return summary;
  }, { total: 0, plusFiveOne: 0, nonFiveOne: 0 });
}

export function createRevenueBreakdown(records: RevenueRecord[]) {
  return {
    total: summarizeRevenue(records),
    tiktok: summarizeRevenue(records.filter((record) => record.creator?.platform === 'tiktok')),
    douyin: summarizeRevenue(records.filter((record) => record.creator?.platform === 'douyin')),
  };
}

export function formatMoney(value: number) {
  return `RM ${value.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export { getEmployeeName, platformLabels, creatorTypeLabels };

function normalizeAdjustment(values: AdjustmentFormValues) {
  return {
    platform: values.platform,
    platform_user_id: values.platform_user_id.trim() || null,
    request_type: values.request_type,
    effective_date: values.effective_date || null,
    full_name: values.full_name.trim() || null,
    bank_name: values.bank_name.trim() || null,
    bank_account: values.bank_account.trim() || null,
    target_nickname: values.target_nickname.trim() || null,
    target_email: values.target_email.trim() || null,
    content: values.content.trim() || null,
  };
}

function validateAdjustmentTarget(values: AdjustmentFormValues) {
  if (!requiresTargetEmail(values.request_type)) return;
  if (!values.target_nickname.trim()) {
    throw new Error(values.request_type === 'change_manager' ? '目标经纪人昵称必须填写。' : '目标星探昵称必须填写。');
  }
  if (!values.target_email.trim()) {
    throw new Error(values.request_type === 'change_manager' ? '目标经纪人 Email 缺失，请填写后再提交。' : '目标星探 Email 缺失，请填写后再提交。');
  }
}

function requiresTargetEmail(requestType: AdjustmentType) {
  return requestType === 'change_manager' || requestType === 'change_scout';
}

function normalizeDesign(values: DesignFormValues) {
  const isSpecial = values.request_type === 'special';
  return {
    request_type: values.request_type,
    platform: isSpecial ? null : values.platform,
    platform_user_id: isSpecial ? null : values.platform_user_id.trim() || null,
    creator_name: isSpecial ? null : values.creator_name.trim() || null,
    platform_account: isSpecial ? null : values.platform_account.trim() || null,
    fan_nickname: values.request_type === 'banner' || values.request_type === 'standee' ? values.fan_nickname.trim() || null : null,
    fan_level: values.request_type === 'banner' || values.request_type === 'standee' ? values.fan_level.trim() || null : null,
    design_content: values.request_type === 'poster' || values.request_type === 'banner' || values.request_type === 'standee' ? values.design_content.trim() || null : null,
    design_elements: values.request_type === 'poster' ? values.design_elements.trim() || null : null,
    print_method: values.request_type === 'banner' || values.request_type === 'standee' ? values.print_method : null,
    special_content: isSpecial ? values.special_content.trim() || null : null,
    reference_urls: splitLines(values.reference_urls),
  };
}

function splitLines(value: string) {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

async function saveWeeklyRevenueRecord(input: WeeklyRevenueSaveInput, status: Extract<WeeklyRevenueStatus, 'submitted'>) {
  await ensureWeeklyRevenuePeriodFlow(input.weekStartDate, input.weekEndDate);

  const payload = {
    creator_profile_id: input.creatorProfileId,
    week_start_date: input.weekStartDate,
    week_end_date: input.weekEndDate,
    revenue_amount: input.revenueAmount,
    agent_note: input.agentNote.trim() || null,
    status,
    source: 'manual',
  };

  const query = input.recordId
    ? db
        .from('creator_weekly_revenue_records')
        .update(payload)
        .eq('id', input.recordId)
        .select(weeklyRevenueSelect)
        .single()
    : db
        .from('creator_weekly_revenue_records')
        .insert(payload)
        .select(weeklyRevenueSelect)
        .single();

  const { data, error } = await query;
  if (error) throw error;
  return mapWeeklyRevenueRow(data);
}

async function ensureWeeklyRevenuePeriodFlow(weekStartDate: string, weekEndDate: string) {
  const { data, error } = await db.rpc('creator_weekly_revenue_period_end', { p_period_start: weekStartDate });
  if (error) {
    throw new Error('周期流水数据库 003 尚未启用，暂不能保存新周期流水。');
  }
  if (data && String(data) !== weekEndDate) {
    throw new Error('前端周期与数据库周期规则不一致，暂不能保存。');
  }
}

function mapCreatorRow(row: any): CreatorProfile {
  return {
    id: row.id,
    creator_entity_id: row.creator_entity_id,
    joined_date: row.joined_date,
    platform: row.platform,
    platform_user_id: row.platform_user_id,
    platform_account: row.platform_account,
    region_id: row.region_id,
    creator_name: row.creator_name,
    scout_employee_id: row.scout_employee_id,
    scout_profile_id: row.scout_profile_id,
    manager_employee_id: row.manager_employee_id,
    creator_type: row.creator_type,
    bank_name: row.bank_name,
    bank_account: row.bank_account,
    created_at: row.created_at,
    updated_at: row.updated_at,
    region: row.regions,
    scout: row.scout,
    manager: row.manager,
  };
}

function mapRevenueRow(row: any): RevenueRecord {
  return { ...row, creator: row.creator ? mapCreatorRow(row.creator) : null };
}

function mapWeeklyRevenueRow(row: any): WeeklyRevenueRecord {
  return {
    ...row,
    revenue_amount: Number(row.revenue_amount),
  };
}

function mapManagementRevenueRow(row: any): ManagementRevenueRecord {
  return {
    ...mapWeeklyRevenueRow(row),
    creator: row.creator ? mapCreatorRow(row.creator) : null,
    submittedBy: row.submitted_by ?? null,
    confirmedBy: row.confirmed_by ?? null,
  };
}

function mapDesignRow(row: any): DesignRequest {
  return {
    ...row,
    reference_urls: row.reference_urls ?? [],
    design_urls: row.design_urls ?? [],
  };
}

function normalizeManagementMonthRange(startMonth: string, endMonth: string) {
  const start = isValidMonth(startMonth) ? startMonth : new Date().toISOString().slice(0, 7);
  const end = isValidMonth(endMonth) ? endMonth : start;
  const [safeStart, safeEnd] = start <= end ? [start, end] : [end, start];
  const [endYear, endMonthNumber] = safeEnd.split('-').map(Number);
  const endDay = new Date(endYear, endMonthNumber, 0).getDate();
  return {
    startIso: `${safeStart}-01`,
    endIso: `${safeEnd}-${String(endDay).padStart(2, '0')}`,
  };
}

function isValidMonth(value: string) {
  return /^\d{4}-\d{2}$/.test(value);
}

function matchesManagementRevenueSearch(record: ManagementRevenueRecord, search: string) {
  const normalizedSearch = search.trim().toLowerCase();
  if (!normalizedSearch) return true;
  return [
    record.creator?.creator_name,
    record.creator?.platform_user_id,
    record.creator?.platform_account,
    record.creator?.region?.code,
    record.creator?.region?.name,
    getEmployeeName(record.creator?.manager),
  ].join(' ').toLowerCase().includes(normalizedSearch);
}

