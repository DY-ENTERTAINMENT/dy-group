import { supabase } from '../lib/supabase';
import type { CandidateFollowStatus, Employee, EmployeeStatus, ManagementScoutWorkloadStat, Region, ScoutDailyWorkLog } from '../types/database';

export type CandidateStatus = 'pending' | 'accepted' | 'rejected';
export type FollowStatus = CandidateFollowStatus;
export type CreatorPlatform = 'tiktok' | 'douyin';
export type CreatorType = '5+1' | 'online' | 'offline' | 'company';
export type CreatorRegistrationType = 'new_onboarding' | 'existing_creator';
export type CreatorStatus = 'active' | 'invalid';
export type CreatorStatusFilter = CreatorStatus | 'all';

export type DailyWorkLog = ScoutDailyWorkLog;

export type DailyWorkLogFormValues = {
  contacted_count: string;
  replied_count: string;
  note: string;
};

export type WorkloadGranularity = 'daily' | 'weekly' | 'monthly';
export type ManagementWorkloadStat = ManagementScoutWorkloadStat;
export type ManagementScoutWorkCompletion = {
  scout_profile_id: string;
  current_week_filled_days: number;
  current_week_expected_days: number;
  current_week_missing_days: number;
  previous_week_filled_days: number;
  previous_week_expected_days: number;
  previous_week_missing_days: number;
};

export type CandidateFormValues = {
  platform: CreatorPlatform | '';
  platform_user_id: string;
  platform_account: string;
  talent: string;
  name: string;
  gender: string;
  age: string;
  source: string;
  contact: string;
  current_job: string;
  remark: string;
};

export type Candidate = {
  id: string;
  scout_profile_id: string;
  region_id: string | null;
  platform: CreatorPlatform | null;
  platform_user_id: string | null;
  platform_account: string | null;
  talent: string | null;
  follow_status: FollowStatus | null;
  next_follow_up_date: string | null;
  stopped_reason: string | null;
  stopped_at: string | null;
  name: string;
  gender: string | null;
  age: number | null;
  source: string | null;
  contact: string | null;
  current_job: string | null;
  remark: string | null;
  status: CandidateStatus;
  created_at: string;
  updated_at: string;
};

export type FollowUpActionType = 'follow_up' | 'stopped' | 'reopened';

export type CandidateFollowUpHistory = {
  id: string;
  candidate_id: string;
  scout_profile_id: string;
  action_type: FollowUpActionType;
  from_follow_status: FollowStatus | null;
  to_follow_status: FollowStatus;
  previous_next_follow_up_date: string | null;
  next_follow_up_date: string | null;
  note: string | null;
  stopped_reason: string | null;
  created_by: string;
  created_at: string;
};

export type CandidateFollowUpFormValues = {
  to_follow_status: FollowStatus;
  note: string;
  next_follow_up_date: string;
  stopped_reason: string;
};

export type CreatorFormValues = {
  joined_date: string;
  platform: CreatorPlatform;
  platform_user_id: string;
  platform_account: string;
  platform_public_id: string;
  region_id: string;
  creator_name: string;
  scout_employee_id: string;
  manager_employee_id: string;
  creator_type: CreatorType;
  bank_account_name: string;
  bank_name: string;
  bank_account: string;
};

export type CreatorPlatformFormValues = {
  enabled: boolean;
  joined_date: string;
  platform_user_id: string;
  platform_account: string;
  platform_public_id: string;
  creator_type: CreatorType;
  bank_account_name: string;
  bank_name: string;
  bank_account: string;
};

export type CreatorEntityFormValues = {
  display_name: string;
  birthday: string;
  registration_type: CreatorRegistrationType;
  guild_joined_date: string;
  region_id: string;
  scout_employee_id: string;
  manager_employee_id: string;
  has_secondary_scout: boolean;
  secondary_scout_employee_id: string;
  has_secondary_manager: boolean;
  secondary_manager_employee_id: string;
  platforms: Record<CreatorPlatform, CreatorPlatformFormValues>;
};

export type CreatorEntitySharedFormValues = {
  display_name: string;
  birthday: string;
  registration_type: CreatorRegistrationType | null;
  guild_joined_date: string;
  region_id: string;
  scout_employee_id: string;
  manager_employee_id: string;
  bank_account_name: string;
  bank_name: string;
  bank_account: string;
  secondary_scout_employee_id: string;
  secondary_manager_employee_id: string;
  is_priority: boolean;
  operation_status: 'normal' | 'paused' | 'long_term_stopped' | 'resigned' | 'terminated' | 'other';
  operation_status_reason: string;
  platforms: CreatorEntityPlatformEditValues[];
};

export type CreatorEntityPlatformEditValues = {
  id: string;
  platform: CreatorPlatform;
  joined_date: string;
  platform_user_id: string;
  platform_account: string;
  platform_public_id: string;
  creator_type: CreatorType;
  revenue_cycle?: 'weekly' | 'monthly' | 'none';
  revenue_input_mode?: 'direct' | 'cumulative';
};

export type CreatorEntityCollaborator = {
  assignment_type: 'scout' | 'manager';
  employee_id: string;
  display_name: string;
  employee_status: EmployeeStatus;
};
export type CreatorEntityManagementSettings = { is_priority: boolean; operation_status: CreatorEntitySharedFormValues['operation_status']; operation_status_reason: string | null; creator_profile_id: string; revenue_cycle: 'weekly' | 'monthly' | 'none'; revenue_input_mode: 'direct' | 'cumulative' };

export type CreatorAdditionalPlatformFormValues = {
  joined_date: string;
  platform_user_id: string;
  platform_account: string;
  platform_public_id: string;
  creator_type: CreatorType;
};

export type CreatorProfile = {
  id: string;
  creator_entity_id: string | null;
  registration_type?: CreatorRegistrationType | null;
  guild_joined_date?: string | null;
  joined_date: string;
  platform: CreatorPlatform;
  platform_user_id: string;
  platform_account: string;
  platform_public_id?: string | null;
  region_id: string | null;
  creator_name: string;
  scout_employee_id: string | null;
  scout_profile_id: string | null;
  manager_employee_id: string | null;
  is_priority?: boolean;
  operation_status?: 'normal' | 'paused' | 'long_term_stopped' | 'resigned' | 'terminated' | 'other';
  operation_status_reason?: string | null;
  revenue_cycle?: 'weekly' | 'monthly' | 'none';
  revenue_input_mode?: 'direct' | 'cumulative';
  creator_type: CreatorType;
  status?: CreatorStatus;
  bank_account_name?: string | null;
  bank_name: string | null;
  bank_account: string | null;
  created_at: string;
  updated_at: string;
  region: Pick<Region, 'id' | 'code' | 'name'> | null;
  scout: Pick<Employee, 'id' | 'full_name' | 'nickname'> | null;
  scout_display_name?: string | null;
  manager: Pick<Employee, 'id' | 'full_name' | 'nickname'> | null;
};

export type ScoutOptions = {
  regions: Region[];
  employees: Array<Pick<Employee, 'id' | 'full_name' | 'nickname' | 'profile_id' | 'region_id' | 'status'> & { job_title_name: string | null }>;
};

export type OnboardingManagerOption = {
  id: string;
  display_name: string;
};

export type OnboardingScoutOption = {
  id: string;
  display_name: string;
  region_id: string;
  employee_status?: EmployeeStatus;
};

export type OnboardingCollaboratorOption = OnboardingScoutOption;

export type CreatorManagerDisplayName = {
  creator_id: string;
  manager_employee_id: string;
  manager_display_name: string;
};

export type CreatorScoutDisplayName = {
  creator_profile_id: string;
  scout_employee_id: string | null;
  scout_profile_id: string | null;
  display_name: string | null;
};

export type VisibleCreatorScoutDisplayName = {
  creator_entity_id: string | null;
  creator_profile_id: string | null;
  scout_employee_id: string | null;
  scout_display_name: string | null;
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
  creator_entity_id,
  joined_date,
  platform,
  platform_user_id,
  platform_account,
  platform_public_id,
  region_id,
  creator_name,
  scout_employee_id,
  scout_profile_id,
  manager_employee_id,
  creator_type,
  status,
  bank_account_name,
  bank_name,
  bank_account,
  created_at,
  updated_at,
  creator_entity:creator_entities!creator_entity_id(is_priority, operation_status, operation_status_reason),
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

export type CrossPlatformAssociationEntitySummary = {
  id: string;
  displayName: string;
  status: string;
  isPriority: boolean;
  operationStatus: string | null;
  operationStatusReason: string | null;
  managerEmployeeId: string | null;
  regionId: string | null;
  managerName: string | null;
  regionName: string | null;
};

export type CrossPlatformAssociationProfileSummary = {
  id: string;
  creatorEntityId: string;
  platform: CreatorPlatform;
  creatorName: string;
  platformAccount: string;
  platformUserId: string;
  platformPublicId: string | null;
  revenueCycle: 'weekly' | 'monthly' | 'none' | null;
  revenueInputMode: 'direct' | 'cumulative' | null;
};

export type CrossPlatformAssociationDependencies = {
  sourceActiveRoomCount: number;
  retainedActiveRoomCount: number;
  sourceActiveCollaboratorCount: number;
  sourceActivityCount: number;
  sourceMilestoneCount: number;
  sourceExtraActiveProfileCount: number;
};

export type CrossPlatformAssociationRoom = { id: string; name: string; roomNumber: string };
export type CrossPlatformAssociationRoomState = 'none' | 'source_only' | 'retained_only' | 'same_room' | 'different_rooms';
export type CrossPlatformAssociationRoomResolution = 'auto' | 'keep_source' | 'keep_retained';

export type CrossPlatformAssociationPreflight = {
  canAssociate: boolean;
  blockers: string[];
  warnings: string[];
  retainedEntity: CrossPlatformAssociationEntitySummary;
  sourceEntity: CrossPlatformAssociationEntitySummary;
  sourceProfile: CrossPlatformAssociationProfileSummary;
  retainedProfiles: CrossPlatformAssociationProfileSummary[];
  dependencies: CrossPlatformAssociationDependencies;
  roomState: CrossPlatformAssociationRoomState;
  sourceRoom: CrossPlatformAssociationRoom | null;
  retainedRoom: CrossPlatformAssociationRoom | null;
  roomResolutionRequired: boolean;
  recommendedRoomResolution: CrossPlatformAssociationRoomResolution;
};

export type CrossPlatformAssociationCandidate = CrossPlatformAssociationProfileSummary & {
  managerName: string | null;
  regionName: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readNullableString(value: unknown): string | null {
  return value === null ? null : readString(value);
}

function readNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function readBoolean(value: unknown): boolean {
  return value === true;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function readPlatform(value: unknown): CreatorPlatform | null {
  return value === 'tiktok' || value === 'douyin' ? value : null;
}

function mapAssociationEntity(value: unknown, managerName: unknown, regionName: unknown): CrossPlatformAssociationEntitySummary | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  const displayName = readString(value.display_name);
  const status = readString(value.status);
  if (!id || !displayName || !status) return null;
  return {
    id,
    displayName,
    status,
    isPriority: readBoolean(value.is_priority),
    operationStatus: readNullableString(value.operation_status),
    operationStatusReason: readNullableString(value.operation_status_reason),
    managerEmployeeId: readNullableString(value.manager_employee_id),
    regionId: readNullableString(value.region_id),
    managerName: readNullableString(managerName),
    regionName: readNullableString(regionName),
  };
}

function mapAssociationProfile(value: unknown): CrossPlatformAssociationProfileSummary | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  const creatorEntityId = readString(value.creator_entity_id);
  const platform = readPlatform(value.platform);
  const creatorName = readString(value.creator_name);
  const platformAccount = readString(value.platform_account);
  const platformUserId = readString(value.platform_user_id);
  if (!id || !creatorEntityId || !platform || !creatorName || !platformAccount || !platformUserId) return null;
  const revenueCycle = value.revenue_cycle === 'weekly' || value.revenue_cycle === 'monthly' || value.revenue_cycle === 'none' ? value.revenue_cycle : null;
  const revenueInputMode = value.revenue_input_mode === 'direct' || value.revenue_input_mode === 'cumulative' ? value.revenue_input_mode : null;
  return { id, creatorEntityId, platform, creatorName, platformAccount, platformUserId, platformPublicId: readNullableString(value.platform_public_id), revenueCycle, revenueInputMode };
}

function mapAssociationPreflight(value: unknown): CrossPlatformAssociationPreflight {
  if (!isRecord(value)) throw new Error('关联检查返回格式无效，请刷新后重试。');
  const retainedEntity = mapAssociationEntity(value.retained_entity, value.retained_manager_name, value.retained_region_name);
  const sourceEntity = mapAssociationEntity(value.source_entity, value.source_manager_name, value.source_region_name);
  const sourceProfile = mapAssociationProfile(value.source_profile);
  if (!retainedEntity || !sourceEntity || !sourceProfile) throw new Error('关联检查缺少必要主体资料，请刷新后重试。');
  const retainedProfiles = Array.isArray(value.retained_profiles)
    ? value.retained_profiles.map(mapAssociationProfile).filter((profile): profile is CrossPlatformAssociationProfileSummary => profile !== null)
    : [];
  const blockerListIsValid = Array.isArray(value.blockers) && value.blockers.every((blocker) => typeof blocker === 'string');
  const blockers = blockerListIsValid ? readStringArray(value.blockers) : ['关联检查返回的阻止条件格式无效，请刷新后重新检查。'];
  const canAssociate = value.can_associate === true && blockerListIsValid;
  if (canAssociate && retainedProfiles.length === 0) throw new Error('关联检查缺少保留主体平台资料，请刷新后重试。');
  const mapRoom = (room: unknown): CrossPlatformAssociationRoom | null => {
    if (!isRecord(room)) return null;
    const id = readString(room.id);
    const name = readString(room.name);
    const roomNumber = readString(room.room_number);
    return id && name && roomNumber ? { id, name, roomNumber } : null;
  };
  const roomState = value.room_state === 'source_only' || value.room_state === 'retained_only' || value.room_state === 'same_room' || value.room_state === 'different_rooms' ? value.room_state : 'none';
  const recommendedRoomResolution = value.recommended_room_resolution === 'keep_source' || value.recommended_room_resolution === 'keep_retained' ? value.recommended_room_resolution : 'auto';
  return {
    canAssociate,
    blockers,
    warnings: readStringArray(value.warnings),
    retainedEntity,
    sourceEntity,
    sourceProfile,
    retainedProfiles,
    roomState,
    sourceRoom: mapRoom(value.source_room),
    retainedRoom: mapRoom(value.retained_room),
    roomResolutionRequired: value.room_resolution_required === true,
    recommendedRoomResolution,
    dependencies: {
      sourceActiveRoomCount: readNumber(value.source_active_room_count),
      retainedActiveRoomCount: readNumber(value.retained_active_room_count),
      sourceActiveCollaboratorCount: readNumber(value.source_active_collaborator_count),
      sourceActivityCount: readNumber(value.source_activity_count),
      sourceMilestoneCount: readNumber(value.source_milestone_count),
      sourceExtraActiveProfileCount: readNumber(value.source_extra_active_profile_count),
    },
  };
}

function mapAssociationCandidate(value: unknown): CrossPlatformAssociationCandidate | null {
  if (!isRecord(value)) return null;
  const profile = mapAssociationProfile({
    id: value.id,
    creator_entity_id: value.creator_entity_id,
    platform: value.platform,
    creator_name: value.creator_name,
    platform_account: value.platform_account,
    platform_user_id: value.platform_user_id,
    platform_public_id: value.platform_public_id,
  });
  if (!profile) return null;
  return { ...profile, managerName: readNullableString(value.manager_name), regionName: readNullableString(value.region_name) };
}

export const scoutService = {
  async getOptions(): Promise<ScoutOptions> {
    const [regionsResult, employeesResult] = await Promise.all([
      supabase.from('regions').select('*').eq('is_active', true).order('sort_order', { ascending: true }),
      supabase
        .from('employees')
        .select('id, full_name, nickname, profile_id, region_id, status, job_titles:job_title_id(name)')
        .is('deleted_at', null)
        .order('full_name', { ascending: true }),
    ]);

    if (regionsResult.error) throw regionsResult.error;
    if (employeesResult.error) throw employeesResult.error;

    return {
      regions: regionsResult.data ?? [],
      employees: (employeesResult.data ?? []).map((employee: { job_titles?: { name: string | null } | null }) => ({
        ...employee,
        job_title_name: employee.job_titles?.name ?? null,
      })) as ScoutOptions['employees'],
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

  async listOnboardingScoutOptions(registrationType: CreatorRegistrationType, regionId: string): Promise<OnboardingScoutOption[]> {
    const { data, error } = await db.rpc('get_scout_onboarding_scout_options', {
      p_registration_type: registrationType,
      p_region_id: regionId,
    });
    if (error) throw error;

    return ((data ?? []) as Array<{ employee_id: string; display_name: string; region_id: string; employee_status: EmployeeStatus }>).map((employee) => ({
      id: employee.employee_id,
      display_name: employee.display_name,
      region_id: employee.region_id,
      employee_status: employee.employee_status,
    }));
  },

  async listOnboardingCollaboratorOptions(assignmentType: 'scout' | 'manager'): Promise<OnboardingCollaboratorOption[]> {
    const { data, error } = await db.rpc('get_creator_collaborator_options', {
      p_assignment_type: assignmentType,
      p_region_id: null,
    });
    if (error) throw error;
    return ((data ?? []) as Array<{ employee_id: string; display_name: string; region_id: string }>).map((employee) => ({
      id: employee.employee_id,
      display_name: employee.display_name,
      region_id: employee.region_id,
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

  async listVisibleCreatorScoutDisplayNames(input: { creatorEntityIds: string[]; creatorProfileIds: string[] }): Promise<VisibleCreatorScoutDisplayName[]> {
    const creatorEntityIds = Array.from(new Set(input.creatorEntityIds.filter(Boolean)));
    const creatorProfileIds = Array.from(new Set(input.creatorProfileIds.filter(Boolean)));
    if (creatorEntityIds.length === 0 && creatorProfileIds.length === 0) return [];

    const { data, error } = await db.rpc('get_visible_creator_scout_display_names', {
      p_creator_entity_ids: creatorEntityIds,
      p_creator_profile_ids: creatorProfileIds,
    });
    if (error) throw error;
    return data ?? [];
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

  async listDailyWorkLogs(month: string): Promise<DailyWorkLog[]> {
    const { startDate, endDate } = getMonthDateRange(month);
    const { data, error } = await db
      .from('scout_daily_work_logs')
      .select('*')
      .gte('work_date', startDate)
      .lte('work_date', endDate)
      .order('work_date', { ascending: false });

    if (error) throw error;
    return data ?? [];
  },

  async saveDailyWorkLog(workDate: string, values: DailyWorkLogFormValues): Promise<DailyWorkLog> {
    const contactedCount = parseCount(values.contacted_count);
    const repliedCount = parseCount(values.replied_count);
    const { data, error } = await db.rpc('upsert_scout_daily_work_log', {
      p_work_date: workDate,
      p_contacted_count: contactedCount,
      p_replied_count: repliedCount,
      p_note: values.note,
    });

    if (error) throw error;
    return data;
  },

  async listManagementDailyWorkLogs(scoutProfileId: string, month: string): Promise<DailyWorkLog[]> {
    const { data, error } = await db.rpc('get_management_scout_daily_work_logs', {
      p_scout_profile_id: scoutProfileId,
      p_month: month,
    });
    if (error) throw error;
    return data ?? [];
  },

  async saveManagementDailyWorkLog(scoutProfileId: string, workDate: string, values: DailyWorkLogFormValues): Promise<DailyWorkLog> {
    const contactedCount = parseCount(values.contacted_count);
    const repliedCount = parseCount(values.replied_count);
    const { data, error } = await db.rpc('upsert_management_scout_daily_work_log', {
      p_scout_profile_id: scoutProfileId,
      p_work_date: workDate,
      p_contacted_count: contactedCount,
      p_replied_count: repliedCount,
      p_note: values.note,
    });
    if (error) throw error;
    return data;
  },

  async listManagementScoutWorkCompletion(scoutProfileIds: string[]): Promise<ManagementScoutWorkCompletion[]> {
    const ids = Array.from(new Set(scoutProfileIds.filter(Boolean)));
    if (ids.length === 0) return [];
    const { data, error } = await db.rpc('get_management_scout_daily_work_completion', { p_scout_profile_ids: ids });
    if (error) throw error;
    return data ?? [];
  },

  async listManagementWorkloadStats(input: { month: string; regionId?: string; granularity: WorkloadGranularity }): Promise<ManagementWorkloadStat[]> {
    const { data, error } = await db.rpc('get_management_scout_workload_stats', {
      p_month: input.month,
      p_region_id: input.regionId || null,
      p_granularity: input.granularity,
    });

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

  async listCandidateFollowUpHistory(candidateId: string): Promise<CandidateFollowUpHistory[]> {
    const { data, error } = await db
      .from('scout_candidate_follow_up_history')
      .select('*')
      .eq('candidate_id', candidateId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data ?? [];
  },

  async addCandidateFollowUp(candidateId: string, values: CandidateFollowUpFormValues): Promise<Candidate> {
    const { data, error } = await db.rpc('add_scout_candidate_follow_up', {
      p_candidate_id: candidateId,
      p_to_follow_status: values.to_follow_status,
      p_note: values.note.trim() || null,
      p_next_follow_up_date: values.to_follow_status === 'stopped' ? null : values.next_follow_up_date || null,
      p_stopped_reason: values.to_follow_status === 'stopped' ? values.stopped_reason.trim() : null,
    });

    if (error) throw error;
    return data;
  },

  async setCandidateStatus(candidateId: string, status: CandidateStatus) {
    const { error } = await db.from('scout_candidates').update({ status }).eq('id', candidateId);
    if (error) throw error;
  },

  async listCreators(filters: { personalProfileId?: string; platform?: string; regionId?: string; scoutEmployeeId?: string; managerEmployeeId?: string; creatorType?: string; status?: CreatorStatusFilter }) {
    let query = db.from('creator_profiles').select(creatorSelect).order('joined_date', { ascending: false });
    const statusFilter = filters.status ?? 'active';
    if (statusFilter !== 'all') query = query.eq('status', statusFilter);

    if (filters.personalProfileId) query = query.eq('scout_profile_id', filters.personalProfileId);
    if (filters.platform) query = query.eq('platform', filters.platform);
    if (filters.regionId) query = query.eq('region_id', filters.regionId);
    if (filters.scoutEmployeeId) query = query.eq('scout_employee_id', filters.scoutEmployeeId);
    if (filters.managerEmployeeId) query = query.eq('manager_employee_id', filters.managerEmployeeId);
    if (filters.creatorType) query = query.eq('creator_type', filters.creatorType);

    const { data, error } = await query;
    if (error) throw error;
    const creators: CreatorProfile[] = (data ?? []).map(mapCreatorRow);
    const entityIds = Array.from(new Set(creators.map((creator) => creator.creator_entity_id).filter((id): id is string => Boolean(id))));
    if (entityIds.length === 0) return creators;

    const { data: metadataRows, error: metadataError } = await db.rpc('get_visible_creator_registration_metadata', {
      p_creator_entity_ids: entityIds,
    });
    if (metadataError) throw metadataError;

    type CreatorRegistrationMetadata = { creator_entity_id: string; registration_type: CreatorRegistrationType | null; guild_joined_date: string | null };
    const metadataByEntityId = new Map<string, CreatorRegistrationMetadata>((metadataRows ?? []).map((metadata: CreatorRegistrationMetadata) => [metadata.creator_entity_id, metadata]));
    return creators.map((creator) => {
      const metadata = creator.creator_entity_id ? metadataByEntityId.get(creator.creator_entity_id) : undefined;
      return metadata ? { ...creator, registration_type: metadata.registration_type, guild_joined_date: metadata.guild_joined_date } : creator;
    });
  },

  async listPersonalStreamerProfiles(): Promise<CreatorProfile[]> {
    const { data, error } = await db.rpc('list_personal_streamer_profiles', { p_status: 'active' });
    if (error) throw error;

    return (data ?? []).map((row: any) => mapCreatorRow({
      ...row,
      regions: row.region_id ? { id: row.region_id, code: row.region_code, name: row.region_name } : null,
      scout: row.scout_employee_id ? { id: row.scout_employee_id, full_name: row.scout_full_name, nickname: row.scout_nickname } : null,
      manager: row.manager_employee_id ? { id: row.manager_employee_id, full_name: row.manager_full_name, nickname: row.manager_nickname } : null,
    }));
  },

  async listCreatorScoutDisplayNames(creatorProfileIds: string[]): Promise<CreatorScoutDisplayName[]> {
    const uniqueCreatorProfileIds = Array.from(new Set(creatorProfileIds.filter(Boolean)));
    if (uniqueCreatorProfileIds.length === 0) return [];

    const { data, error } = await db.rpc('get_management_recruiting_scout_display_names', {
      p_creator_profile_ids: uniqueCreatorProfileIds,
    });

    if (error) throw error;
    return data ?? [];
  },

  async createCreator(values: CreatorFormValues) {
    const { error } = await db.from('creator_profiles').insert(await normalizeCreator(values));
    if (error) throw error;
  },

  async createCreatorEntityWithPlatforms(values: CreatorEntityFormValues) {
    const platforms = normalizeCreatorEntityPlatforms(values);
    if (platforms.length === 0) throw new Error('请至少选择一个平台。');

    const { error } = await db.rpc('create_creator_entity_with_platforms_with_birthday', {
      p_display_name: values.display_name.trim(),
      p_birthday: values.birthday || null,
      p_region_id: values.region_id || null,
      p_scout_employee_id: values.scout_employee_id || null,
      p_manager_employee_id: values.manager_employee_id || null,
      p_platforms: platforms,
      p_secondary_scout_employee_id: values.has_secondary_scout ? values.secondary_scout_employee_id || null : null,
      p_secondary_manager_employee_id: values.has_secondary_manager ? values.secondary_manager_employee_id || null : null,
    });

    if (error) throw error;
  },

  async updateCreator(creatorId: string, values: CreatorFormValues) {
    const { error } = await db.from('creator_profiles').update(await normalizeCreator(values)).eq('id', creatorId);
    if (error) throw error;
  },

  async saveCreatorEntitySharedData(creatorEntityId: string, values: CreatorEntitySharedFormValues) {
    const { error } = await db.rpc('save_creator_entity_shared_data_with_birthday', {
      p_creator_entity_id: creatorEntityId,
      p_display_name: values.display_name.trim(),
      p_birthday: values.birthday || null,
      p_region_id: values.region_id || null,
      p_scout_employee_id: values.scout_employee_id || null,
      p_manager_employee_id: values.manager_employee_id || null,
      p_registration_type: values.registration_type,
      p_guild_joined_date: values.guild_joined_date || null,
      p_bank_account_name: values.bank_account_name.trim() || null,
      p_bank_name: values.bank_name.trim() || null,
      p_bank_account: values.bank_account.trim() || null,
      p_secondary_scout_employee_id: values.secondary_scout_employee_id || null,
      p_secondary_manager_employee_id: values.secondary_manager_employee_id || null,
    });

    if (error) throw error;
  },

  async getCreatorEntityBirthday(creatorEntityId: string): Promise<string | null> {
    const { data, error } = await db.rpc('get_creator_entity_birthday', { p_creator_entity_id: creatorEntityId });
    if (error) throw error;
    return data ?? null;
  },

  async getCreatorEntityManagementSettings(creatorEntityId: string) {
    const { data, error } = await db.rpc('get_creator_entity_management_settings', { p_creator_entity_id: creatorEntityId });
    if (error) throw error;
    return (data ?? []) as CreatorEntityManagementSettings[];
  },

  async previewCrossPlatformCreatorAssociation(retainedEntityId: string, sourceProfileId: string): Promise<CrossPlatformAssociationPreflight> {
    const { data, error } = await db.rpc('preview_cross_platform_creator_association', { p_retained_entity_id: retainedEntityId, p_source_profile_id: sourceProfileId });
    if (error) throw error;
    return mapAssociationPreflight(data);
  },

  async searchCrossPlatformCreatorAssociationCandidates(currentProfileId: string, query: string): Promise<CrossPlatformAssociationCandidate[]> {
    if (query.trim().length < 2) return [];
    const { data, error } = await db.rpc('search_cross_platform_creator_association_candidates', { p_current_profile_id: currentProfileId, p_query: query.trim() });
    if (error) throw error;
    return Array.isArray(data)
      ? data.map(mapAssociationCandidate).filter((candidate): candidate is CrossPlatformAssociationCandidate => candidate !== null)
      : [];
  },

  async associateExistingCrossPlatformCreatorProfiles(retainedEntityId: string, sourceProfileId: string, reason: string, roomResolution: CrossPlatformAssociationRoomResolution) {
    const { data, error } = await db.rpc('associate_existing_cross_platform_creator_profiles', { p_retained_entity_id: retainedEntityId, p_source_profile_id: sourceProfileId, p_reason: reason.trim(), p_room_resolution: roomResolution });
    if (error) throw error;
    return data as string;
  },

  async saveCreatorEntityManagementSettings(creatorEntityId: string, values: CreatorEntitySharedFormValues) {
    const { error } = await db.rpc('save_creator_entity_management_controls', {
      p_creator_entity_id: creatorEntityId, p_is_priority: values.is_priority,
      p_operation_status: values.operation_status, p_operation_status_reason: values.operation_status_reason.trim() || null,
    });
    if (error) throw error;
  },

  async saveCreatorEntityRevenueSettings(creatorEntityId: string, values: CreatorEntitySharedFormValues) {
    const { error } = await db.rpc('save_creator_entity_revenue_settings', {
      p_creator_entity_id: creatorEntityId,
      p_profile_settings: values.platforms.map((p) => ({ id: p.id, revenue_cycle: p.revenue_cycle ?? 'weekly', revenue_input_mode: p.revenue_input_mode ?? 'direct' })),
    });
    if (error) throw error;
  },

  async updateCreatorEntityPlatformProfiles(creatorEntityId: string, profiles: CreatorEntityPlatformEditValues[]) {
    const seenProfileIds = new Set<string>();
    const seenPlatforms = new Set<CreatorPlatform>();

    for (const profile of profiles) {
      if (!profile.id || seenProfileIds.has(profile.id) || seenPlatforms.has(profile.platform)) {
        throw new Error('平台资料无效，请关闭后重新打开编辑窗口。');
      }
      if (!profile.joined_date || !profile.platform_user_id.trim() || !profile.platform_account.trim() || !profile.platform_public_id.trim()) {
        throw new Error(`${platformLabels[profile.platform]} 平台资料未填写完整。`);
      }
      seenProfileIds.add(profile.id);
      seenPlatforms.add(profile.platform);
    }

    for (const profile of profiles) {
      const { data, error } = await db
        .from('creator_profiles')
        .update({
          joined_date: profile.joined_date,
          platform_user_id: profile.platform_user_id.trim(),
          platform_account: profile.platform_account.trim(),
          platform_public_id: profile.platform_public_id.trim(),
          creator_type: profile.creator_type,
        })
        .eq('id', profile.id)
        .eq('creator_entity_id', creatorEntityId)
        .eq('status', 'active')
        .eq('membership_status', 'active')
        .select('id')
        .maybeSingle();

      if (error) {
        if (error.code === '23505') throw new Error(`${platformLabels[profile.platform]} User ID 已被其他主播使用，请检查后重试。`);
        throw new Error(`${platformLabels[profile.platform]} 平台资料保存失败：${error.message}`);
      }
      if (!data) throw new Error(`${platformLabels[profile.platform]} 平台资料已变更或不再有效，请刷新后重试。`);
    }
  },

  async getCreatorEntityCollaborators(creatorEntityId: string): Promise<CreatorEntityCollaborator[]> {
    const { data, error } = await db.rpc('get_creator_entity_collaborators', {
      p_creator_entity_id: creatorEntityId,
    });
    if (error) throw error;
    return data ?? [];
  },

  async listCreatorEntityActivePlatformProfiles(creatorEntityId: string): Promise<CreatorEntityPlatformEditValues[]> {
    const { data, error } = await db
      .from('creator_profiles')
      .select('id, platform, joined_date, platform_user_id, platform_account, platform_public_id, creator_type')
      .eq('creator_entity_id', creatorEntityId)
      .eq('status', 'active')
      .eq('membership_status', 'active');

    if (error) throw error;
    const platformOrder: Record<CreatorPlatform, number> = { tiktok: 0, douyin: 1 };
    return (data ?? [])
      .map((profile: any) => ({
        id: profile.id,
        platform: profile.platform as CreatorPlatform,
        joined_date: profile.joined_date,
        platform_user_id: profile.platform_user_id,
        platform_account: profile.platform_account,
        platform_public_id: profile.platform_public_id ?? '',
        creator_type: profile.creator_type as CreatorType,
      }))
      .sort((first: CreatorEntityPlatformEditValues, second: CreatorEntityPlatformEditValues) => platformOrder[first.platform] - platformOrder[second.platform]);
  },

  async addCreatorEntityPlatformProfile(creatorEntityId: string, platform: CreatorPlatform, values: CreatorAdditionalPlatformFormValues) {
    const { error } = await db.rpc('add_creator_entity_platform_profile', {
      p_creator_entity_id: creatorEntityId,
      p_platform: platform,
      p_joined_date: values.joined_date || null,
      p_platform_user_id: values.platform_user_id.trim(),
      p_platform_account: values.platform_account.trim(),
      p_platform_public_id: values.platform_public_id.trim(),
      p_creator_type: values.creator_type,
    });

    if (error) throw error;
  },

  async setCreatorStatus(creatorProfileId: string, toStatus: CreatorStatus, reason?: string | null) {
    const { error } = await db.rpc('set_creator_profile_status', {
      p_creator_profile_id: creatorProfileId,
      p_to_status: toStatus,
      p_reason: reason ?? null,
    });

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

export function getRecruitCountingGroups(creators: CreatorProfile[]) {
  const creatorGroups = new Map<string, CreatorProfile[]>();
  creators
    .filter((creator) => creator.registration_type !== 'existing_creator')
    .forEach((creator) => {
      const key = creator.creator_entity_id ? `entity:${creator.creator_entity_id}` : `profile:${creator.id}`;
      creatorGroups.set(key, [...(creatorGroups.get(key) ?? []), creator]);
    });

  return Array.from(creatorGroups.values());
}

export function createRecruitPlatformDetailRows(creators: CreatorProfile[]) {
  return (['tiktok', 'douyin'] as const).flatMap((platform) => (
    getRecruitCountingGroups(creators.filter((creator) => creator.platform === platform)).map((profiles) => profiles[0])
  ));
}

export function summarizeCreators(creators: CreatorProfile[]): RecruitSummary {
  const creatorGroups = getRecruitCountingGroups(creators);

  return creatorGroups.reduce<RecruitSummary>(
    (summary, profiles) => {
      const platforms = new Set(profiles.map((creator) => creator.platform));
      const representative = profiles[0];
      summary.total += 1;
      if (platforms.has('tiktok')) summary.tiktok += 1;
      if (platforms.has('douyin')) summary.douyin += 1;
      if (representative.creator_type === '5+1') summary.plusFiveOne += 1;
      else summary.nonFiveOne += 1;
      return summary;
    },
    { total: 0, plusFiveOne: 0, nonFiveOne: 0, tiktok: 0, douyin: 0 },
  );
}

export function filterCreatorsByMonth(creators: CreatorProfile[], month: string) {
  return creators.filter((creator) => creator.registration_type !== 'existing_creator' && (creator.guild_joined_date ?? creator.joined_date).startsWith(month));
}

export function getEmployeeName(employee: Pick<Employee, 'full_name' | 'nickname'> | null | undefined) {
  return employee?.nickname || employee?.full_name || '';
}

async function normalizeCreator(values: CreatorFormValues) {
  const scoutProfileId = await getEmployeeProfileId(values.scout_employee_id);

  return {
    joined_date: values.joined_date,
    platform: values.platform,
    platform_user_id: values.platform_user_id.trim(),
    platform_account: values.platform_account.trim(),
    platform_public_id: values.platform_public_id.trim() || null,
    region_id: values.region_id || null,
    creator_name: values.creator_name.trim(),
    scout_employee_id: values.scout_employee_id || null,
    scout_profile_id: scoutProfileId,
    manager_employee_id: values.manager_employee_id || null,
    creator_type: values.creator_type,
    bank_account_name: values.bank_account_name.trim() || null,
    bank_name: values.bank_name.trim() || null,
    bank_account: values.bank_account.trim() || null,
  };
}

async function getEmployeeProfileId(employeeId: string) {
  if (!employeeId) return null;

  const { data, error } = await supabase.from('employees').select('profile_id').eq('id', employeeId).maybeSingle();
  if (error) throw error;
  return data?.profile_id ?? null;
}

function normalizeCreatorEntityPlatforms(values: CreatorEntityFormValues) {
  return (Object.entries(values.platforms) as Array<[CreatorPlatform, CreatorPlatformFormValues]>)
    .filter(([, platformValues]) => platformValues.enabled)
    .map(([platform, platformValues]) => {
      return {
        platform,
        joined_date: platformValues.joined_date,
        platform_user_id: platformValues.platform_user_id.trim(),
        platform_account: platformValues.platform_account.trim(),
        platform_public_id: platformValues.platform_public_id.trim() || null,
        registration_type: values.registration_type,
        guild_joined_date: values.guild_joined_date,
        creator_name: values.display_name.trim(),
        creator_type: platformValues.creator_type,
        bank_account_name: platformValues.bank_account_name.trim() || null,
        bank_name: platformValues.bank_name.trim() || null,
        bank_account: platformValues.bank_account.trim() || null,
      };
    });
}

function normalizeCandidate(values: CandidateFormValues) {
  return {
    platform: values.platform || null,
    platform_user_id: values.platform_user_id.trim() || null,
    platform_account: values.platform_account.trim() || null,
    talent: values.talent.trim() || null,
    name: values.name.trim(),
    gender: values.gender.trim() || null,
    age: values.age.trim() ? Number(values.age) : null,
    source: values.source.trim() || null,
    contact: values.contact.trim() || null,
    current_job: values.current_job.trim() || null,
    remark: values.remark.trim() || null,
  };
}

function parseCount(value: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error('人数必须是 0 或正整数。');
  }
  return parsed;
}

function getMonthDateRange(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error('月份格式无效。');
  }

  const [year, monthNumber] = month.split('-').map(Number);
  const startDate = `${month}-01`;
  const endDate = formatLocalDate(new Date(year, monthNumber, 0));
  return { startDate, endDate };
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function mapCreatorRow(row: any): CreatorProfile {
  const creatorEntity = Array.isArray(row.creator_entity) ? row.creator_entity[0] : row.creator_entity;
  return {
    id: row.id,
    creator_entity_id: row.creator_entity_id,
    registration_type: row.registration_type ?? null,
    guild_joined_date: row.guild_joined_date ?? null,
    joined_date: row.joined_date,
    platform: row.platform,
    platform_user_id: row.platform_user_id,
    platform_account: row.platform_account,
    platform_public_id: row.platform_public_id,
    region_id: row.region_id,
    creator_name: row.creator_name,
    scout_employee_id: row.scout_employee_id,
    scout_profile_id: row.scout_profile_id,
    manager_employee_id: row.manager_employee_id,
    is_priority: creatorEntity?.is_priority === true,
    operation_status: ['normal', 'paused', 'long_term_stopped', 'resigned', 'terminated', 'other'].includes(creatorEntity?.operation_status) ? creatorEntity.operation_status : 'normal',
    operation_status_reason: typeof creatorEntity?.operation_status_reason === 'string' ? creatorEntity.operation_status_reason : null,
    creator_type: row.creator_type,
    status: row.status,
    bank_account_name: row.bank_account_name,
    bank_name: row.bank_name,
    bank_account: row.bank_account,
    created_at: row.created_at,
    updated_at: row.updated_at,
    region: row.regions,
    scout: row.scout,
    scout_display_name: row.scout_display_name ?? null,
    manager: row.manager,
  };
}

