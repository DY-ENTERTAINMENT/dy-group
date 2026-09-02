import { supabase } from '../lib/supabase';

export type PermissionAccess = {
  view: boolean;
  use: boolean;
};

export type PermissionState = Record<string, PermissionAccess>;

export type SpecialPermissionTemplate = {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
};

export type EmployeePermissionProfile = {
  requireAttendance: boolean;
  regionIds: string[];
  specialPermissionAccess: PermissionState;
  permissions: PermissionState;
  directOverrides: EmployeePermissionOverride[];
};

type PermissionRow = {
  permission_key: string;
  can_view: boolean;
  can_use: boolean;
};

export type EmployeePermissionOverride = PermissionRow & {
  effect: 'grant' | 'deny';
};

type SpecialPermissionRow = SpecialPermissionTemplate;

const db = supabase as any;

export const permissionManagementService = {
  async listSpecialPermissionTemplates(): Promise<SpecialPermissionTemplate[]> {
    const { data, error } = await db
      .from('special_permission_templates')
      .select('id, name, description, sort_order, is_active')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) throw error;

    return (data ?? []) as SpecialPermissionTemplate[];
  },

  async getJobTitlePermissions(jobTitleId: string): Promise<PermissionState> {
    const { data, error } = await db
      .from('job_title_permission_templates')
      .select('permission_key, can_view, can_use')
      .eq('job_title_id', jobTitleId);

    if (error) throw error;

    return rowsToPermissionState(data ?? []);
  },

  async saveJobTitlePermissions(jobTitleId: string, permissions: PermissionState) {
    const { error: deleteError } = await db.from('job_title_permission_templates').delete().eq('job_title_id', jobTitleId);
    if (deleteError) throw deleteError;

    const rows = permissionStateToRows(permissions).map((row) => ({
      job_title_id: jobTitleId,
      permission_key: row.permission_key,
      can_view: row.can_view,
      can_use: row.can_use,
    }));

    if (rows.length === 0) return;

    const { error } = await db.from('job_title_permission_templates').insert(rows);
    if (error) throw error;
  },

  async saveSpecialPermissionTemplate(templateName: string, permissions: PermissionState) {
    const trimmedName = templateName.trim();
    if (!trimmedName) throw new Error('特殊权限名称不能为空。');

    const { data: templateData, error: templateError } = await db
      .from('special_permission_templates')
      .upsert(
        {
          name: trimmedName,
          is_active: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'name' },
      )
      .select('id, name, description, sort_order, is_active')
      .single();

    if (templateError) throw templateError;

    const template = templateData as SpecialPermissionRow;
    const { error: deleteError } = await db
      .from('special_permission_template_items')
      .delete()
      .eq('special_permission_template_id', template.id);
    if (deleteError) throw deleteError;

    const rows = permissionStateToRows(permissions).map((row) => ({
      special_permission_template_id: template.id,
      permission_key: row.permission_key,
      can_view: row.can_view,
      can_use: row.can_use,
      effect: 'grant',
    }));

    if (rows.length > 0) {
      const { error } = await db.from('special_permission_template_items').insert(rows);
      if (error) throw error;
    }

    return template;
  },

  async getSpecialPermissionTemplatePermissions(templateName: string): Promise<PermissionState> {
    const { data: templateData, error: templateError } = await db
      .from('special_permission_templates')
      .select('id')
      .eq('name', templateName)
      .maybeSingle();

    if (templateError) throw templateError;
    if (!templateData) return {};

    const { data, error } = await db
      .from('special_permission_template_items')
      .select('permission_key, can_view, can_use')
      .eq('special_permission_template_id', templateData.id);

    if (error) throw error;

    return rowsToPermissionState(data ?? []);
  },

  async getEmployeePermissions(employeeId: string): Promise<EmployeePermissionProfile> {
    const [settingsResult, regionsResult, specialResult, overridesResult] = await Promise.all([
      db.from('employee_permission_settings').select('require_attendance').eq('employee_id', employeeId).maybeSingle(),
      db.from('employee_permission_regions').select('region_id').eq('employee_id', employeeId),
      db
        .from('employee_special_permissions')
        .select('can_view, can_use, special_permission_templates(name)')
        .eq('employee_id', employeeId)
        .eq('is_enabled', true),
      db.from('employee_permission_overrides').select('permission_key, can_view, can_use, effect').eq('employee_id', employeeId),
    ]);

    if (settingsResult.error) throw settingsResult.error;
    if (regionsResult.error) throw regionsResult.error;
    if (specialResult.error) throw specialResult.error;
    if (overridesResult.error) throw overridesResult.error;

    return {
      requireAttendance: settingsResult.data?.require_attendance ?? true,
      regionIds: (regionsResult.data ?? []).map((row: { region_id: string }) => row.region_id),
      specialPermissionAccess: rowsToSpecialPermissionAccess(specialResult.data ?? []),
      permissions: rowsToPermissionState(overridesResult.data ?? []),
      directOverrides: (overridesResult.data ?? []) as EmployeePermissionOverride[],
    };
  },

  async saveEmployeePermissions(input: {
    employeeId: string;
    requireAttendance: boolean;
    regionIds: string[];
    specialPermissionAccess: PermissionState;
    specialPermissionTemplates: SpecialPermissionTemplate[];
    permissions: PermissionState;
  }) {
    const now = new Date().toISOString();
    const { error: settingsError } = await db
      .from('employee_permission_settings')
      .upsert(
        {
          employee_id: input.employeeId,
          require_attendance: input.requireAttendance,
          updated_at: now,
        },
        { onConflict: 'employee_id' },
      );
    if (settingsError) throw settingsError;

    const { error: employeeError } = await db.from('employees').update({ require_attendance: input.requireAttendance }).eq('id', input.employeeId);
    if (employeeError) throw employeeError;

    const { error: deleteRegionsError } = await db.from('employee_permission_regions').delete().eq('employee_id', input.employeeId);
    if (deleteRegionsError) throw deleteRegionsError;

    if (input.regionIds.length > 0) {
      const { error } = await db.from('employee_permission_regions').insert(
        input.regionIds.map((regionId) => ({
          employee_id: input.employeeId,
          region_id: regionId,
        })),
      );
      if (error) throw error;
    }

    const { error: deleteSpecialError } = await db.from('employee_special_permissions').delete().eq('employee_id', input.employeeId);
    if (deleteSpecialError) throw deleteSpecialError;

    const selectedTemplates = input.specialPermissionTemplates.filter((template) => {
      const access = input.specialPermissionAccess[template.name];
      return Boolean(access?.view || access?.use);
    });
    if (selectedTemplates.length > 0) {
      const { error } = await db.from('employee_special_permissions').insert(
        selectedTemplates.map((template) => ({
          employee_id: input.employeeId,
          special_permission_template_id: template.id,
          is_enabled: true,
          can_view: Boolean(input.specialPermissionAccess[template.name]?.view),
          can_use: Boolean(input.specialPermissionAccess[template.name]?.view && input.specialPermissionAccess[template.name]?.use),
          updated_at: now,
        })),
      );
      if (error) throw error;
    }

    const { error: deleteOverridesError } = await db.from('employee_permission_overrides').delete().eq('employee_id', input.employeeId);
    if (deleteOverridesError) throw deleteOverridesError;

    const overrideRows = permissionStateToRows(input.permissions).map((row) => ({
      employee_id: input.employeeId,
      permission_key: row.permission_key,
      can_view: row.can_view,
      can_use: row.can_use,
      effect: 'grant',
      updated_at: now,
    }));

    if (overrideRows.length > 0) {
      const { error } = await db.from('employee_permission_overrides').insert(overrideRows);
      if (error) throw error;
    }
  },
};

function rowsToPermissionState(rows: PermissionRow[]): PermissionState {
  return rows.reduce<PermissionState>((state, row) => {
    state[row.permission_key] = {
      view: row.can_view,
      use: row.can_use,
    };
    return state;
  }, {});
}

function rowsToSpecialPermissionAccess(
  rows: Array<{
    can_view: boolean;
    can_use: boolean;
    special_permission_templates: { name: string } | null;
  }>,
): PermissionState {
  return rows.reduce<PermissionState>((state, row) => {
    const name = row.special_permission_templates?.name;
    if (name) {
      state[name] = {
        view: row.can_view,
        use: row.can_view && row.can_use,
      };
    }
    return state;
  }, {});
}

function permissionStateToRows(permissions: PermissionState): PermissionRow[] {
  return Object.entries(permissions)
    .map(([permissionKey, access]) => ({
      permission_key: permissionKey,
      can_view: access.view,
      can_use: access.view && access.use,
    }));
}
