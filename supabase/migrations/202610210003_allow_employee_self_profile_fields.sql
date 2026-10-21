begin;

-- Keep management and RLS behavior intact while aligning the employee's
-- self-service whitelist with the editable fields on the personal profile page.
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
     and (to_jsonb(new) - array[
       'phone',
       'nickname',
       'avatar_url',
       'address',
       'bank_name',
       'bank_account',
       'wechat_id',
       'wechat_qr_url',
       'show_wechat_qr_on_card',
       'instagram_username',
       'instagram_qr_url',
       'use_personal_instagram',
       'show_instagram_qr_on_card',
       'updated_at',
       'probation_confirm_date'
     ]) is distinct from (to_jsonb(old) - array[
       'phone',
       'nickname',
       'avatar_url',
       'address',
       'bank_name',
       'bank_account',
       'wechat_id',
       'wechat_qr_url',
       'show_wechat_qr_on_card',
       'instagram_username',
       'instagram_qr_url',
       'use_personal_instagram',
       'show_instagram_qr_on_card',
       'updated_at',
       'probation_confirm_date'
     ]) then
    raise exception '个人资料仅能修改自己的电话、昵称、地址、银行资料、头像及名片社交资料。';
  end if;

  return new;
end;
$$;

commit;
