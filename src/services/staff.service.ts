import { supabase } from '../lib/supabase';
import type { EmployeeStatus, EmploymentType, JobTitle, Profile, Region } from '../types/database';

export type EmployeeFormValues = {
  full_name: string;
  nickname: string;
  avatar_url: string;
  phone: string;
  email: string;
  employee_code: string;
  gender: string;
  birthday: string;
  identity_number: string;
  address: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  emergency_contact_relationship: string;
  bank_name: string;
  bank_account: string;
  bank_account_name: string;
  base_salary: string;
  region_id: string;
  employment_type_id: string;
  job_title_id: string;
  status: EmployeeStatus;
  hire_date: string;
  start_work_time: string;
  end_work_time: string;
  require_attendance: boolean;
};

export type EmployeeListItem = {
  id: string;
  full_name: string;
  nickname: string | null;
  avatar_url: string | null;
  phone: string | null;
  email: string | null;
  employee_code: string | null;
  gender: string | null;
  birthday: string | null;
  identity_number: string | null;
  address: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relationship: string | null;
  bank_name: string | null;
  bank_account: string | null;
  bank_account_name: string | null;
  base_salary: number | null;
  region_id: string | null;
  employment_type_id: string | null;
  job_title_id: string | null;
  status: EmployeeStatus;
  hire_date: string | null;
  probation_confirm_date: string | null;
  start_work_time: string | null;
  end_work_time: string | null;
  require_attendance: boolean;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  region: Pick<Region, 'id' | 'code' | 'name'> | null;
  employment_type: Pick<EmploymentType, 'id' | 'name'> | null;
  job_title: Pick<JobTitle, 'id' | 'name'> | null;
  reviewer: Pick<Profile, 'id' | 'full_name' | 'email'> | null;
};

export type StaffOptions = {
  regions: Region[];
  employmentTypes: EmploymentType[];
  jobTitles: JobTitle[];
};

type EmployeeRowWithRelations = Omit<EmployeeListItem, 'region' | 'employment_type' | 'job_title' | 'reviewer'> & {
  regions: Pick<Region, 'id' | 'code' | 'name'> | null;
  employment_types: Pick<EmploymentType, 'id' | 'name'> | null;
  job_titles: Pick<JobTitle, 'id' | 'name'> | null;
  reviewer: Pick<Profile, 'id' | 'full_name' | 'email'> | null;
};

const employeeSelect = `
  id,
  full_name,
  nickname,
  avatar_url,
  phone,
  email,
  employee_code,
  gender,
  birthday,
  identity_number,
  address,
  emergency_contact_name,
  emergency_contact_phone,
  emergency_contact_relationship,
  bank_name,
  bank_account,
  bank_account_name,
  base_salary,
  region_id,
  employment_type_id,
  job_title_id,
  status,
  hire_date,
  probation_confirm_date,
  start_work_time,
  end_work_time,
  require_attendance,
  reviewed_by,
  reviewed_at,
  created_at,
  updated_at,
  regions:region_id(id, code, name),
  employment_types:employment_type_id(id, name),
  job_titles:job_title_id(id, name)
`;

const staffUpdateTimeoutMs = 15_000;

export const staffService = {
  async listEmployees() {
    const { error: confirmError } = await supabase.rpc('auto_confirm_probation_employees');

    if (confirmError) {
      throw confirmError;
    }

    const { data, error } = await supabase
      .from('employees')
      .select(employeeSelect)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    const rows = (data ?? []) as unknown as EmployeeRowWithRelations[];
    const reviewerMap = await getReviewerMap(rows);

    return rows.map((row) => mapEmployeeRow(row, reviewerMap));
  },

  async getOptions(): Promise<StaffOptions> {
    const [regionsResult, employmentTypesResult, jobTitlesResult] = await Promise.all([
      supabase.from('regions').select('*').eq('is_active', true).order('sort_order', { ascending: true }),
      supabase.from('employment_types').select('*').eq('is_active', true).order('sort_order', { ascending: true }),
      supabase.from('job_titles').select('*').eq('is_active', true).order('sort_order', { ascending: true }),
    ]);

    if (regionsResult.error) {
      throw regionsResult.error;
    }

    if (employmentTypesResult.error) {
      throw employmentTypesResult.error;
    }

    if (jobTitlesResult.error) {
      throw jobTitlesResult.error;
    }

    return {
      regions: regionsResult.data ?? [],
      employmentTypes: employmentTypesResult.data ?? [],
      jobTitles: jobTitlesResult.data ?? [],
    };
  },

  async createEmployee(values: EmployeeFormValues) {
    await ensureEmployeeCodeAvailable(values.employee_code);

    const { error } = await supabase.from('employees').insert(normalizeEmployeePayload(values));

    if (error) {
      throw error;
    }
  },

  async updateEmployee(employeeId: string, values: EmployeeFormValues) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), staffUpdateTimeoutMs);

    try {
      await ensureEmployeeCodeAvailable(values.employee_code, employeeId, controller.signal);

      const { data, error } = await supabase
        .from('employees')
        .update(normalizeEmployeePayload(values))
        .eq('id', employeeId)
        .select('id')
        .abortSignal(controller.signal)
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (!data) {
        throw new Error('数据库没有更新任何资料，可能没有权限修改该工作人员或记录不存在。');
      }

      return await getEmployeeById(employeeId, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) {
        const timeoutError = new Error('请求超时，请检查网络后重试。') as Error & { cause?: unknown };
        timeoutError.cause = error;
        throw timeoutError;
      }

      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  },

  async softDeleteEmployee(employeeId: string) {
    const { error } = await supabase.rpc('soft_delete_employee', { employee_id: employeeId });

    if (error) {
      throw error;
    }
  },
};

async function ensureEmployeeCodeAvailable(value: string, currentEmployeeId?: string, signal?: AbortSignal) {
  const employeeCode = normalizeEmployeeCode(value);
  if (!employeeCode) return;

  let query = supabase.from('employees').select('id').eq('employee_code', employeeCode);

  if (currentEmployeeId) {
    query = query.neq('id', currentEmployeeId);
  }

  if (signal) {
    query = query.abortSignal(signal);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw error;
  }

  if (data) {
    throw new Error('员工编号已存在');
  }
}

async function getEmployeeById(employeeId: string, signal?: AbortSignal) {
  let query = supabase
    .from('employees')
    .select(employeeSelect)
    .eq('id', employeeId)
    .is('deleted_at', null);

  if (signal) {
    query = query.abortSignal(signal);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error('找不到对应的工作人员记录，无法确认工作时间是否保存成功。');
  }

  const row = data as unknown as EmployeeRowWithRelations;
  const reviewerMap = await getReviewerMap([row], signal);
  return mapEmployeeRow(row, reviewerMap);
}

async function getReviewerMap(rows: EmployeeRowWithRelations[], signal?: AbortSignal) {
  const reviewerIds = Array.from(new Set(rows.map((row) => row.reviewed_by).filter(Boolean))) as string[];
  if (reviewerIds.length === 0) return new Map<string, Pick<Profile, 'id' | 'full_name' | 'email'>>();

  let query = supabase.from('profiles').select('id, full_name, email').in('id', reviewerIds);

  if (signal) {
    query = query.abortSignal(signal);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return new Map((data ?? []).map((profile) => [profile.id, profile]));
}

function mapEmployeeRow(row: EmployeeRowWithRelations, reviewerMap: Map<string, Pick<Profile, 'id' | 'full_name' | 'email'>>): EmployeeListItem {
  return {
    id: row.id,
    full_name: row.full_name,
    nickname: row.nickname,
    avatar_url: row.avatar_url,
    phone: row.phone,
    email: row.email,
    employee_code: row.employee_code,
    gender: row.gender,
    birthday: row.birthday,
    identity_number: row.identity_number,
    address: row.address,
    emergency_contact_name: row.emergency_contact_name,
    emergency_contact_phone: row.emergency_contact_phone,
    emergency_contact_relationship: row.emergency_contact_relationship,
    bank_name: row.bank_name,
    bank_account: row.bank_account,
    bank_account_name: row.bank_account_name,
    base_salary: row.base_salary,
    region_id: row.region_id,
    employment_type_id: row.employment_type_id,
    job_title_id: row.job_title_id,
    status: row.status,
    hire_date: row.hire_date,
    probation_confirm_date: row.probation_confirm_date,
    start_work_time: row.start_work_time,
    end_work_time: row.end_work_time,
    require_attendance: row.require_attendance,
    reviewed_by: row.reviewed_by,
    reviewed_at: row.reviewed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    region: row.regions,
    employment_type: row.employment_types,
    job_title: row.job_titles,
    reviewer: row.reviewed_by ? reviewerMap.get(row.reviewed_by) ?? null : null,
  };
}

function normalizeEmployeePayload(values: EmployeeFormValues) {
  return {
    full_name: values.full_name.trim(),
    nickname: values.nickname.trim() || null,
    avatar_url: values.avatar_url.trim() || null,
    phone: values.phone.trim() || null,
    email: values.email.trim() || null,
    employee_code: normalizeEmployeeCode(values.employee_code) || null,
    gender: values.gender || null,
    birthday: values.birthday || null,
    identity_number: values.identity_number.trim() || null,
    address: values.address.trim() || null,
    emergency_contact_name: values.emergency_contact_name.trim() || null,
    emergency_contact_phone: values.emergency_contact_phone.trim() || null,
    emergency_contact_relationship: values.emergency_contact_relationship.trim() || null,
    bank_name: values.bank_name.trim() || null,
    bank_account: values.bank_account.trim() || null,
    bank_account_name: values.bank_account_name.trim() || null,
    base_salary: values.base_salary.trim() ? Number(values.base_salary) : null,
    region_id: values.region_id || null,
    employment_type_id: values.employment_type_id || null,
    job_title_id: values.job_title_id || null,
    status: values.status,
    hire_date: values.hire_date || null,
    start_work_time: values.start_work_time || null,
    end_work_time: values.end_work_time || null,
    require_attendance: values.require_attendance,
  };
}

function normalizeEmployeeCode(value: string) {
  return value.trim().toUpperCase();
}
