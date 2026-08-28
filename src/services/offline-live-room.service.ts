import { supabase } from '../lib/supabase';
import { agentService, type RevenuePeriodSetting, type WeeklyRevenueRecord } from './agent.service';
import { platformLabels, type CreatorPlatform, type CreatorProfile } from './scout.service';
import type { Region } from '../types/database';

export type OfflineLiveRoomStatus = 'active' | 'inactive';
export type OfflineLiveRoomCreatorStatus = 'active' | 'inactive';
export type OfflineLiveRoomUpdateStatus = 'updated' | 'partial' | 'pending' | 'unconfigured';

export type OfflineLiveRoom = {
  id: string;
  region_id: string;
  room_number: string;
  name: string;
  status: OfflineLiveRoomStatus;
  sort_order: number;
  created_by_employee_id: string | null;
  updated_by_employee_id: string | null;
  created_at: string;
  updated_at: string;
  region: Pick<Region, 'id' | 'code' | 'name'> | null;
};

export type OfflineLiveRoomCreatorAssignment = {
  id: string;
  room_id: string;
  creator_entity_id: string;
  status: OfflineLiveRoomCreatorStatus;
  assigned_at: string;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
};

export type OfflineLiveRoomFormInput = {
  regionId: string;
  roomNumber: string;
  name: string;
  sortOrder: number;
};

export type OfflineLiveRoomCreatorEntity = {
  id: string;
  display_name: string;
  region_id: string | null;
  status: string;
  profiles: CreatorProfile[];
};

export type OfflineLiveRoomCreatorPlatformRevenue = {
  profile: CreatorProfile;
  records: WeeklyRevenueRecord[];
  total: number;
  record: WeeklyRevenueRecord | null;
};

export type OfflineLiveRoomCreatorSummary = {
  entityId: string;
  displayName: string;
  profiles: OfflineLiveRoomCreatorPlatformRevenue[];
};

export type OfflineLiveRoomDashboardRoom = {
  room: OfflineLiveRoom;
  assignments: OfflineLiveRoomCreatorAssignment[];
  creators: OfflineLiveRoomCreatorSummary[];
  tiktokTotal: number;
  douyinTotal: number;
  status: OfflineLiveRoomUpdateStatus;
  updatedProfileCount: number;
  expectedProfileCount: number;
  latestUpdatedAt: string | null;
};

export type OfflineLiveRoomDashboard = {
  rooms: OfflineLiveRoomDashboardRoom[];
  tiktokTotal: number;
  douyinTotal: number;
  updatedRoomCount: number;
  pendingRoomCount: number;
  creatorCount: number;
};

export type OfflineLiveRoomPeriodRange = {
  startIso: string;
  endIso: string;
  label: string;
  shortLabel: string;
  periodNo: number;
};

// Supabase generated types lag new migrations in this repo, so this service follows the existing runtime-client pattern.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const roomSelect = `
  id,
  region_id,
  room_number,
  name,
  status,
  sort_order,
  created_by_employee_id,
  updated_by_employee_id,
  created_at,
  updated_at,
  region:regions(id, code, name)
`;

const assignmentSelect = `
  id,
  room_id,
  creator_entity_id,
  status,
  assigned_at,
  ended_at,
  created_at,
  updated_at
`;

const creatorProfileSelect = `
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
  creator_type,
  status,
  bank_name,
  bank_account,
  created_at,
  updated_at,
  regions:region_id(id, code, name),
  scout:employees!creator_profiles_scout_employee_id_fkey(id, full_name, nickname),
  manager:employees!creator_profiles_manager_employee_id_fkey(id, full_name, nickname)
`;

export const offlineLiveRoomService = {
  async listRegions(): Promise<Region[]> {
    const { data, error } = await db
      .from('regions')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return data ?? [];
  },

  async listRooms(input: { includeInactive?: boolean; regionId?: string } = {}): Promise<OfflineLiveRoom[]> {
    let query = db.from('offline_live_rooms').select(roomSelect).order('sort_order', { ascending: true }).order('room_number', { ascending: true });
    if (!input.includeInactive) query = query.eq('status', 'active');
    if (input.regionId) query = query.eq('region_id', input.regionId);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map(mapRoomRow);
  },

  async createRoom(input: OfflineLiveRoomFormInput): Promise<OfflineLiveRoom> {
    const { data, error } = await db
      .from('offline_live_rooms')
      .insert(normalizeRoomInput(input))
      .select(roomSelect)
      .single();
    if (error) throw error;
    return mapRoomRow(data);
  },

  async updateRoom(roomId: string, input: OfflineLiveRoomFormInput): Promise<OfflineLiveRoom> {
    const { data, error } = await db
      .from('offline_live_rooms')
      .update(normalizeRoomInput(input))
      .eq('id', roomId)
      .select(roomSelect)
      .single();
    if (error) throw error;
    return mapRoomRow(data);
  },

  async deactivateRoom(roomId: string): Promise<void> {
    const { error } = await db.from('offline_live_rooms').update({ status: 'inactive' }).eq('id', roomId);
    if (error) throw error;
  },

  async listRoomCreatorAssignments(input: { includeInactive?: boolean; roomIds?: string[] } = {}): Promise<OfflineLiveRoomCreatorAssignment[]> {
    let query = db.from('offline_live_room_creators').select(assignmentSelect).order('assigned_at', { ascending: true });
    if (!input.includeInactive) query = query.eq('status', 'active').is('ended_at', null);
    if (input.roomIds?.length) query = query.in('room_id', input.roomIds);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map(mapAssignmentRow);
  },

  async assignCreatorToRoom(roomId: string, creatorEntityId: string): Promise<OfflineLiveRoomCreatorAssignment> {
    const { data, error } = await db
      .from('offline_live_room_creators')
      .insert({ room_id: roomId, creator_entity_id: creatorEntityId, status: 'active' })
      .select(assignmentSelect)
      .single();
    if (error) {
      if (isActiveCreatorAssignmentConflict(error)) {
        throw new Error('该主播已绑定其他直播间，请先解除原直播间关系。');
      }
      throw error;
    }
    return mapAssignmentRow(data);
  },

  async deactivateCreatorAssignment(assignmentId: string): Promise<void> {
    const { error } = await db
      .from('offline_live_room_creators')
      .update({ status: 'inactive', ended_at: new Date().toISOString() })
      .eq('id', assignmentId);
    if (error) throw error;
  },

  async listAvailableCreatorEntities(regionId?: string): Promise<OfflineLiveRoomCreatorEntity[]> {
    const profiles = await listActiveCreatorProfiles({ regionId });
    return groupProfilesIntoEntities(profiles).sort((first, second) => first.display_name.localeCompare(second.display_name, 'zh-Hans'));
  },

  async listPeriodSettings(month: string): Promise<RevenuePeriodSetting[]> {
    return agentService.listRevenuePeriodSettings(month);
  },

  async listRoomDashboard(input: { periods: OfflineLiveRoomPeriodRange[]; statusPeriods?: OfflineLiveRoomPeriodRange[]; regionId?: string }): Promise<OfflineLiveRoomDashboard> {
    const rooms = await this.listRooms({ regionId: input.regionId });
    if (rooms.length === 0) {
      return { rooms: [], tiktokTotal: 0, douyinTotal: 0, updatedRoomCount: 0, pendingRoomCount: 0, creatorCount: 0 };
    }

    const roomIds = rooms.map((room) => room.id);
    const assignments = await this.listRoomCreatorAssignments({ roomIds });
    const entityIds = uniqueValues(assignments.map((assignment) => assignment.creator_entity_id));
    const profiles = entityIds.length > 0 ? await listActiveCreatorProfiles({ entityIds }) : [];
    const profileIds = profiles.map((profile) => profile.id);
    const records = profileIds.length > 0 && input.periods.length > 0 ? await listEffectiveWeeklyRevenueRecords(profileIds, input.periods.map((period) => period.startIso)) : [];
    const profileGroups = groupProfilesIntoEntities(profiles);
    const recordsByProfileAndPeriod = mapLatestRecordsByProfileAndPeriod(records);

    const dashboardRooms = rooms.map((room) => buildDashboardRoom(
      room,
      assignments.filter((assignment) => assignment.room_id === room.id),
      profileGroups,
      input.periods,
      input.statusPeriods ?? input.periods,
      recordsByProfileAndPeriod,
    ));

    const summary = dashboardRooms.reduce<OfflineLiveRoomDashboard & { creatorCountSet: Set<string> }>(
      (summary, room) => {
        summary.rooms.push(room);
        summary.tiktokTotal += room.tiktokTotal;
        summary.douyinTotal += room.douyinTotal;
        if (room.status === 'updated') summary.updatedRoomCount += 1;
        if (room.status === 'pending' || room.status === 'unconfigured') summary.pendingRoomCount += 1;
        room.creators.forEach((creator) => summary.creatorCountSet.add(creator.entityId));
        return summary;
      },
      { rooms: [], tiktokTotal: 0, douyinTotal: 0, updatedRoomCount: 0, pendingRoomCount: 0, creatorCount: 0, creatorCountSet: new Set<string>() } as OfflineLiveRoomDashboard & { creatorCountSet: Set<string> },
    );

    return {
      rooms: summary.rooms,
      tiktokTotal: summary.tiktokTotal,
      douyinTotal: summary.douyinTotal,
      updatedRoomCount: summary.updatedRoomCount,
      pendingRoomCount: summary.pendingRoomCount,
      creatorCount: summary.creatorCountSet.size,
    };
  },
};

function normalizeRoomInput(input: OfflineLiveRoomFormInput) {
  return {
    region_id: input.regionId,
    room_number: input.roomNumber.trim(),
    name: input.name.trim(),
    sort_order: input.sortOrder,
  };
}

async function listActiveCreatorProfiles(input: { regionId?: string; entityIds?: string[] }): Promise<CreatorProfile[]> {
  let query = db
    .from('creator_profiles')
    .select(creatorProfileSelect)
    .eq('status', 'active')
    .eq('membership_status', 'active')
    .not('creator_entity_id', 'is', null)
    .order('creator_name', { ascending: true });

  if (input.regionId) query = query.eq('region_id', input.regionId);
  if (input.entityIds?.length) query = query.in('creator_entity_id', input.entityIds);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(mapCreatorProfileRow);
}

async function listEffectiveWeeklyRevenueRecords(profileIds: string[], periodStartDates: string[]): Promise<WeeklyRevenueRecord[]> {
  const { data, error } = await db
    .from('creator_weekly_revenue_records')
    .select('*')
    .in('creator_profile_id', profileIds)
    .in('week_start_date', periodStartDates)
    .in('status', ['submitted', 'confirmed']);
  if (error) throw error;
  return (data ?? []).map(mapWeeklyRevenueRow);
}

function buildDashboardRoom(
  room: OfflineLiveRoom,
  assignments: OfflineLiveRoomCreatorAssignment[],
  entities: OfflineLiveRoomCreatorEntity[],
  periods: OfflineLiveRoomPeriodRange[],
  statusPeriods: OfflineLiveRoomPeriodRange[],
  recordsByProfileAndPeriod: Map<string, WeeklyRevenueRecord>,
): OfflineLiveRoomDashboardRoom {
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const creators = assignments
    .map((assignment) => entityById.get(assignment.creator_entity_id))
    .filter((entity): entity is OfflineLiveRoomCreatorEntity => Boolean(entity))
    .map((entity) => ({
      entityId: entity.id,
      displayName: entity.display_name,
      profiles: entity.profiles.map((profile) => {
        const records = getRecordsForProfile(profile.id, periods, recordsByProfileAndPeriod);
        return {
          profile,
          records,
          total: records.reduce((sum, record) => sum + record.revenue_amount, 0),
          record: getLatestRecord(records),
        };
      }),
    }));

  const allProfiles = creators.flatMap((creator) => creator.profiles);
  const expectedProfileCount = allProfiles.length * statusPeriods.length;
  const updatedProfileCount = allProfiles.reduce((count, profile) => count + countProfileUpdatedPeriods(profile.profile.id, statusPeriods, recordsByProfileAndPeriod), 0);
  const validRecords = allProfiles.flatMap((profile) => profile.records);

  return {
    room,
    assignments,
    creators,
    tiktokTotal: validRecords.filter((record) => record.platform === 'tiktok').reduce((sum, record) => sum + record.revenue_amount, 0),
    douyinTotal: validRecords.filter((record) => record.platform === 'douyin').reduce((sum, record) => sum + record.revenue_amount, 0),
    status: getRoomUpdateStatus(expectedProfileCount, updatedProfileCount),
    expectedProfileCount,
    updatedProfileCount,
    latestUpdatedAt: getLatestRevenueTime(validRecords),
  };
}

function getRecordsForProfile(profileId: string, periods: OfflineLiveRoomPeriodRange[], recordsByProfileAndPeriod: Map<string, WeeklyRevenueRecord>) {
  return periods
    .map((period) => recordsByProfileAndPeriod.get(`${profileId}:${period.startIso}`) ?? null)
    .filter((record): record is WeeklyRevenueRecord => Boolean(record));
}

function countProfileUpdatedPeriods(profileId: string, periods: OfflineLiveRoomPeriodRange[], recordsByProfileAndPeriod: Map<string, WeeklyRevenueRecord>) {
  return periods.filter((period) => recordsByProfileAndPeriod.has(`${profileId}:${period.startIso}`)).length;
}

function getLatestRecord(records: WeeklyRevenueRecord[]) {
  return [...records].sort((first, second) => getRecordTime(second) - getRecordTime(first))[0] ?? null;
}

function getRoomUpdateStatus(expectedProfileCount: number, updatedProfileCount: number): OfflineLiveRoomUpdateStatus {
  if (expectedProfileCount === 0) return 'unconfigured';
  if (updatedProfileCount === expectedProfileCount) return 'updated';
  if (updatedProfileCount > 0) return 'partial';
  return 'pending';
}

function getLatestRevenueTime(records: WeeklyRevenueRecord[]) {
  const latest = records.sort((first, second) => getRecordTime(second) - getRecordTime(first))[0];
  return latest?.updated_at ?? latest?.submitted_at ?? null;
}

function getRecordTime(record: WeeklyRevenueRecord) {
  return new Date(record.updated_at ?? record.submitted_at ?? record.created_at).getTime();
}

function mapLatestRecordsByProfileAndPeriod(records: WeeklyRevenueRecord[]) {
  const recordMap = new Map<string, WeeklyRevenueRecord>();
  records.forEach((record) => {
    const key = `${record.creator_profile_id}:${record.week_start_date}`;
    const current = recordMap.get(key);
    if (!current || getRecordTime(record) > getRecordTime(current)) {
      recordMap.set(key, record);
    }
  });
  return recordMap;
}

function groupProfilesIntoEntities(profiles: CreatorProfile[]): OfflineLiveRoomCreatorEntity[] {
  const groups = new Map<string, OfflineLiveRoomCreatorEntity>();
  profiles.forEach((profile) => {
    if (!profile.creator_entity_id) return;
    const current = groups.get(profile.creator_entity_id) ?? {
      id: profile.creator_entity_id,
      display_name: profile.creator_name || profile.platform_account || profile.platform_user_id || '未命名主播',
      region_id: profile.region_id,
      status: 'active',
      profiles: [],
    };
    current.display_name = getEntityDisplayName(current.display_name, profile);
    current.profiles = sortCreatorProfiles([...current.profiles, profile]);
    groups.set(profile.creator_entity_id, current);
  });
  return Array.from(groups.values());
}

function getEntityDisplayName(currentName: string, profile: CreatorProfile) {
  if (currentName && currentName !== '未命名主播') return currentName;
  return profile.creator_name || profile.platform_account || profile.platform_user_id || currentName;
}

function sortCreatorProfiles(profiles: CreatorProfile[]) {
  const platformOrder: Record<CreatorPlatform, number> = { tiktok: 0, douyin: 1 };
  return [...profiles].sort((first, second) => platformOrder[first.platform] - platformOrder[second.platform]);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRoomRow(row: any): OfflineLiveRoom {
  return {
    id: row.id,
    region_id: row.region_id,
    room_number: row.room_number,
    name: row.name,
    status: row.status,
    sort_order: Number(row.sort_order) || 0,
    created_by_employee_id: row.created_by_employee_id ?? null,
    updated_by_employee_id: row.updated_by_employee_id ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    region: row.region ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapAssignmentRow(row: any): OfflineLiveRoomCreatorAssignment {
  return {
    id: row.id,
    room_id: row.room_id,
    creator_entity_id: row.creator_entity_id,
    status: row.status,
    assigned_at: row.assigned_at,
    ended_at: row.ended_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCreatorProfileRow(row: any): CreatorProfile {
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
    status: row.status,
    bank_name: row.bank_name,
    bank_account: row.bank_account,
    created_at: row.created_at,
    updated_at: row.updated_at,
    region: row.regions ?? row.region ?? null,
    scout: row.scout ?? null,
    manager: row.manager ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapWeeklyRevenueRow(row: any): WeeklyRevenueRecord {
  return {
    id: row.id,
    creator_entity_id: row.creator_entity_id ?? null,
    creator_profile_id: row.creator_profile_id,
    platform: row.platform,
    platform_uid: row.platform_uid,
    week_start_date: row.week_start_date,
    week_end_date: row.week_end_date,
    revenue_amount: Number(row.revenue_amount) || 0,
    revenue_unit: row.revenue_unit,
    source: row.source,
    source_reference: row.source_reference ?? null,
    agent_note: row.agent_note ?? null,
    manager_note: row.manager_note ?? null,
    status: row.status,
    submitted_by_employee_id: row.submitted_by_employee_id ?? null,
    submitted_at: row.submitted_at ?? null,
    confirmed_by_employee_id: row.confirmed_by_employee_id ?? null,
    confirmed_at: row.confirmed_at ?? null,
    created_by_employee_id: row.created_by_employee_id ?? null,
    updated_by_employee_id: row.updated_by_employee_id ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function isActiveCreatorAssignmentConflict(error: unknown) {
  if (typeof error !== 'object' || !error) return false;
  const details = [
    'code' in error && typeof error.code === 'string' ? error.code : '',
    'message' in error && typeof error.message === 'string' ? error.message : '',
    'details' in error && typeof error.details === 'string' ? error.details : '',
  ].join(' ');
  return details.includes('23505') || details.includes('offline_live_room_creators_one_active');
}

export function formatOfflineLiveRoomRevenue(value: number) {
  return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export function getOfflineLiveRoomRevenueUnit(platform: CreatorPlatform) {
  return platform === 'tiktok' ? '钻石' : '音浪';
}

export { platformLabels };
