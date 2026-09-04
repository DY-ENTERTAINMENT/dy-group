begin;

create type public.replacement_work_change_type as enum ('reschedule', 'annual_leave', 'unpaid_leave', 'work_time');
create type public.replacement_work_change_status as enum ('pending', 'approved', 'rejected');

create table public.replacement_work_change_requests (
  id uuid primary key default gen_random_uuid(),
  source_replacement_leave_request_id uuid not null references public.leave_requests(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  change_type public.replacement_work_change_type not null,
  original_makeup_date date not null,
  requested_makeup_date date,
  original_start_time time not null,
  requested_start_time time,
  reason text not null check (length(btrim(reason)) > 0),
  status public.replacement_work_change_status not null default 'pending',
  review_note text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint replacement_work_change_shape check (
    (change_type = 'reschedule' and requested_makeup_date is not null and requested_start_time is null)
    or (change_type = 'work_time' and requested_makeup_date is null and requested_start_time is not null)
    or (change_type in ('annual_leave', 'unpaid_leave') and requested_makeup_date is null and requested_start_time is null)
  ),
  constraint replacement_work_change_review_state check (
    (status = 'pending' and reviewed_by is null and reviewed_at is null)
    or (status in ('approved', 'rejected') and reviewed_by is not null and reviewed_at is not null)
  )
);

create unique index replacement_work_change_one_pending_per_source_idx
  on public.replacement_work_change_requests(source_replacement_leave_request_id)
  where status = 'pending';
create unique index replacement_work_change_one_approved_per_source_idx
  on public.replacement_work_change_requests(source_replacement_leave_request_id)
  where status = 'approved';
create index replacement_work_change_employee_created_idx
  on public.replacement_work_change_requests(employee_id, created_at desc);
create index replacement_work_change_pending_created_idx
  on public.replacement_work_change_requests(status, created_at asc) where status = 'pending';

create trigger set_replacement_work_change_requests_updated_at
before update on public.replacement_work_change_requests
for each row execute function public.set_updated_at();

alter table public.work_time_adjustment_request_dates
  add column source_replacement_leave_request_id uuid references public.leave_requests(id) on delete restrict;
create unique index work_time_adjustment_dates_replacement_source_idx
  on public.work_time_adjustment_request_dates(source_replacement_leave_request_id)
  where source_replacement_leave_request_id is not null and status = 'approved';

create or replace function public.replacement_makeup_has_clock_in(p_employee_id uuid, p_makeup_date date)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.attendance_records ar
    where ar.employee_id = p_employee_id
      and ar.punch_type = 'clock_in'
      and (ar.punched_at at time zone 'Asia/Kuala_Lumpur')::date = p_makeup_date
  )
$$;

create or replace function public.get_effective_replacement_work_changes(
  p_start_date date, p_end_date date, p_region_id uuid default null
)
returns table (
  source_replacement_leave_request_id uuid, employee_id uuid, effective_makeup_date date,
  leave_effect text, change_request_id uuid, change_type text, requested_start_time time
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.current_user_has_permission('attendance-management', 'view') then raise exception 'No permission to view effective replacement work changes.'; end if;
  if p_region_id is not null and not public.current_user_can_access_region(p_region_id) then raise exception 'No permission to view this region.'; end if;
  return query
  with source_rows as (
    select lr.id source_id, lr.employee_id, lr.start_date, e.region_id,
      coalesce(c.id, null) change_id, c.change_type, coalesce(rs.requested_makeup_date, lr.start_date) effective_makeup_date, c.requested_start_time
    from public.leave_requests lr join public.employees e on e.id = lr.employee_id and e.deleted_at is null
    left join lateral (
      select c.* from public.replacement_work_change_requests c
      where c.source_replacement_leave_request_id = lr.id and c.status = 'approved'
      order by c.reviewed_at desc, c.created_at desc, c.id desc limit 1
    ) c on true
    left join lateral (
      select c.requested_makeup_date from public.replacement_work_change_requests c
      where c.source_replacement_leave_request_id = lr.id and c.status = 'approved' and c.change_type = 'reschedule'
      order by c.reviewed_at desc, c.created_at desc, c.id desc limit 1
    ) rs on true
    where lr.leave_type = 'replacement' and lr.status = 'approved'
      and (p_region_id is null or e.region_id = p_region_id) and public.current_user_can_access_region(e.region_id)
  )
  select source_id, employee_id,
    effective_makeup_date,
    case when change_type = 'annual_leave' then 'annual_leave' when change_type = 'unpaid_leave' then 'unpaid_leave' else 'none' end,
    change_id, change_type::text, requested_start_time
  from source_rows
  where start_date between p_start_date and p_end_date or effective_makeup_date between p_start_date and p_end_date;
end;
$$;

create or replace function public.create_replacement_work_change_request(
  p_source_replacement_leave_request_id uuid, p_change_type text, p_requested_makeup_date date,
  p_requested_start_time time, p_reason text
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare source_row record; new_id uuid; effective_date date; today_myt date := public.current_malaysia_business_date();
begin
  select lr.*, e.id employee_id, e.profile_id, e.region_id, e.start_work_time into source_row
  from public.leave_requests lr join public.employees e on e.id = lr.employee_id and e.deleted_at is null
  where lr.id = p_source_replacement_leave_request_id for update;
  if source_row.id is null or source_row.leave_type <> 'replacement' or source_row.status <> 'approved' then raise exception 'Only approved replacement leave can be changed.'; end if;
  if source_row.profile_id <> auth.uid() then raise exception 'Employees can only change their own replacement leave.'; end if;
  if exists (select 1 from public.replacement_work_change_requests c where c.source_replacement_leave_request_id = source_row.id and c.status = 'approved') then raise exception '该调休补班已完成变更，如需再次调整请联系 HR。'; end if;
  if not public.current_user_has_region_feature_permission('replacement-leave', 'use') then raise exception 'Replacement leave is not enabled in this region.'; end if;
  select coalesce((select c.requested_makeup_date from public.replacement_work_change_requests c
    where c.source_replacement_leave_request_id = source_row.id and c.status = 'approved' and c.change_type = 'reschedule'
    order by c.reviewed_at desc, c.created_at desc limit 1), source_row.start_date) into effective_date;
  if public.replacement_makeup_has_clock_in(source_row.employee_id, effective_date) then raise exception 'Make-up work has already started and cannot be changed from the employee portal.'; end if;
  if p_change_type not in ('reschedule','annual_leave','unpaid_leave','work_time') then raise exception 'Invalid replacement work change type.'; end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then raise exception 'Reason is required.'; end if;
  if p_change_type = 'reschedule' then
    if p_requested_makeup_date is null or extract(dow from p_requested_makeup_date) <> 6 or p_requested_makeup_date < today_myt then raise exception 'New make-up date must be a non-past Saturday.'; end if;
    if exists (select 1 from public.public_holidays ph where ph.is_active and ph.holiday_date = p_requested_makeup_date and (ph.region_id is null or ph.region_id = source_row.region_id)) then raise exception 'New make-up date cannot be a public holiday.'; end if;
    if exists (select 1 from public.rest_days rd where rd.employee_id=source_row.employee_id and rd.rest_date=p_requested_makeup_date and rd.status='confirmed') then raise exception 'New make-up date conflicts with a confirmed rest day.'; end if;
    if exists (select 1 from public.leave_requests l where l.employee_id = source_row.employee_id and l.status = 'approved' and l.leave_type <> 'replacement' and p_requested_makeup_date between l.start_date and l.end_date) then raise exception 'New make-up date conflicts with approved leave.'; end if;
    if exists (select 1 from public.leave_requests l where l.employee_id = source_row.employee_id and l.leave_type = 'replacement' and l.status = 'approved' and l.id <> source_row.id and l.start_date = p_requested_makeup_date) then raise exception 'New make-up date conflicts with another replacement leave.'; end if;
    if exists (select 1 from public.replacement_work_change_requests c where c.employee_id=source_row.employee_id and c.status='approved' and c.change_type='reschedule' and c.source_replacement_leave_request_id <> source_row.id and c.requested_makeup_date=p_requested_makeup_date) then raise exception 'New make-up date conflicts with another effective replacement change.'; end if;
  elsif p_change_type = 'work_time' then
    if p_requested_start_time is null or extract(second from p_requested_start_time) <> 0 or mod(extract(minute from p_requested_start_time)::integer, 15) <> 0 then raise exception 'Adjusted start time must use a 15-minute interval.'; end if;
  elsif p_requested_makeup_date is not null or p_requested_start_time is not null then raise exception 'Leave changes cannot include a date or work time.'; end if;
  insert into public.replacement_work_change_requests(source_replacement_leave_request_id, employee_id, change_type, original_makeup_date, original_start_time, requested_makeup_date, requested_start_time, reason)
  values(source_row.id, source_row.employee_id, p_change_type::public.replacement_work_change_type, effective_date, source_row.start_work_time, p_requested_makeup_date, p_requested_start_time, btrim(p_reason)) returning id into new_id;
  return new_id;
end;
$$;

create or replace function public.review_replacement_work_change_request(p_request_id uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare change_row record; source_row record; effective_date date; adjustment_id uuid; adjusted_end time;
begin
  select c.*, lr.id source_id, lr.employee_id source_employee_id, lr.status source_status, lr.leave_type, e.region_id, e.profile_id, e.start_work_time, e.end_work_time into change_row
  from public.replacement_work_change_requests c join public.leave_requests lr on lr.id=c.source_replacement_leave_request_id join public.employees e on e.id=c.employee_id and e.deleted_at is null
  where c.id=p_request_id for update;
  if change_row.id is null or change_row.status <> 'pending' then raise exception 'Only pending replacement work changes can be reviewed.'; end if;
  if not public.current_user_can_review_leave_requests() or not public.current_user_can_access_region(change_row.region_id) then raise exception 'No permission to review this replacement work change.'; end if;
  if p_status not in ('approved','rejected') then raise exception 'Invalid review status.'; end if;
  if p_status='rejected' and length(btrim(coalesce(p_note,'')))=0 then raise exception 'Review note is required when rejecting.'; end if;
  if p_status='approved' and change_row.employee_id is distinct from change_row.source_employee_id then raise exception 'Replacement work change employee does not match the source leave request.'; end if;
  if p_status='approved' and exists (select 1 from public.replacement_work_change_requests c where c.source_replacement_leave_request_id=change_row.source_replacement_leave_request_id and c.status='approved' and c.id <> change_row.id) then raise exception '该调休补班已完成其他变更，如需再次调整请联系 HR。'; end if;
  select coalesce((select c.requested_makeup_date from public.replacement_work_change_requests c where c.source_replacement_leave_request_id=change_row.source_replacement_leave_request_id and c.status='approved' and c.change_type='reschedule' order by c.reviewed_at desc, c.created_at desc limit 1), change_row.original_makeup_date) into effective_date;
  if change_row.source_status <> 'approved' or change_row.leave_type <> 'replacement' then raise exception 'Source replacement leave is no longer valid.'; end if;
  if public.replacement_makeup_has_clock_in(change_row.employee_id, effective_date) then raise exception 'Make-up work has already started and cannot be changed from the employee portal.'; end if;
  if p_status='approved' and change_row.change_type='reschedule' then
    if change_row.requested_makeup_date < public.current_malaysia_business_date() or extract(dow from change_row.requested_makeup_date) <> 6 then raise exception 'New make-up date is no longer valid.'; end if;
    if exists (select 1 from public.public_holidays ph where ph.is_active and ph.holiday_date=change_row.requested_makeup_date and (ph.region_id is null or ph.region_id=change_row.region_id)) then raise exception 'New make-up date conflicts with a public holiday.'; end if;
    if exists (select 1 from public.rest_days rd where rd.employee_id=change_row.employee_id and rd.rest_date=change_row.requested_makeup_date and rd.status='confirmed') then raise exception 'New make-up date conflicts with a confirmed rest day.'; end if;
    if exists (select 1 from public.leave_requests l where l.employee_id=change_row.employee_id and l.status='approved' and l.leave_type <> 'replacement' and change_row.requested_makeup_date between l.start_date and l.end_date) then raise exception 'New make-up date conflicts with approved leave.'; end if;
    if exists (select 1 from public.leave_requests l where l.employee_id=change_row.employee_id and l.leave_type='replacement' and l.status='approved' and l.id <> change_row.source_replacement_leave_request_id and l.start_date=change_row.requested_makeup_date) then raise exception 'New make-up date conflicts with another replacement leave.'; end if;
    if exists (select 1 from public.replacement_work_change_requests c where c.employee_id=change_row.employee_id and c.status='approved' and c.change_type='reschedule' and c.source_replacement_leave_request_id <> change_row.source_replacement_leave_request_id and c.requested_makeup_date=change_row.requested_makeup_date) then raise exception 'New make-up date conflicts with another effective replacement change.'; end if;
  end if;
  update public.replacement_work_change_requests set status=p_status::public.replacement_work_change_status, review_note=nullif(btrim(coalesce(p_note,'')),''), reviewed_by=auth.uid(), reviewed_at=now(), updated_at=now() where id=change_row.id;
  if p_status='approved' and change_row.change_type='work_time' then
    adjusted_end := change_row.requested_start_time + interval '8 hours 30 minutes';
    insert into public.work_time_adjustment_requests(profile_id,employee_id,region_id,requested_start_date,requested_end_date,original_start_work_time,original_end_work_time,requested_start_time,requested_end_time,reason)
    values(change_row.profile_id,change_row.employee_id,change_row.region_id,effective_date,effective_date,change_row.start_work_time,change_row.end_work_time,change_row.requested_start_time,adjusted_end,change_row.reason) returning id into adjustment_id;
    insert into public.work_time_adjustment_request_dates(request_id,profile_id,employee_id,region_id,work_date,original_start_work_time,original_end_work_time,adjusted_start_time,adjusted_end_time,status,reviewed_by,reviewed_at,source_replacement_leave_request_id)
    values(adjustment_id,change_row.profile_id,change_row.employee_id,change_row.region_id,effective_date,change_row.start_work_time,change_row.end_work_time,change_row.requested_start_time,adjusted_end,'approved',auth.uid(),now(),change_row.source_replacement_leave_request_id);
  end if;
end;
$$;

alter table public.replacement_work_change_requests enable row level security;
revoke all on public.replacement_work_change_requests from public, anon, authenticated;
create policy "Employees read own replacement work changes" on public.replacement_work_change_requests for select to authenticated using (
  exists (select 1 from public.employees e where e.id=employee_id and e.profile_id=auth.uid() and e.deleted_at is null)
  or exists (select 1 from public.employees e where e.id=replacement_work_change_requests.employee_id and public.current_user_can_access_region(e.region_id) and public.current_user_can_review_leave_requests())
);

grant select on public.replacement_work_change_requests to authenticated;
revoke all on function public.replacement_makeup_has_clock_in(uuid,date) from public, anon, authenticated;
revoke all on function public.get_effective_replacement_work_changes(date,date,uuid) from public, anon, authenticated;
revoke all on function public.create_replacement_work_change_request(uuid,text,date,time,text) from public, anon, authenticated;
revoke all on function public.review_replacement_work_change_request(uuid,text,text) from public, anon, authenticated;
grant execute on function public.get_effective_replacement_work_changes(date,date,uuid) to authenticated;
grant execute on function public.create_replacement_work_change_request(uuid,text,date,time,text) to authenticated;
grant execute on function public.review_replacement_work_change_request(uuid,text,text) to authenticated;
commit;
