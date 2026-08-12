import { supabase } from '../lib/supabase';
import type { Region } from '../types/database';
import type { RegionFeaturePermissionKey } from './permission-runtime.service';

const db = supabase as any;

export type RegionPermissionSetting = {
  id: string;
  region_id: string;
  permission_key: RegionFeaturePermissionKey;
  can_view: boolean;
  can_use: boolean;
};

export type RegionPermissionMatrixRow = {
  region: Region;
  settings: Partial<Record<RegionFeaturePermissionKey, RegionPermissionSetting>>;
};

export const managedRegionFeaturePermissions: Array<{
  key: RegionFeaturePermissionKey;
  label: string;
}> = [
  { key: 'replacement-leave', label: '调休' },
  { key: 'work-time-adjustment-employee', label: '工时调整' },
];

const managedRegionFeaturePermissionKeys = managedRegionFeaturePermissions.map((feature) => feature.key);

export const regionPermissionSettingsService = {
  async listMatrix(): Promise<RegionPermissionMatrixRow[]> {
    const [regionsResult, settingsResult] = await Promise.all([
      db
        .from('regions')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true }),
      db
        .from('region_permission_settings')
        .select('id, region_id, permission_key, can_view, can_use')
        .in('permission_key', managedRegionFeaturePermissionKeys),
    ]);

    if (regionsResult.error) {
      throw regionsResult.error;
    }

    if (settingsResult.error) {
      throw settingsResult.error;
    }

    const settingsByRegionId = new Map<string, Partial<Record<RegionFeaturePermissionKey, RegionPermissionSetting>>>();

    (settingsResult.data ?? []).forEach((setting: RegionPermissionSetting) => {
      const current = settingsByRegionId.get(setting.region_id) ?? {};
      current[setting.permission_key] = setting;
      settingsByRegionId.set(setting.region_id, current);
    });

    return ((regionsResult.data ?? []) as Region[]).map((region) => ({
      region,
      settings: settingsByRegionId.get(region.id) ?? {},
    }));
  },

  async updateSetting(input: {
    settingId: string;
    regionId: string;
    permissionKey: RegionFeaturePermissionKey;
    enabled: boolean;
  }): Promise<RegionPermissionSetting> {
    const { settingId, regionId, permissionKey, enabled } = input;
    const { data, error } = await db
      .from('region_permission_settings')
      .update({
        can_view: enabled,
        can_use: enabled,
      })
      .eq('id', settingId)
      .eq('region_id', regionId)
      .eq('permission_key', permissionKey)
      .select('id, region_id, permission_key, can_view, can_use')
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      throw new Error('未找到要更新的地区功能权限记录。');
    }

    return data as RegionPermissionSetting;
  },
};
