begin;

-- Adds an explicit, view-only HR permission. Existing roles and templates remain unchanged.
insert into public.permission_items (permission_key, parent_key, name, sort_order, is_reserved)
values ('attendance-photos', 'hr', '查看员工考勤打卡照片', 47, false)
on conflict (permission_key) do update
set
  parent_key = excluded.parent_key,
  name = excluded.name,
  sort_order = excluded.sort_order,
  is_reserved = excluded.is_reserved,
  is_active = true,
  updated_at = now();

-- Sensitive permissions must be granted on the requested item itself; unlike the
-- existing runtime helper, this function deliberately does not inherit parent_key.
create or replace function public.current_user_has_explicit_permission(
  p_permission_key text,
  p_action text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  viewer_profile public.profiles;
  viewer_employee public.employees;
begin
  if auth.uid() is null then
    return false;
  end if;

  if p_action is null or p_action not in ('view', 'use') then
    raise exception 'Unsupported permission action: %', p_action
      using errcode = '22023';
  end if;

  if public.current_user_is_super_admin() then
    return true;
  end if;

  select p.*
  into viewer_profile
  from public.profiles p
  where p.id = auth.uid()
    and p.status = 'approved'
  limit 1;

  if viewer_profile.id is null then
    return false;
  end if;

  select e.*
  into viewer_employee
  from public.employees e
  where e.profile_id = viewer_profile.id
    and e.deleted_at is null
  limit 1;

  if viewer_employee.id is null then
    return false;
  end if;

  if not exists (
    select 1
    from public.permission_items pi
    where pi.permission_key = p_permission_key
      and pi.is_active = true
  ) then
    return false;
  end if;

  if exists (
    select 1
    from public.employee_permission_overrides epo
    where epo.employee_id = viewer_employee.id
      and epo.permission_key = p_permission_key
      and epo.effect = 'deny'
      and case
        when p_action = 'view' then epo.can_view
        else epo.can_view and epo.can_use
      end
  ) or exists (
    select 1
    from public.employee_special_permissions esp
    join public.special_permission_templates spt
      on spt.id = esp.special_permission_template_id
      and spt.is_active = true
    join public.special_permission_template_items spti
      on spti.special_permission_template_id = esp.special_permission_template_id
    where esp.employee_id = viewer_employee.id
      and esp.is_enabled = true
      and spti.permission_key = p_permission_key
      and spti.effect = 'deny'
      and case
        when p_action = 'view' then esp.can_view and spti.can_view
        else esp.can_view and esp.can_use and spti.can_view and spti.can_use
      end
  ) then
    return false;
  end if;

  return exists (
    select 1
    from public.job_title_permission_templates jtpt
    where jtpt.job_title_id = viewer_employee.job_title_id
      and jtpt.permission_key = p_permission_key
      and case
        when p_action = 'view' then jtpt.can_view
        else jtpt.can_view and jtpt.can_use
      end
  ) or exists (
    select 1
    from public.employee_special_permissions esp
    join public.special_permission_templates spt
      on spt.id = esp.special_permission_template_id
      and spt.is_active = true
    join public.special_permission_template_items spti
      on spti.special_permission_template_id = esp.special_permission_template_id
    where esp.employee_id = viewer_employee.id
      and esp.is_enabled = true
      and spti.permission_key = p_permission_key
      and spti.effect = 'grant'
      and case
        when p_action = 'view' then esp.can_view and spti.can_view
        else esp.can_view and esp.can_use and spti.can_view and spti.can_use
      end
  ) or exists (
    select 1
    from public.employee_permission_overrides epo
    where epo.employee_id = viewer_employee.id
      and epo.permission_key = p_permission_key
      and epo.effect = 'grant'
      and case
        when p_action = 'view' then epo.can_view
        else epo.can_view and epo.can_use
      end
  );
end;
$$;

revoke all on function public.current_user_has_explicit_permission(text, text) from public;
grant execute on function public.current_user_has_explicit_permission(text, text) to authenticated;

-- Keep the employee-own SELECT policy unchanged. Replace only the management SELECT policy.
drop policy if exists "Attendance managers can read scoped attendance photos" on storage.objects;
create policy "Attendance photo viewers can read scoped attendance photos"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'attendance-photos'
  and (
    public.current_user_is_super_admin()
    or (
      public.current_user_has_permission('attendance-management', 'view')
      and public.current_user_has_explicit_permission('attendance-photos', 'view')
      and exists (
        select 1
        from public.attendance_records ar
        join public.employees e on e.id = ar.employee_id
        where ar.photo_path = storage.objects.name
          and ar.profile_id::text = (storage.foldername(storage.objects.name))[1]
          and e.deleted_at is null
          and public.current_user_can_access_region(e.region_id)
      )
    )
  )
);

commit;
