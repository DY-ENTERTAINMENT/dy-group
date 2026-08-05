import { supabase } from '../lib/supabase';
import type { Employee, Region } from '../types/database';

export type CandidateStatus = 'pending' | 'accepted' | 'rejected';
export type CreatorPlatform = 'tiktok' | 'douyin';
export type CreatorType = '5+1' | 'online' | 'offline' | 'company';

export type CandidateFormValues = {
  name: string;
  gender: string;
  age: string;
  source: string;
  contact: string;
  current_job: string;
  remark: string;
};

export type Candidate = Omit<CandidateFormValues, 'age'> & {
  id: string;
  age: number | null;
  status: CandidateStatus;
  scout_profile_id: string;
  created_at: string;
  updated_at: string;
};

export type CreatorFormValues = {
  joined_date: string;
  platform: CreatorPlatform;
  platform_user_id: string;
  platform_account: string;
  region_id: string;
  creator_name: string;
  scout_employee_id: string;
  manager_employee_id: string;
  creator_type: CreatorType;
  bank_name: string;
  bank_account: string;
};

export type CreatorProfile = {
  id: string;
  joined_date: string;
  platform: CreatorPlatform;
  platform_user_id: string;
  platform_account: string;
  region_id: string | null;
  creator_name: string;
  scout_employee_id: string | null;
  scout_profile_id: string | null;
  manager_employee_id: string | null;
  creator_type: CreatorType;
  bank_name: string | null;
  bank_account: string | null;
  created_at: string;
  updated_at: string;
  region: Pick<Region, 'id' | 'code' | 'name'> | null;
  scout: Pick<Employee, 'id' | 'full_name' | 'nickname'> | null;
  manager: Pick<Employee, 'id' | 'full_name' | 'nickname'> | null;
};

export type ScoutOptions = {
  regions: Region[];
  employees: Array<Pick<Employee, 'id' | 'full_name' | 'nickname' | 'profile_id' | 'region_id'>>;
};

export type OnboardingManagerOption = {
  id: string;
  display_name: string;
};

export type CreatorManagerDisplayName = {
  creator_id: string;
  manager_employee_id: string;
  manager_display_name: string;
};

export type RecruitSummary = {
  total: number;
  plusFiveOne: number;
  nonFiveOne: number;
  tiktok: number;
  douyin: number;
};

export type RecruitBreakdown = {
  total: RecruitSummary;
  tiktok: RecruitSummary;
  douyin: RecruitSummary;
};

export type ScoutRecruitSummary = RecruitSummary & {
  scoutId: string;
  scoutName: string;
};

export type RegionRecruitSummary = RecruitSummary & {
  regionId: string;
  regionName: string;
};

const creatorSelect = `
  id,
  joined_date,
  platform,
  platform_user_id,
  platform_account,
  region_id,
  creator_name,
  scout_employee_id,
  scout_profile_id,
  manager_employee_id,
  creator_type,
  bank_name,
  bank_account,
  created_at,
  updated_at,
  regions:region_id(id, code, name),
  scout:employees!creator_profiles_scout_employee_id_fkey(id, full_name, nickname),
  manager:employees!creator_profiles_manager_employee_id_fkey(id, full_name, nickname)
`;

export const creatorTypeLabels: Record<CreatorType, string> = {
  '5+1': '5+1',
  online: '线上',
  offline: '线下',
  company: '公司提',
};

export const platformLabels: Record<CreatorPlatform, string> = {
  tiktok: 'TikTok',
  douyin: '抖音',
};

const db = supabase as any;

export const scoutService = {
  async getOptions(): Promise<ScoutOptions> {
    const [regionsResult, employeesResult] = await Promise.all([
      supabase.from('regions').select('*').eq('is_active', true).order('sort_order', { ascending: true }),
      supabase
        .from('employees')
        .select('id, full_name, nickname, profile_id, region_id')
        .is('deleted_at', null)
        .order('full_name', { ascending: true }),
    ]);

    if (regionsResult.error) throw regionsResult.error;
    if (employeesResult.error) throw employeesResult.error;

    return {
      regions: regionsResult.data ?? [],
      employees: (employeesResult.data ?? []) as ScoutOptions['employees'],
    };
  },

  async listOnboardingManagerOptions(): Promise<OnboardingManagerOption[]> {
    const { data, error } = await db.rpc('get_scout_onboarding_manager_options');
    if (error) throw error;

    return ((data ?? []) as Array<{ employee_id: string; display_name: string }>).map((employee) => ({
      id: employee.employee_id,
      display_name: employee.display_name,
    }));
  },

  async listVisibleCreatorManagerDisplayNames(): Promise<CreatorManagerDisplayName[]> {
    const { data, error } = await db.rpc('get_visible_creator_manager_display_names');
    if (error) throw error;

    return ((data ?? []) as CreatorManagerDisplayName[]).map((manager) => ({
      creator_id: manager.creator_id,
      manager_employee_id: manager.manager_employee_id,
      manager_display_name: manager.manager_display_name,
    }));
  },

  async listCandidates(profileId: string): Promise<Candidate[]> {
    const { data, error } = await db
      .from('scout_candidates')
      .select('*')
      .eq('scout_profile_id', profileId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data ?? [];
  },

  async createCandidate(profileId: string, values: CandidateFormValues) {
    const { error } = await db.from('scout_candidates').insert({
      ...normalizeCandidate(values),
      scout_profile_id: profileId,
    });

    if (error) throw error;
  },

  async updateCandidate(candidateId: string, values: CandidateFormValues) {
    const { error } = await db.from('scout_candidates').update(normalizeCandidate(values)).eq('id', candidateId);
    if (error) throw error;
  },

  async setCandidateStatus(candidateId: string, status: CandidateStatus) {
    const { error } = await db.from('scout_candidates').update({ status }).eq('id', candidateId);
    if (error) throw error;
  },

  async listCreators(filters: { personalProfileId?: string; platform?: string; regionId?: string; scoutEmployeeId?: string; managerEmployeeId?: string; creatorType?: string }) {
    let query = db.from('creator_profiles').select(creatorSelect).order('joined_date', { ascending: false });

    if (filters.personalProfileId) query = query.eq('scout_profile_id', filters.personalProfileId);
    if (filters.platform) query = query.eq('platform', filters.platform);
    if (filters.regionId) query = query.eq('region_id', filters.regionId);
    if (filters.scoutEmployeeId) query = query.eq('scout_employee_id', filters.scoutEmployeeId);
    if (filters.managerEmployeeId) query = query.eq('manager_employee_id', filters.managerEmployeeId);
    if (filters.creatorType) query = query.eq('creator_type', filters.creatorType);

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map(mapCreatorRow);
  },

  async createCreator(values: CreatorFormValues) {
    const { error } = await db.from('creator_profiles').insert(await normalizeCreator(values));
    if (error) throw error;
  },

  async updateCreator(creatorId: string, values: CreatorFormValues) {
    const { error } = await db.from('creator_profiles').update(await normalizeCreator(values)).eq('id', creatorId);
    if (error) throw error;
  },
};

export function createRecruitBreakdown(creators: CreatorProfile[]): RecruitBreakdown {
  return {
    total: summarizeCreators(creators),
    tiktok: summarizeCreators(creators.filter((creator) => creator.platform === 'tiktok')),
    douyin: summarizeCreators(creators.filter((creator) => creator.platform === 'douyin')),
  };
}

export function createScoutRecruitSummaries(creators: CreatorProfile[]): ScoutRecruitSummary[] {
  const groups = new Map<string, CreatorProfile[]>();

  creators.forEach((creator) => {
    const key = creator.scout_employee_id ?? 'unknown';
    groups.set(key, [...(groups.get(key) ?? []), creator]);
  });

  return Array.from(groups.entries()).map(([scoutId, rows]) => ({
    scoutId,
    scoutName: getEmployeeName(rows[0].scout) || '未填写',
    ...summarizeCreators(rows),
  }));
}

export function createRegionRecruitSummaries(creators: CreatorProfile[]): RegionRecruitSummary[] {
  const groups = new Map<string, CreatorProfile[]>();

  creators.forEach((creator) => {
    const key = creator.region_id ?? 'unknown';
    groups.set(key, [...(groups.get(key) ?? []), creator]);
  });

  return Array.from(groups.entries()).map(([regionId, rows]) => ({
    regionId,
    regionName: rows[0].region?.code ?? rows[0].region?.name ?? '未填写',
    ...summarizeCreators(rows),
  }));
}

export function summarizeCreators(creators: CreatorProfile[]): RecruitSummary {
  return creators.reduce<RecruitSummary>(
    (summary, creator) => {
      summary.total += 1;
      if (creator.platform === 'tiktok') summary.tiktok += 1;
      if (creator.platform === 'douyin') summary.douyin += 1;
      if (creator.creator_type === '5+1') summary.plusFiveOne += 1;
      else summary.nonFiveOne += 1;
      return summary;
    },
    { total: 0, plusFiveOne: 0, nonFiveOne: 0, tiktok: 0, douyin: 0 },
  );
}

export function filterCreatorsByMonth(creators: CreatorProfile[], month: string) {
  return creators.filter((creator) => creator.joined_date.startsWith(month));
}

export function getEmployeeName(employee: Pick<Employee, 'full_name' | 'nickname'> | null | undefined) {
  return employee?.nickname || employee?.full_name || '';
}

async function normalizeCreator(values: CreatorFormValues) {
  const scoutProfileId = await getEmployeeProfileId(values.scout_employee_id);
  const requiresBank = values.creator_type === '5+1' || values.creator_type === 'company';

  return {
    joined_date: values.joined_date,
    platform: values.platform,
    platform_user_id: values.platform_user_id.trim(),
    platform_account: values.platform_account.trim(),
    region_id: values.region_id || null,
    creator_name: values.creator_name.trim(),
    scout_employee_id: values.scout_employee_id || null,
    scout_profile_id: scoutProfileId,
    manager_employee_id: values.manager_employee_id || null,
    creator_type: values.creator_type,
    bank_name: requiresBank ? values.bank_name.trim() || null : null,
    bank_account: requiresBank ? values.bank_account.trim() || null : null,
  };
}

async function getEmployeeProfileId(employeeId: string) {
  if (!employeeId) return null;

  const { data, error } = await supabase.from('employees').select('profile_id').eq('id', employeeId).maybeSingle();
  if (error) throw error;
  return data?.profile_id ?? null;
}

function normalizeCandidate(values: CandidateFormValues) {
  return {
    name: values.name.trim(),
    gender: values.gender.trim() || null,
    age: values.age.trim() ? Number(values.age) : null,
    source: values.source.trim() || null,
    contact: values.contact.trim() || null,
    current_job: values.current_job.trim() || null,
    remark: values.remark.trim() || null,
  };
}

function mapCreatorRow(row: any): CreatorProfile {
  return {
    id: row.id,
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

