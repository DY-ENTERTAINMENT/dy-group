-- Personal business card social QR codes. This migration is intentionally not executed by the client.

alter table public.employees
  add column if not exists wechat_id text,
  add column if not exists wechat_qr_url text,
  add column if not exists show_wechat_qr_on_card boolean not null default false,
  add column if not exists instagram_username text,
  add column if not exists instagram_qr_url text,
  add column if not exists use_personal_instagram boolean not null default false,
  add column if not exists show_instagram_qr_on_card boolean not null default false;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-business-card',
  'profile-business-card',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = true,
    file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "Business card QR images are publicly readable" on storage.objects;
create policy "Business card QR images are publicly readable"
on storage.objects for select
to public
using (bucket_id = 'profile-business-card');

drop policy if exists "Users can upload own business card QR images" on storage.objects;
create policy "Users can upload own business card QR images"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'profile-business-card'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can update own business card QR images" on storage.objects;
create policy "Users can update own business card QR images"
on storage.objects for update
to authenticated
using (
  bucket_id = 'profile-business-card'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'profile-business-card'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can delete own business card QR images" on storage.objects;
create policy "Users can delete own business card QR images"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'profile-business-card'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- This policy grants a user access only to their employee row. The trigger below
-- restricts ordinary employees to the business-card social fields below.
drop policy if exists "Users can update own business card QR URLs" on public.employees;
drop policy if exists "Users can update own business card social fields" on public.employees;
create policy "Users can update own business card social fields"
on public.employees for update
to authenticated
using (profile_id = auth.uid() and deleted_at is null)
with check (profile_id = auth.uid() and deleted_at is null);

create or replace function public.prevent_restricted_employee_updates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_role public.app_role;
begin
  if public.current_user_is_super_admin() then
    return new;
  end if;

  select role into current_role
  from public.profiles
  where id = auth.uid()
    and status = 'approved';

  if current_role is null then
    raise exception '无权修改员工资料。';
  end if;

  if new.require_attendance is distinct from old.require_attendance then
    raise exception '只有 Super Admin 可以修改是否需要考勤。';
  end if;

  if auth.uid() = old.profile_id
     and not public.current_user_has_permission('staff', 'use')
     and (to_jsonb(new) - array['wechat_id', 'wechat_qr_url', 'show_wechat_qr_on_card', 'instagram_username', 'instagram_qr_url', 'use_personal_instagram', 'show_instagram_qr_on_card', 'updated_at'])
         is distinct from (to_jsonb(old) - array['wechat_id', 'wechat_qr_url', 'show_wechat_qr_on_card', 'instagram_username', 'instagram_qr_url', 'use_personal_instagram', 'show_instagram_qr_on_card', 'updated_at']) then
    raise exception '个人名片仅能修改自己的社交资料和二维码。';
  end if;

  return new;
end;
$$;
