import { supabase } from '../lib/supabase';
import type { Employee, EmploymentType, JobTitle, Profile, Region } from '../types/database';

const AVATAR_BUCKET = 'profile-avatars';
const BUSINESS_CARD_BUCKET = 'profile-business-card';
const BUSINESS_CARD_QR_TYPES = ['wechat', 'instagram'] as const;

export type BusinessCardQrType = (typeof BUSINESS_CARD_QR_TYPES)[number];

export type MyEmployeeProfile = Pick<
  Employee,
  | 'id'
  | 'employee_code'
  | 'full_name'
  | 'nickname'
  | 'avatar_url'
  | 'wechat_id'
  | 'wechat_qr_url'
  | 'show_wechat_qr_on_card'
  | 'instagram_username'
  | 'instagram_qr_url'
  | 'use_personal_instagram'
  | 'show_instagram_qr_on_card'
  | 'email'
  | 'phone'
  | 'birthday'
  | 'identity_number'
  | 'address'
  | 'bank_name'
  | 'bank_account'
  | 'base_salary'
  | 'hire_date'
  | 'probation_confirm_date'
  | 'start_work_time'
  | 'end_work_time'
  | 'region_id'
  | 'employment_type_id'
  | 'job_title_id'
> & {
  region: Pick<Region, 'id' | 'code' | 'name' | 'company_english_name' | 'company_registration_no' | 'company_instagram' | 'company_facebook'> | null;
  employment_type: Pick<EmploymentType, 'id' | 'name'> | null;
  job_title: Pick<JobTitle, 'id' | 'name'> | null;
};

export type MyProfileData = {
  profile: Profile;
  employee: MyEmployeeProfile | null;
};

export type MyProfileUpdateValues = {
  full_name: string;
  phone: string;
  avatar_url?: string | null;
  nickname?: string;
  address?: string;
  bank_name?: string;
  bank_account?: string;
};

type EmployeeProfileRow = Omit<MyEmployeeProfile, 'region' | 'employment_type' | 'job_title'> & {
  regions: Pick<Region, 'id' | 'code' | 'name' | 'company_english_name' | 'company_registration_no' | 'company_instagram' | 'company_facebook'> | null;
  employment_types: Pick<EmploymentType, 'id' | 'name'> | null;
  job_titles: Pick<JobTitle, 'id' | 'name'> | null;
};

const employeeProfileSelect = `
  id,
  employee_code,
  full_name,
  nickname,
  avatar_url,
  wechat_id,
  wechat_qr_url,
  show_wechat_qr_on_card,
  instagram_username,
  instagram_qr_url,
  use_personal_instagram,
  show_instagram_qr_on_card,
  email,
  phone,
  birthday,
  identity_number,
  address,
  bank_name,
  bank_account,
  base_salary,
  hire_date,
  probation_confirm_date,
  start_work_time,
  end_work_time,
  region_id,
  employment_type_id,
  job_title_id,
  regions:region_id(id, code, name, company_english_name, company_registration_no, company_instagram, company_facebook),
  employment_types:employment_type_id(id, name),
  job_titles:job_title_id(id, name)
`;

export const profileService = {
  async getMyProfile(): Promise<MyProfileData> {
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError) {
      throw userError;
    }

    const userId = userData.user?.id;

    if (!userId) {
      throw new Error('请先登录后再查看个人资料。');
    }

    const [profileResult, employeeResult] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
      supabase
        .from('employees')
        .select(employeeProfileSelect)
        .eq('profile_id', userId)
        .is('deleted_at', null)
        .maybeSingle(),
    ]);

    if (profileResult.error) {
      throw profileResult.error;
    }

    if (employeeResult.error) {
      throw employeeResult.error;
    }

    if (!profileResult.data) {
      throw new Error('找不到当前登录用户的个人资料。');
    }

    return {
      profile: profileResult.data,
      employee: employeeResult.data ? mapEmployeeProfile(employeeResult.data as unknown as EmployeeProfileRow) : null,
    };
  },

  async updateMyProfile(values: MyProfileUpdateValues) {
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError) {
      throw userError;
    }

    const userId = userData.user?.id;

    if (!userId) {
      throw new Error('请先登录后再保存个人资料。');
    }

    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: values.full_name.trim(),
        phone: values.phone.trim() || null,
        avatar_url: values.avatar_url ?? null,
      })
      .eq('id', userId);

    if (error) {
      throw error;
    }

    const { error: employeeError } = await supabase
      .from('employees')
      .update({
        full_name: values.full_name.trim(),
        nickname: values.nickname?.trim() || null,
        phone: values.phone.trim() || null,
        avatar_url: values.avatar_url ?? null,
        address: values.address?.trim() || null,
        bank_name: values.bank_name?.trim() || null,
        bank_account: values.bank_account?.trim() || null,
      })
      .eq('profile_id', userId)
      .is('deleted_at', null);

    if (employeeError) {
      throw employeeError;
    }
  },

  async uploadAvatar(file: File) {
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError) {
      throw userError;
    }

    const userId = userData.user?.id;

    if (!userId) {
      throw new Error('请先登录后再上传头像。');
    }

    if (!file.type.startsWith('image/')) {
      throw new Error('头像文件必须是图片格式。');
    }

    const extension = file.name.split('.').pop()?.toLowerCase() || 'png';
    const path = `${userId}/${Date.now()}.${extension}`;
    const { error } = await supabase.storage.from(AVATAR_BUCKET).upload(path, file, {
      cacheControl: '3600',
      upsert: true,
      contentType: file.type,
    });

    if (error) {
      throw error;
    }

    const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
    return data.publicUrl;
  },

  async uploadBusinessCardQr(type: BusinessCardQrType, file: File, previousUrl?: string | null) {
    const userId = await getCurrentUserId('请先登录后再上传二维码。');
    validateBusinessCardQrFile(file);

    const extension = getImageExtension(file);
    const path = `${userId}/${type}-qr-${Date.now()}.${extension}`;
    const { error: uploadError } = await supabase.storage.from(BUSINESS_CARD_BUCKET).upload(path, file, {
      cacheControl: '3600',
      contentType: file.type,
      upsert: false,
    });

    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from(BUSINESS_CARD_BUCKET).getPublicUrl(path);
    const url = data.publicUrl;

    try {
      await updateMyBusinessCardQrUrl(userId, type, url);
    } catch (error) {
      await supabase.storage.from(BUSINESS_CARD_BUCKET).remove([path]);
      throw error;
    }

    if (previousUrl) {
      await removeBusinessCardQrFile(previousUrl);
    }

    return url;
  },

  async deleteBusinessCardQr(type: BusinessCardQrType, currentUrl?: string | null) {
    const userId = await getCurrentUserId('请先登录后再删除二维码。');

    if (currentUrl) {
      await removeBusinessCardQrFile(currentUrl);
    }

    await updateMyBusinessCardQrUrl(userId, type, null, false);
  },

  async updateBusinessCardSocial(values: {
    wechat_id: string;
    instagram_username: string;
    use_personal_instagram: boolean;
    show_wechat_qr_on_card: boolean;
    show_instagram_qr_on_card: boolean;
  }) {
    const userId = await getCurrentUserId('请先登录后再保存社交资料。');
    const { error } = await supabase
      .from('employees')
      .update({
        wechat_id: values.wechat_id.trim() || null,
        instagram_username: values.instagram_username.trim().replace(/^@+/, '') || null,
        use_personal_instagram: values.use_personal_instagram,
        show_wechat_qr_on_card: values.show_wechat_qr_on_card,
        show_instagram_qr_on_card: values.show_instagram_qr_on_card,
      })
      .eq('profile_id', userId)
      .is('deleted_at', null);
    if (error) throw error;
  },
};

async function getCurrentUserId(message: string) {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user?.id) throw new Error(message);
  return data.user.id;
}

function validateBusinessCardQrFile(file: File) {
  if (!BUSINESS_CARD_QR_TYPES.length || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('二维码图片仅支持 JPEG、PNG 或 WebP。');
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('二维码图片不能超过 5MB。');
  }
}

function getImageExtension(file: File) {
  if (file.type === 'image/jpeg') return 'jpg';
  if (file.type === 'image/webp') return 'webp';
  return 'png';
}

async function updateMyBusinessCardQrUrl(userId: string, type: BusinessCardQrType, url: string | null, showOnCard?: boolean) {
  const values = type === 'wechat'
    ? { wechat_qr_url: url, ...(showOnCard === undefined ? {} : { show_wechat_qr_on_card: showOnCard }) }
    : { instagram_qr_url: url, ...(showOnCard === undefined ? {} : { show_instagram_qr_on_card: showOnCard }) };
  const { error } = await supabase
    .from('employees')
    .update(values)
    .eq('profile_id', userId)
    .is('deleted_at', null);
  if (error) throw error;
}

async function removeBusinessCardQrFile(url: string) {
  const marker = `/storage/v1/object/public/${BUSINESS_CARD_BUCKET}/`;
  const index = url.indexOf(marker);
  if (index < 0) return;

  const path = decodeURIComponent(url.slice(index + marker.length).split('?')[0]);
  if (!path) return;
  await supabase.storage.from(BUSINESS_CARD_BUCKET).remove([path]);
}

function mapEmployeeProfile(row: EmployeeProfileRow): MyEmployeeProfile {
  return {
    id: row.id,
    employee_code: row.employee_code,
    full_name: row.full_name,
    nickname: row.nickname,
    avatar_url: row.avatar_url,
    wechat_id: row.wechat_id,
    wechat_qr_url: row.wechat_qr_url,
    show_wechat_qr_on_card: row.show_wechat_qr_on_card,
    instagram_username: row.instagram_username,
    instagram_qr_url: row.instagram_qr_url,
    use_personal_instagram: row.use_personal_instagram,
    show_instagram_qr_on_card: row.show_instagram_qr_on_card,
    email: row.email,
    phone: row.phone,
    birthday: row.birthday,
    identity_number: row.identity_number,
    address: row.address,
    bank_name: row.bank_name,
    bank_account: row.bank_account,
    base_salary: row.base_salary,
    hire_date: row.hire_date,
    probation_confirm_date: row.probation_confirm_date,
    start_work_time: row.start_work_time,
    end_work_time: row.end_work_time,
    region_id: row.region_id,
    employment_type_id: row.employment_type_id,
    job_title_id: row.job_title_id,
    region: row.regions,
    employment_type: row.employment_types,
    job_title: row.job_titles,
  };
}
