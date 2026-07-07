begin;

create or replace function public.current_user_can_manage_attendance()
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select public.current_user_has_permission('attendance-management', 'view')
$$;

drop policy if exists "Users can read scoped employees" on public.employees;
create policy "Users can read scoped employees"
on public.employees
for select
to authenticated
using (
  deleted_at is null
  and (
    profile_id = auth.uid()
    or (
      (
        public.current_user_has_permission('staff', 'view')
        or public.current_user_has_permission('attendance-management', 'view')
      )
      and public.current_user_can_access_region(region_id)
    )
  )
);

drop policy if exists "Attendance managers can read all attendance records" on public.attendance_records;
drop policy if exists "Attendance managers can read scoped attendance records" on public.attendance_records;
create policy "Attendance managers can read scoped attendance records"
on public.attendance_records
for select
to authenticated
using (
  auth.uid() = profile_id
  or (
    public.current_user_has_permission('attendance-management', 'view')
    and exists (
      select 1
      from public.employees e
      where e.id = attendance_records.employee_id
        and e.deleted_at is null
        and public.current_user_can_access_region(e.region_id)
    )
  )
);

drop policy if exists "Attendance managers can read all leave requests" on public.leave_requests;
drop policy if exists "Attendance managers can read scoped leave requests" on public.leave_requests;
create policy "Attendance managers can read scoped leave requests"
on public.leave_requests
for select
to authenticated
using (
  auth.uid() = profile_id
  or (
    public.current_user_has_permission('attendance-management', 'view')
    and exists (
      select 1
      from public.employees e
      where e.id = leave_requests.employee_id
        and e.deleted_at is null
        and public.current_user_can_access_region(e.region_id)
    )
  )
);

commit;
