begin;

-- Allow an employee to keep the Staff-facing avatar URL in sync with the
-- avatar stored on their own profile. All other self-service restrictions
-- remain unchanged.
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
     and (to_jsonb(new) - array['avatar_url', 'wechat_id', 'wechat_qr_url', 'show_wechat_qr_on_card', 'instagram_username', 'instagram_qr_url', 'use_personal_instagram', 'show_instagram_qr_on_card', 'updated_at', 'probation_confirm_date'])
         is distinct from (to_jsonb(old) - array['avatar_url', 'wechat_id', 'wechat_qr_url', 'show_wechat_qr_on_card', 'instagram_username', 'instagram_qr_url', 'use_personal_instagram', 'show_instagram_qr_on_card', 'updated_at', 'probation_confirm_date']) then
    raise exception '个人名片仅能修改自己的社交资料、二维码和头像。';
  end if;

  return new;
end;
$$;

-- Backfill only employees whose uniquely linked profile has an avatar and
-- whose Staff-facing avatar is still empty. Each update runs as that linked
-- profile so the existing ownership and trigger checks remain in force.
do $$
declare
  avatar_row record;
begin
  for avatar_row in
    select e.id as employee_id, e.profile_id, p.avatar_url
    from public.employees e
    join public.profiles p on p.id = e.profile_id
    where e.deleted_at is null
      and e.avatar_url is null
      and p.avatar_url is not null
  loop
    perform set_config('request.jwt.claim.sub', avatar_row.profile_id::text, true);

    update public.employees
    set avatar_url = avatar_row.avatar_url
    where id = avatar_row.employee_id
      and profile_id = avatar_row.profile_id
      and deleted_at is null
      and avatar_url is null;
  end loop;
end;
$$;

commit;
