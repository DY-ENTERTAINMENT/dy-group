begin;

-- Source attendance punches are immutable. A recovery is a separate audit event
-- that makes exactly one mistaken clock-out ineligible for operational use.
create table if not exists public.attendance_clock_out_recoveries (
  id uuid primary key default gen_random_uuid(),
  attendance_record_id uuid not null unique references public.attendance_records(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  original_clock_out_at timestamptz not null,
  recovered_at timestamptz not null default now(),
  recovered_by uuid not null references public.profiles(id) on delete restrict,
  reason text not null default 'break_clock_out_mistake' check (reason = 'break_clock_out_mistake'),
  created_at timestamptz not null default now()
);

create index if not exists attendance_clock_out_recoveries_employee_time_idx
  on public.attendance_clock_out_recoveries(employee_id, original_clock_out_at);

alter table public.outgoing_event_audit_history
  drop constraint if exists outgoing_event_audit_action_check;
alter table public.outgoing_event_audit_history
  add constraint outgoing_event_audit_action_check
  check (action in ('started', 'completed', 'exception_detected', 'exception_handled', 'clock_out_recovered'));

alter table public.attendance_clock_out_recoveries enable row level security;
revoke all on table public.attendance_clock_out_recoveries from public, anon, authenticated;
grant select on table public.attendance_clock_out_recoveries to authenticated;

create policy "Active employees can read own clock-out recoveries"
on public.attendance_clock_out_recoveries for select to authenticated
using (profile_id = auth.uid() and public.current_user_is_active_employee());

create policy "Attendance managers can read scoped clock-out recoveries"
on public.attendance_clock_out_recoveries for select to authenticated
using (
  public.current_user_has_permission('attendance-management', 'view')
  and exists (
    select 1 from public.employees e
    where e.id = attendance_clock_out_recoveries.employee_id
      and e.deleted_at is null
      and public.current_user_can_access_region(e.region_id)
  )
);

create or replace function public.recover_my_break_clock_out()
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_employee public.employees;
  day_start timestamptz;
  day_end timestamptz;
  row_record public.attendance_records;
  target_clock_out public.attendance_records;
  seen_clock_in boolean := false;
  break_open boolean := false;
  target_was_during_open_break boolean := false;
  recovery_id uuid;
begin
  if auth.uid() is null or not public.current_user_is_active_employee() then
    raise exception 'No active employee session.';
  end if;

  select * into current_employee
  from public.employees
  where profile_id = auth.uid()
    and deleted_at is null
    and status in ('active', 'probation')
  order by created_at asc
  limit 1;
  if current_employee.id is null then
    raise exception 'No active employee session.';
  end if;

  -- Serializes recovery and new punches for this employee without touching source rows.
  perform pg_advisory_xact_lock(hashtextextended(current_employee.id::text, 0));
  day_start := ((now() at time zone 'Asia/Kuala_Lumpur')::date::timestamp at time zone 'Asia/Kuala_Lumpur');
  day_end := day_start + interval '1 day';

  select ar.* into target_clock_out
  from public.attendance_records ar
  where ar.employee_id = current_employee.id
    and ar.profile_id = auth.uid()
    and ar.punch_type = 'clock_out'
    and ar.punched_at >= day_start and ar.punched_at < day_end
  order by ar.punched_at desc, ar.id desc
  limit 1;

  if target_clock_out.id is null then
    raise exception 'No clock-out record eligible for recovery today.';
  end if;
  if exists (select 1 from public.attendance_clock_out_recoveries r where r.attendance_record_id = target_clock_out.id) then
    raise exception 'This clock-out has already been recovered.';
  end if;

  for row_record in
    select * from public.attendance_records
    where employee_id = current_employee.id
      and profile_id = auth.uid()
      and punched_at >= day_start and punched_at < day_end
    order by punched_at asc, id asc
  loop
    if row_record.id = target_clock_out.id then
      target_was_during_open_break := seen_clock_in and break_open;
    end if;
    if row_record.punch_type = 'clock_in' then seen_clock_in := true; end if;
    if row_record.punch_type = 'break_start' then break_open := true; end if;
    if row_record.punch_type = 'break_end' then break_open := false; end if;
  end loop;

  -- The mistaken clock-out must be the final event; no retry, cross-day or normal clock-out recovery.
  if not target_was_during_open_break or not exists (
    select 1 from public.attendance_records ar
    where ar.id = target_clock_out.id
      and ar.employee_id = current_employee.id
      and ar.profile_id = auth.uid()
      and ar.punched_at = (
        select max(ar2.punched_at) from public.attendance_records ar2
        where ar2.employee_id = current_employee.id and ar2.profile_id = auth.uid()
          and ar2.punched_at >= day_start and ar2.punched_at < day_end
      )
      and ar.id = (
        select ar3.id from public.attendance_records ar3
        where ar3.employee_id = current_employee.id and ar3.profile_id = auth.uid()
          and ar3.punched_at >= day_start and ar3.punched_at < day_end
        order by ar3.punched_at desc, ar3.id desc limit 1
      )
  ) then
    raise exception 'Only today''s final clock-out made during an open break can be recovered.';
  end if;

  insert into public.attendance_clock_out_recoveries (
    attendance_record_id, employee_id, profile_id, original_clock_out_at, recovered_by, reason
  ) values (
    target_clock_out.id, current_employee.id, auth.uid(), target_clock_out.punched_at, auth.uid(), 'break_clock_out_mistake'
  ) returning id into recovery_id;

  -- If the old punch had already been reconciled as an outgoing exception,
  -- restore its prior lifecycle and retain a second audit event explaining why.
  with restored as (
    update public.outgoing_events oe
    set status = case when oe.ended_at is null then 'in_progress' else 'completed' end,
        exception_reason = null,
        exception_detected_at = null,
        updated_at = now()
    where oe.employee_id = current_employee.id
      and oe.status = 'exception'
      and exists (
        select 1 from public.outgoing_event_audit_history h
        where h.event_id = oe.id
          and h.action = 'exception_detected'
          and h.note = 'Attendance clock-out record: ' || target_clock_out.id::text
      )
    returning oe.id, oe.request_id
  )
  insert into public.outgoing_event_audit_history(event_id, request_id, action, actor_profile_id, actor_name, note)
  select id, request_id, 'clock_out_recovered', auth.uid(), coalesce(public.outgoing_current_actor_name(), auth.uid()::text), 'Recovered attendance clock-out record: ' || target_clock_out.id::text
  from restored;

  return recovery_id;
end;
$$;

-- Existing normal punch behavior remains unchanged except that a clock-out during
-- an open Malaysia-day break is now rejected server-side.
create or replace function public.create_attendance_record_checked(
  p_punch_type public.attendance_punch_type,
  p_photo_path text,
  p_latitude numeric,
  p_longitude numeric,
  p_accuracy numeric,
  p_ip_address text,
  p_device_info text
)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  current_employee public.employees; nearest_location public.attendance_locations;
  nearest_distance numeric; created_record_id uuid; latest_break_type public.attendance_punch_type;
  day_start timestamptz; day_end timestamptz;
begin
  if auth.uid() is null then raise exception '无法确认当前用户。'; end if;
  if p_latitude is null or p_longitude is null then raise exception '请允许浏览器定位权限，否则无法打卡。'; end if;
  select e.* into current_employee from public.employees e where e.profile_id = auth.uid() and e.deleted_at is null order by e.created_at asc limit 1;
  if current_employee.id is null then raise exception '当前账号尚未关联工作人员，请联系 HR。'; end if;
  if current_employee.region_id is null then raise exception '当前员工尚未设置区域，请联系 HR。'; end if;
  -- Serialize new attendance events with a same-day recovery for this employee.
  perform pg_advisory_xact_lock(hashtextextended(current_employee.id::text, 0));
  if p_punch_type = 'clock_out' then
    day_start := ((now() at time zone 'Asia/Kuala_Lumpur')::date::timestamp at time zone 'Asia/Kuala_Lumpur'); day_end := day_start + interval '1 day';
    select ar.punch_type into latest_break_type from public.attendance_records ar
    where ar.employee_id = current_employee.id and ar.profile_id = auth.uid()
      and ar.punched_at >= day_start and ar.punched_at < day_end and ar.punch_type in ('break_start', 'break_end')
    order by ar.punched_at desc, ar.id desc limit 1;
    if latest_break_type = 'break_start' then raise exception '休息尚未结束，请先结束休息后再下班。'; end if;
  end if;
  select al.* into nearest_location from public.attendance_locations al
  where al.region_id = current_employee.region_id and al.is_active = true
  order by public.calculate_distance_meters(p_latitude, p_longitude, al.latitude, al.longitude) asc limit 1;
  if nearest_location.id is null then raise exception '当前区域尚未设置打卡地点，请联系 HR。'; end if;
  nearest_distance := public.calculate_distance_meters(p_latitude, p_longitude, nearest_location.latitude, nearest_location.longitude);
  if nearest_distance > nearest_location.radius_meters then raise exception '您目前不在指定打卡地点范围内，无法打卡。'; end if;
  insert into public.attendance_records (profile_id, employee_id, punch_type, photo_path, latitude, longitude, accuracy, ip_address, device_info, attendance_location_id, distance_meters, location_check_result)
  values (auth.uid(), current_employee.id, p_punch_type, p_photo_path, p_latitude, p_longitude, p_accuracy, p_ip_address, p_device_info, nearest_location.id, round(nearest_distance, 2), 'allowed')
  returning id into created_record_id;
  return created_record_id;
end;
$$;

revoke all on function public.recover_my_break_clock_out() from public, anon;
grant execute on function public.recover_my_break_clock_out() to authenticated;

-- Replacing only the clock-out predicates keeps outgoing behavior intact while
-- ensuring an auditable recovered punch is never treated as a real clock-out.
create or replace function public.start_outgoing_event(p_request_id uuid, p_photo_path text, p_latitude numeric, p_longitude numeric, p_accuracy numeric, p_idempotency_key uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare request_row public.outgoing_requests; employee_row public.employees; event_row public.outgoing_events; actor_name text; location_result record; malaysia_today date;
begin
  if auth.uid() is null or not public.current_user_is_active_employee() or p_idempotency_key is null then raise exception 'No permission or idempotency key to start outgoing.'; end if;
  select * into employee_row from public.employees where profile_id = auth.uid() and deleted_at is null and status in ('active', 'probation') limit 1;
  if employee_row.id is null then raise exception 'Current account is not an active employee.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(employee_row.id::text, 1)); select * into request_row from public.outgoing_requests where id = p_request_id for update;
  if request_row.id is null or request_row.profile_id <> auth.uid() then raise exception 'Outgoing request not found.'; end if;
  select * into event_row from public.outgoing_events where request_id = p_request_id for update;
  if event_row.id is not null then if event_row.start_idempotency_key = p_idempotency_key then return event_row.id; end if; raise exception 'This outgoing request has already been started.'; end if;
  malaysia_today := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  if request_row.status <> 'approved' or request_row.outgoing_date <> malaysia_today then raise exception 'Only an approved request for today can be started.'; end if;
  if exists (select 1 from public.attendance_records ar where ar.employee_id = employee_row.id and (ar.punched_at at time zone 'Asia/Kuala_Lumpur')::date = malaysia_today and ar.punch_type = 'clock_out' and not exists (select 1 from public.attendance_clock_out_recoveries r where r.attendance_record_id = ar.id)) then raise exception 'Outgoing cannot start after clock-out.'; end if;
  if not exists (select 1 from public.attendance_records ar where ar.employee_id = employee_row.id and (ar.punched_at at time zone 'Asia/Kuala_Lumpur')::date = malaysia_today and ar.punch_type = 'clock_in') then raise exception 'Clock-in is required before outgoing.'; end if;
  if (select ar.punch_type from public.attendance_records ar where ar.employee_id = employee_row.id and (ar.punched_at at time zone 'Asia/Kuala_Lumpur')::date = malaysia_today and ar.punch_type in ('break_start', 'break_end') order by ar.punched_at desc, ar.id desc limit 1) = 'break_start' then raise exception 'Outgoing cannot start while on break.'; end if;
  if exists (select 1 from public.outgoing_events e where e.employee_id = employee_row.id and e.status = 'in_progress') then raise exception 'Another outgoing event is already in progress.'; end if;
  perform public.outgoing_verify_photo_path(p_request_id, p_photo_path); select * into location_result from public.outgoing_find_verified_location(request_row.region_id, p_latitude, p_longitude); actor_name := coalesce(public.outgoing_current_actor_name(), auth.uid()::text);
  insert into public.outgoing_events(request_id, profile_id, employee_id, region_id, started_at, start_photo_path, start_latitude, start_longitude, start_accuracy, start_attendance_location_id, start_distance_meters, start_idempotency_key) values (request_row.id, auth.uid(), employee_row.id, request_row.region_id, now(), p_photo_path, p_latitude, p_longitude, p_accuracy, location_result.attendance_location_id, location_result.distance_meters, p_idempotency_key) returning * into event_row;
  insert into public.outgoing_event_audit_history(event_id, request_id, action, actor_profile_id, actor_name) values (event_row.id, request_row.id, 'started', auth.uid(), actor_name); return event_row.id;
end;
$$;

create or replace function public.finish_outgoing_event(p_request_id uuid, p_photo_path text, p_latitude numeric, p_longitude numeric, p_accuracy numeric, p_idempotency_key uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare request_row public.outgoing_requests; event_row public.outgoing_events; actor_name text; location_result record; malaysia_today date;
begin
  if auth.uid() is null or not public.current_user_is_active_employee() or p_idempotency_key is null then raise exception 'No permission or idempotency key to finish outgoing.'; end if;
  select * into request_row from public.outgoing_requests where id = p_request_id for update; if request_row.id is null or request_row.profile_id <> auth.uid() then raise exception 'Outgoing request not found.'; end if;
  select * into event_row from public.outgoing_events where request_id = p_request_id for update; if event_row.id is null then raise exception 'Outgoing event has not started.'; end if;
  if event_row.status = 'completed' and event_row.end_idempotency_key = p_idempotency_key then return event_row.id; end if; if event_row.status <> 'in_progress' then raise exception 'This outgoing event cannot be finished.'; end if;
  malaysia_today := (now() at time zone 'Asia/Kuala_Lumpur')::date; if request_row.outgoing_date <> malaysia_today then raise exception 'Outgoing must be finished on its Malaysia application date.'; end if;
  if exists (select 1 from public.attendance_records ar where ar.employee_id = event_row.employee_id and ar.punch_type = 'clock_out' and ar.punched_at >= event_row.started_at and not exists (select 1 from public.attendance_clock_out_recoveries r where r.attendance_record_id = ar.id)) then raise exception 'Outgoing cannot be finished after clock-out; reconcile the outgoing exception instead.'; end if;
  perform public.outgoing_verify_photo_path(p_request_id, p_photo_path); select * into location_result from public.outgoing_find_verified_location(event_row.region_id, p_latitude, p_longitude); actor_name := coalesce(public.outgoing_current_actor_name(), auth.uid()::text);
  update public.outgoing_events set status = 'completed', ended_at = now(), end_photo_path = p_photo_path, end_latitude = p_latitude, end_longitude = p_longitude, end_accuracy = p_accuracy, end_attendance_location_id = location_result.attendance_location_id, end_distance_meters = location_result.distance_meters, end_idempotency_key = p_idempotency_key, updated_at = now() where id = event_row.id;
  insert into public.outgoing_event_audit_history(event_id, request_id, action, actor_profile_id, actor_name) values (event_row.id, request_row.id, 'completed', auth.uid(), actor_name); return event_row.id;
end;
$$;

create or replace function public.reconcile_outgoing_exceptions(p_employee_id uuid default null)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare caller_employee public.employees; target_employee public.employees; changed_count integer;
begin
  if auth.uid() is null or not public.current_user_is_active_employee() then raise exception 'No active employee session.'; end if;
  select * into caller_employee from public.employees where profile_id = auth.uid() and deleted_at is null and status in ('active', 'probation') limit 1; if caller_employee.id is null then raise exception 'Current account is not an active employee.'; end if;
  select * into target_employee from public.employees where id = coalesce(p_employee_id, caller_employee.id) and deleted_at is null limit 1; if target_employee.id is null then raise exception 'Target employee not found.'; end if;
  if target_employee.id <> caller_employee.id and (not public.current_user_has_permission('outgoing-management', 'view') or not public.current_user_can_access_region(target_employee.region_id)) then raise exception 'No permission to reconcile this employee.'; end if;
  with matching_clock_outs as (
    select source_event.id as event_id, source_event.request_id, clock_out.punched_at, clock_out.id as attendance_record_id from public.outgoing_events source_event join public.outgoing_requests request_row on request_row.id = source_event.request_id join lateral (
      select ar.punched_at, ar.id from public.attendance_records ar where ar.employee_id = target_employee.id and ar.punch_type = 'clock_out' and (ar.punched_at at time zone 'Asia/Kuala_Lumpur')::date = request_row.outgoing_date and ar.punched_at >= source_event.started_at and (source_event.status = 'in_progress' or ar.punched_at <= source_event.ended_at) and not exists (select 1 from public.attendance_clock_out_recoveries r where r.attendance_record_id = ar.id) order by ar.punched_at desc, ar.id desc limit 1
    ) clock_out on true where source_event.employee_id = target_employee.id and source_event.status in ('in_progress', 'completed')
  ), changed as (
    update public.outgoing_events target_event set status = 'exception', exception_reason = 'Employee clocked out before ending outgoing.', exception_detected_at = matching_clock_outs.punched_at, updated_at = now() from matching_clock_outs where target_event.id = matching_clock_outs.event_id and target_event.status in ('in_progress', 'completed') returning target_event.id, target_event.request_id, matching_clock_outs.attendance_record_id
  ), audit as (
    insert into public.outgoing_event_audit_history(event_id, request_id, action, actor_name, note) select id, request_id, 'exception_detected', 'System outgoing reconciliation', 'Attendance clock-out record: ' || attendance_record_id::text from changed
  ) select count(*)::integer into changed_count from changed;
  return coalesce(changed_count, 0);
end;
$$;

commit;
