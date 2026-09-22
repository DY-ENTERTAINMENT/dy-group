begin;

-- This is the single server-side access boundary for every authenticated employee,
-- including super_admin. It deliberately does not delete or alter historical data.
create or replace function public.current_user_is_active_employee()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.profiles p
      join public.employees e on e.profile_id = p.id
      where p.id = auth.uid()
        and p.status = 'approved'
        and e.deleted_at is null
        and e.status in ('active', 'probation')
    );
$$;

create or replace function public.current_user_is_approved()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.current_user_is_active_employee();
$$;

create or replace function public.current_user_has_permission(p_permission_key text, p_action text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare viewer_profile public.profiles; viewer_employee public.employees;
begin
  if p_action is null or p_action not in ('view', 'use') then raise exception 'Unsupported permission action: %', p_action using errcode = '22023'; end if;
  if not public.current_user_is_active_employee() then return false; end if;
  select * into viewer_profile from public.profiles where id = auth.uid();
  select * into viewer_employee from public.employees where profile_id = auth.uid() and deleted_at is null and status in ('active', 'probation') limit 1;
  if viewer_profile.role = 'super_admin' then return true; end if;
  return exists (
    with recursive applicable_permissions as (
      select permission_key, parent_key from public.permission_items where permission_key = p_permission_key and is_active
      union all select parent.permission_key, parent.parent_key from public.permission_items parent join applicable_permissions child on child.parent_key = parent.permission_key where parent.is_active
    )
    select 1 from applicable_permissions ap where exists (
      select 1 from public.job_title_permission_templates jtpt where jtpt.job_title_id = viewer_employee.job_title_id and jtpt.permission_key = ap.permission_key and case when p_action = 'view' then jtpt.can_view else jtpt.can_view and jtpt.can_use end
    ) or exists (
      select 1 from public.employee_special_permissions esp join public.special_permission_template_items spti on spti.special_permission_template_id = esp.special_permission_template_id where esp.employee_id = viewer_employee.id and esp.is_enabled and spti.permission_key = ap.permission_key and case when p_action = 'view' then esp.can_view and spti.can_view else esp.can_view and esp.can_use and spti.can_view and spti.can_use end
    ) or exists (
      select 1 from public.employee_permission_overrides epo where epo.employee_id = viewer_employee.id and epo.permission_key = ap.permission_key and case when p_action = 'view' then epo.can_view else epo.can_view and epo.can_use end
    )
  );
end;
$$;

-- Direct self-service policies must not bypass the central guard.
drop policy if exists "Profiles can read own profile" on public.profiles;
create policy "Active employees can read own profile" on public.profiles for select to authenticated using (auth.uid() = id and public.current_user_is_active_employee());
create policy "Active staff users can read scoped employee profiles" on public.profiles for select to authenticated using (
  public.current_user_has_permission('staff', 'view')
  and public.current_user_can_access_region(region_id)
);
drop policy if exists "Users can update own basic profile" on public.profiles;
create policy "Active employees can update own basic profile" on public.profiles for update to authenticated using (auth.uid() = id and public.current_user_is_active_employee()) with check (auth.uid() = id and public.current_user_is_active_employee());
drop policy if exists "Employees can read own leave requests" on public.leave_requests;
create policy "Active employees can read own leave requests" on public.leave_requests for select to authenticated using (auth.uid() = profile_id and public.current_user_is_active_employee());
drop policy if exists "Employees can create own leave requests" on public.leave_requests;
create policy "Active employees can create own leave requests" on public.leave_requests for insert to authenticated with check (auth.uid() = profile_id and public.current_user_is_active_employee() and status = 'pending' and reviewed_by is null and reviewed_at is null);
drop policy if exists "Employees can read own attendance records" on public.attendance_records;
create policy "Active employees can read own attendance records" on public.attendance_records for select to authenticated using (auth.uid() = profile_id and public.current_user_is_active_employee());
drop policy if exists "Employees can create own attendance records" on public.attendance_records;
create policy "Active employees can create own attendance records" on public.attendance_records for insert to authenticated with check (
  auth.uid() = profile_id
  and public.current_user_is_active_employee()
  and location_check_result = 'allowed'
  and exists (
    select 1 from public.employees e
    join public.attendance_locations al on al.id = attendance_records.attendance_location_id
    where e.id = attendance_records.employee_id
      and e.profile_id = auth.uid()
      and e.deleted_at is null
      and e.region_id = al.region_id
      and al.is_active = true
      and public.calculate_distance_meters(attendance_records.latitude, attendance_records.longitude, al.latitude, al.longitude) <= al.radius_meters
  )
);
drop policy if exists "Employees can upload own attendance photos" on storage.objects;
create policy "Active employees can upload own attendance photos" on storage.objects for insert to authenticated with check (bucket_id = 'attendance-photos' and (storage.foldername(name))[1] = auth.uid()::text and public.current_user_is_active_employee());
drop policy if exists "Employees can read own attendance photos" on storage.objects;
create policy "Active employees can read own attendance photos" on storage.objects for select to authenticated using (bucket_id = 'attendance-photos' and (storage.foldername(name))[1] = auth.uid()::text and public.current_user_is_active_employee());

-- Preserve the later attendance/leave manager scope while closing its direct self-access branch.
drop policy if exists "Attendance managers can read scoped attendance records" on public.attendance_records;
create policy "Attendance managers can read scoped attendance records" on public.attendance_records for select to authenticated using (
  (auth.uid() = profile_id and public.current_user_is_active_employee())
  or (public.current_user_has_permission('attendance-management', 'view') and exists (
    select 1 from public.employees e where e.id = attendance_records.employee_id and e.deleted_at is null and public.current_user_can_access_region(e.region_id)
  ))
);
drop policy if exists "Attendance managers can read scoped leave requests" on public.leave_requests;
create policy "Attendance managers can read scoped leave requests" on public.leave_requests for select to authenticated using (
  (auth.uid() = profile_id and public.current_user_is_active_employee())
  or (public.current_user_has_permission('attendance-management', 'view') and exists (
    select 1 from public.employees e where e.id = leave_requests.employee_id and e.deleted_at is null and public.current_user_can_access_region(e.region_id)
  ))
);

revoke all on function public.current_user_is_active_employee() from public;
grant execute on function public.current_user_is_active_employee() to authenticated;
commit;
