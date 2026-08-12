import { supabase } from '../lib/supabase';
import type { AppRole, Profile } from '../types/database';
import type { PermissionAccess, PermissionState } from './permission-management.service';

export type PermissionAction = keyof PermissionAccess;

export type RuntimePermissions = {
  role: AppRole | null;
  permissions: PermissionState;
};

const db = supabase as any;

const parentPermissionKeys: Record<string, string> = {
  'agent-revenue-data': 'agent',
  'agent-creator-data': 'agent',
  'agent-adjustment-requests': 'agent',
  'agent-design-requests': 'agent',
  'designer-intake': 'designer',
  'designer-progress': 'designer',
  'scout-recruiting-data': 'scout',
  'scout-recruit-list': 'scout',
  'scout-onboarding': 'scout',
  'scout-streamer-stats': 'scout',
  staff: 'hr',
  'registration-review': 'hr',
  'leave-review': 'hr',
  'work-time-adjustment': 'hr',
  'attendance-management': 'hr',
  'public-holidays': 'hr',
  'attendance-locations': 'hr',
};

export const permissionRuntimeService = {
  async getRuntimePermissions(profile: Profile | null): Promise<RuntimePermissions> {
    if (!profile) {
      return { role: null, permissions: {} };
    }

    if (profile.role === 'super_admin') {
      return { role: profile.role, permissions: {} };
    }

    const { data: employee, error: employeeError } = await db
      .from('employees')
      .select('id, job_title_id')
      .eq('profile_id', profile.id)
      .is('deleted_at', null)
      .maybeSingle();

    if (employeeError) throw employeeError;
    if (!employee?.id) {
      return { role: profile.role, permissions: {} };
    }

    const [jobTitleResult, specialAccessResult, overrideResult] = await Promise.all([
      employee.job_title_id
        ? db
            .from('job_title_permission_templates')
            .select('permission_key, can_view, can_use')
            .eq('job_title_id', employee.job_title_id)
        : Promise.resolve({ data: [], error: null }),
      db
        .from('employee_special_permissions')
        .select('special_permission_template_id, can_view, can_use')
        .eq('employee_id', employee.id)
        .eq('is_enabled', true),
      db.from('employee_permission_overrides').select('permission_key, can_view, can_use').eq('employee_id', employee.id),
    ]);

    if (jobTitleResult.error) throw jobTitleResult.error;
    if (specialAccessResult.error) throw specialAccessResult.error;
    if (overrideResult.error) throw overrideResult.error;

    const permissions: PermissionState = {};
    mergePermissionRows(permissions, jobTitleResult.data ?? []);

    const specialAccessRows = specialAccessResult.data ?? [];
    const specialTemplateIds = specialAccessRows
      .map((row: { special_permission_template_id: string | null }) => row.special_permission_template_id)
      .filter(Boolean);

    if (specialTemplateIds.length > 0) {
      const { data: specialItems, error: specialItemsError } = await db
        .from('special_permission_template_items')
        .select('special_permission_template_id, permission_key, can_view, can_use')
        .in('special_permission_template_id', specialTemplateIds);

      if (specialItemsError) throw specialItemsError;

      const accessByTemplateId = new Map<string, PermissionAccess>(
        specialAccessRows.map((row: { special_permission_template_id: string; can_view: boolean; can_use: boolean }) => [
          row.special_permission_template_id,
          { view: row.can_view, use: row.can_view && row.can_use },
        ]),
      );

      (specialItems ?? []).forEach(
        (item: { special_permission_template_id: string; permission_key: string; can_view: boolean; can_use: boolean }) => {
          const templateAccess = accessByTemplateId.get(item.special_permission_template_id);
          if (!templateAccess) return;

          mergePermissionAccess(permissions, item.permission_key, {
            view: templateAccess.view && item.can_view,
            use: templateAccess.use && item.can_use,
          });
        },
      );
    }

    mergePermissionRows(permissions, overrideResult.data ?? []);

    return { role: profile.role, permissions };
  },

  hasPermission(runtime: RuntimePermissions | null, permissionKey: string, action: PermissionAction) {
    if (runtime?.role === 'super_admin') return true;
    if (!runtime) return false;

    const access = runtime.permissions[permissionKey];
    const parentAccess = parentPermissionKeys[permissionKey] ? runtime.permissions[parentPermissionKeys[permissionKey]] : undefined;

    if (action === 'view') {
      return Boolean(access?.view || parentAccess?.view);
    }

    return Boolean(access?.view && access.use) || Boolean(parentAccess?.view && parentAccess.use);
  },
};

function mergePermissionRows(
  permissions: PermissionState,
  rows: Array<{ permission_key: string; can_view: boolean; can_use: boolean }>,
) {
  rows.forEach((row) => {
    mergePermissionAccess(permissions, row.permission_key, {
      view: row.can_view,
      use: row.can_view && row.can_use,
    });
  });
}

function mergePermissionAccess(permissions: PermissionState, permissionKey: string, access: PermissionAccess) {
  const current = permissions[permissionKey] ?? { view: false, use: false };
  const nextUse = current.use || (access.view && access.use);
  permissions[permissionKey] = {
    view: current.view || access.view || nextUse,
    use: nextUse,
  };
}

