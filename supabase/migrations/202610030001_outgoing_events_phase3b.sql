begin;

-- Phase 3B is deliberately separate from attendance_records. It records the
-- real-world outgoing lifecycle; the existing attendance RPC remains untouched.
create table if not exists public.outgoing_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.outgoing_requests(id) on delete restrict,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  region_id uuid not null references public.regions(id) on delete restrict,
  status text not null default 'in_progress',
  started_at timestamptz not null,
  start_photo_path text not null,
  start_latitude numeric not null,
  start_longitude numeric not null,
  start_accuracy numeric,
  start_attendance_location_id uuid not null references public.attendance_locations(id) on delete restrict,
  start_distance_meters numeric(10, 2) not null,
  start_idempotency_key uuid not null unique,
  ended_at timestamptz,
  end_photo_path text,
  end_latitude numeric,
  end_longitude numeric,
  end_accuracy numeric,
  end_attendance_location_id uuid references public.attendance_locations(id) on delete restrict,
  end_distance_meters numeric(10, 2),
  end_idempotency_key uuid unique,
  exception_reason text,
  exception_detected_at timestamptz,
  exception_handled_by uuid references public.profiles(id) on delete set null,
  exception_handled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outgoing_events_status_check check (status in ('in_progress', 'completed', 'exception')),
  constraint outgoing_events_start_distance_check check (start_distance_meters >= 0),
  constraint outgoing_events_end_distance_check check (end_distance_meters is null or end_distance_meters >= 0),
  constraint outgoing_events_completed_check check (
    (status <> 'completed') or (
      ended_at is not null and end_photo_path is not null and end_latitude is not null and end_longitude is not null
      and end_attendance_location_id is not null and end_distance_meters is not null and end_idempotency_key is not null
    )
  ),
  constraint outgoing_events_exception_check check (
    (status <> 'exception') or (exception_reason is not null and exception_detected_at is not null)
  ),
  constraint outgoing_events_exception_handled_check check (
    (exception_handled_at is null and exception_handled_by is null)
    or (status = 'exception' and exception_handled_at is not null and exception_handled_by is not null)
  )
);

create table if not exists public.outgoing_event_audit_history (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.outgoing_events(id) on delete restrict,
  request_id uuid not null references public.outgoing_requests(id) on delete restrict,
  action text not null,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  actor_name text not null,
  note text,
  created_at timestamptz not null default now(),
  constraint outgoing_event_audit_action_check check (action in ('started', 'completed', 'exception_detected', 'exception_handled'))
);

create index if not exists outgoing_events_employee_status_idx on public.outgoing_events(employee_id, status);
create index if not exists outgoing_events_region_status_started_idx on public.outgoing_events(region_id, status, started_at desc);
create index if not exists outgoing_event_audit_history_event_created_idx on public.outgoing_event_audit_history(event_id, created_at desc);

drop trigger if exists trg_outgoing_events_updated_at on public.outgoing_events;
create trigger trg_outgoing_events_updated_at before update on public.outgoing_events for each row execute function public.set_updated_at();

-- The bucket is private. Its object paths are always: profile_id/request_id/file.jpg.
insert into storage.buckets (id, name, public)
values ('outgoing-photos', 'outgoing-photos', false)
on conflict (id) do update set public = false;

alter table public.outgoing_events enable row level security;
alter table public.outgoing_event_audit_history enable row level security;

create policy "Active employees can read own outgoing events" on public.outgoing_events for select to authenticated using (
  profile_id = auth.uid()
  and public.current_user_is_active_employee()
  and public.current_user_has_permission('outgoing-application', 'view')
);
create policy "Outgoing managers can read scoped events" on public.outgoing_events for select to authenticated using (
  public.current_user_has_permission('outgoing-management', 'view')
  and public.current_user_can_access_region(region_id)
);
create policy "Outgoing approvers can read scoped events" on public.outgoing_events for select to authenticated using (
  public.current_user_has_permission('outgoing-approval', 'view')
  and public.current_user_can_access_region(region_id)
);
create policy "Outgoing event viewers can read scoped audit history" on public.outgoing_event_audit_history for select to authenticated using (
  exists (
    select 1 from public.outgoing_events e where e.id = event_id and (
      (e.profile_id = auth.uid() and public.current_user_is_active_employee() and public.current_user_has_permission('outgoing-application', 'view'))
      or (public.current_user_has_permission('outgoing-management', 'view') and public.current_user_can_access_region(e.region_id))
      or (public.current_user_has_permission('outgoing-approval', 'view') and public.current_user_can_access_region(e.region_id))
    )
  )
);

-- Direct inserts and updates are intentionally denied: all lifecycle writes use
-- locked RPCs below. Storage upload is separate because a browser uploads the
-- captured image before the corresponding RPC verifies and records its path.
create policy "Active employees can upload own outgoing photos" on storage.objects for insert to authenticated with check (
  bucket_id = 'outgoing-photos'
  and public.current_user_is_active_employee()
  and (storage.foldername(name))[1] = auth.uid()::text
  and exists (
    select 1 from public.outgoing_requests r
    where r.id::text = (storage.foldername(name))[2]
      and r.profile_id = auth.uid()
      and r.status = 'approved'
  )
);
create policy "Active employees can read own outgoing photos" on storage.objects for select to authenticated using (
  bucket_id = 'outgoing-photos'
  and public.current_user_is_active_employee()
  and (storage.foldername(name))[1] = auth.uid()::text
);
create policy "Authorized users can read scoped outgoing photos" on storage.objects for select to authenticated using (
  bucket_id = 'outgoing-photos'
  and public.current_user_is_active_employee()
  and public.current_user_has_explicit_permission('outgoing-photos', 'view')
  and (
    public.current_user_is_super_admin()
    or exists (
      select 1 from public.outgoing_events e
      where (e.start_photo_path = storage.objects.name or e.end_photo_path = storage.objects.name)
        and public.current_user_can_access_region(e.region_id)
        and (
          public.current_user_has_permission('outgoing-management', 'view')
          or public.current_user_has_permission('outgoing-approval', 'view')
        )
    )
  )
);

create or replace function public.outgoing_find_verified_location(
  p_region_id uuid,
  p_latitude numeric,
  p_longitude numeric
)
returns table(attendance_location_id uuid, distance_meters numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare location_row public.attendance_locations; computed_distance numeric;
begin
  if p_latitude is null or p_longitude is null then raise exception 'Location is required.'; end if;
  select al.* into location_row from public.attendance_locations al
  where al.region_id = p_region_id and al.is_active = true
  order by public.calculate_distance_meters(p_latitude, p_longitude, al.latitude, al.longitude) asc limit 1;
  if location_row.id is null then raise exception 'No active attendance location is configured for this region.'; end if;
  computed_distance := public.calculate_distance_meters(p_latitude, p_longitude, location_row.latitude, location_row.longitude);
  if computed_distance > location_row.radius_meters then raise exception 'You are outside the allowed attendance location range.'; end if;
  return query select location_row.id, round(computed_distance, 2);
end;
$$;

create or replace function public.outgoing_verify_photo_path(p_request_id uuid, p_photo_path text)
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_photo_path is null
    or array_length(string_to_array(p_photo_path, '/'), 1) <> 3
    or split_part(p_photo_path, '/', 1) <> auth.uid()::text
    or split_part(p_photo_path, '/', 2) <> p_request_id::text
    or nullif(btrim(split_part(p_photo_path, '/', 3)), '') is null then
    raise exception 'Outgoing photo path is invalid.';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'outgoing-photos' and name = p_photo_path) then
    raise exception 'Outgoing photo was not uploaded.';
  end if;
end;
$$;

-- Phase 3A creates cancellation before outgoing_events exists. Replace it only
-- after this table exists, so requests with a successful start cannot be
-- cancelled. The request-row lock serializes cancellation with start.
create or replace function public.cancel_outgoing_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare request_row public.outgoing_requests; actor_name text;
begin
  select * into request_row from public.outgoing_requests where id = p_request_id for update;
  if request_row.id is null or request_row.profile_id <> auth.uid() then raise exception 'Outgoing request not found.'; end if;
  if not public.current_user_has_permission('outgoing-application', 'use') or request_row.status not in ('pending', 'approved') then raise exception 'Only pending or approved outgoing requests that have not started can be cancelled.'; end if;
  if exists (select 1 from public.outgoing_events e where e.request_id = request_row.id) then
    raise exception 'An outgoing request with a started event cannot be cancelled.';
  end if;
  actor_name := coalesce(public.outgoing_current_actor_name(), auth.uid()::text);
  update public.outgoing_requests set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(), updated_at = now() where id = request_row.id;
  insert into public.outgoing_request_review_history(request_id, action, actor_profile_id, actor_name, previous_status, next_status) values (request_row.id, 'cancelled', auth.uid(), actor_name, request_row.status, 'cancelled');
end;
$$;

create or replace function public.start_outgoing_event(
  p_request_id uuid, p_photo_path text, p_latitude numeric, p_longitude numeric,
  p_accuracy numeric, p_idempotency_key uuid
)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare request_row public.outgoing_requests; employee_row public.employees; event_row public.outgoing_events; actor_name text; location_result record; malaysia_today date;
begin
  if auth.uid() is null or not public.current_user_is_active_employee() or p_idempotency_key is null then raise exception 'No permission or idempotency key to start outgoing.'; end if;
  select * into employee_row from public.employees where profile_id = auth.uid() and deleted_at is null and status in ('active', 'probation') limit 1;
  if employee_row.id is null then raise exception 'Current account is not an active employee.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(employee_row.id::text, 1));
  select * into request_row from public.outgoing_requests where id = p_request_id for update;
  if request_row.id is null or request_row.profile_id <> auth.uid() then raise exception 'Outgoing request not found.'; end if;
  select * into event_row from public.outgoing_events where request_id = p_request_id for update;
  if event_row.id is not null then
    if event_row.start_idempotency_key = p_idempotency_key then return event_row.id; end if;
    raise exception 'This outgoing request has already been started.';
  end if;
  malaysia_today := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  if request_row.status <> 'approved' or request_row.outgoing_date <> malaysia_today then raise exception 'Only an approved request for today can be started.'; end if;
  if exists (select 1 from public.attendance_records ar where ar.employee_id = employee_row.id and (ar.punched_at at time zone 'Asia/Kuala_Lumpur')::date = malaysia_today and ar.punch_type = 'clock_out') then raise exception 'Outgoing cannot start after clock-out.'; end if;
  if not exists (select 1 from public.attendance_records ar where ar.employee_id = employee_row.id and (ar.punched_at at time zone 'Asia/Kuala_Lumpur')::date = malaysia_today and ar.punch_type = 'clock_in') then raise exception 'Clock-in is required before outgoing.'; end if;
  if (select ar.punch_type from public.attendance_records ar where ar.employee_id = employee_row.id and (ar.punched_at at time zone 'Asia/Kuala_Lumpur')::date = malaysia_today and ar.punch_type in ('break_start', 'break_end') order by ar.punched_at desc limit 1) = 'break_start' then raise exception 'Outgoing cannot start while on break.'; end if;
  if exists (select 1 from public.outgoing_events e where e.employee_id = employee_row.id and e.status = 'in_progress') then raise exception 'Another outgoing event is already in progress.'; end if;
  perform public.outgoing_verify_photo_path(p_request_id, p_photo_path);
  select * into location_result from public.outgoing_find_verified_location(request_row.region_id, p_latitude, p_longitude);
  actor_name := coalesce(public.outgoing_current_actor_name(), auth.uid()::text);
  insert into public.outgoing_events(request_id, profile_id, employee_id, region_id, started_at, start_photo_path, start_latitude, start_longitude, start_accuracy, start_attendance_location_id, start_distance_meters, start_idempotency_key)
  values (request_row.id, auth.uid(), employee_row.id, request_row.region_id, now(), p_photo_path, p_latitude, p_longitude, p_accuracy, location_result.attendance_location_id, location_result.distance_meters, p_idempotency_key)
  returning * into event_row;
  insert into public.outgoing_event_audit_history(event_id, request_id, action, actor_profile_id, actor_name) values (event_row.id, request_row.id, 'started', auth.uid(), actor_name);
  return event_row.id;
end;
$$;

create or replace function public.finish_outgoing_event(
  p_request_id uuid, p_photo_path text, p_latitude numeric, p_longitude numeric,
  p_accuracy numeric, p_idempotency_key uuid
)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare request_row public.outgoing_requests; event_row public.outgoing_events; actor_name text; location_result record; malaysia_today date;
begin
  if auth.uid() is null or not public.current_user_is_active_employee() or p_idempotency_key is null then raise exception 'No permission or idempotency key to finish outgoing.'; end if;
  select * into request_row from public.outgoing_requests where id = p_request_id for update;
  if request_row.id is null or request_row.profile_id <> auth.uid() then raise exception 'Outgoing request not found.'; end if;
  select * into event_row from public.outgoing_events where request_id = p_request_id for update;
  if event_row.id is null then raise exception 'Outgoing event has not started.'; end if;
  if event_row.status = 'completed' and event_row.end_idempotency_key = p_idempotency_key then return event_row.id; end if;
  if event_row.status <> 'in_progress' then raise exception 'This outgoing event cannot be finished.'; end if;
  malaysia_today := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  if request_row.outgoing_date <> malaysia_today then raise exception 'Outgoing must be finished on its Malaysia application date.'; end if;
  if exists (
    select 1 from public.attendance_records ar
    where ar.employee_id = event_row.employee_id
      and ar.punch_type = 'clock_out'
      and ar.punched_at >= event_row.started_at
  ) then
    raise exception 'Outgoing cannot be finished after clock-out; reconcile the outgoing exception instead.';
  end if;
  -- The existing clock-out transaction is intentionally not locked or changed.
  -- A clock-out committed after this check can still win the final race; the
  -- independent reconciliation RPC must run after successful clock-out and on
  -- subsequent outgoing reads to mark that event as an exception.
  perform public.outgoing_verify_photo_path(p_request_id, p_photo_path);
  select * into location_result from public.outgoing_find_verified_location(event_row.region_id, p_latitude, p_longitude);
  actor_name := coalesce(public.outgoing_current_actor_name(), auth.uid()::text);
  update public.outgoing_events set status = 'completed', ended_at = now(), end_photo_path = p_photo_path, end_latitude = p_latitude, end_longitude = p_longitude, end_accuracy = p_accuracy, end_attendance_location_id = location_result.attendance_location_id, end_distance_meters = location_result.distance_meters, end_idempotency_key = p_idempotency_key, updated_at = now() where id = event_row.id;
  insert into public.outgoing_event_audit_history(event_id, request_id, action, actor_profile_id, actor_name) values (event_row.id, request_row.id, 'completed', auth.uid(), actor_name);
  return event_row.id;
end;
$$;

-- Explicit reconciliation reads real clock-out records without adding a trigger
-- to attendance_records or changing the existing clock-out transaction.
create or replace function public.reconcile_outgoing_exceptions(p_employee_id uuid default null)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare caller_employee public.employees; target_employee public.employees; changed_count integer;
begin
  if auth.uid() is null or not public.current_user_is_active_employee() then raise exception 'No active employee session.'; end if;
  select * into caller_employee from public.employees where profile_id = auth.uid() and deleted_at is null and status in ('active', 'probation') limit 1;
  if caller_employee.id is null then raise exception 'Current account is not an active employee.'; end if;
  select * into target_employee from public.employees where id = coalesce(p_employee_id, caller_employee.id) and deleted_at is null limit 1;
  if target_employee.id is null then raise exception 'Target employee not found.'; end if;
  if target_employee.id <> caller_employee.id and (not public.current_user_has_permission('outgoing-management', 'view') or not public.current_user_can_access_region(target_employee.region_id)) then raise exception 'No permission to reconcile this employee.'; end if;
  -- An UPDATE target alias cannot be referenced from a FROM/JOIN LATERAL item.
  -- Compute candidate clock-outs first, where source_event is an ordinary FROM
  -- alias, then update the matching target row exactly once.
  with matching_clock_outs as (
    select source_event.id as event_id, source_event.request_id, clock_out.punched_at, clock_out.id as attendance_record_id
    from public.outgoing_events source_event
    join public.outgoing_requests request_row on request_row.id = source_event.request_id
    join lateral (
      select ar.punched_at, ar.id from public.attendance_records ar
      where ar.employee_id = target_employee.id and ar.punch_type = 'clock_out'
        and (ar.punched_at at time zone 'Asia/Kuala_Lumpur')::date = request_row.outgoing_date
        and ar.punched_at >= source_event.started_at
        and (source_event.status = 'in_progress' or ar.punched_at <= source_event.ended_at)
      order by ar.punched_at desc limit 1
    ) clock_out on true
    where source_event.employee_id = target_employee.id and source_event.status in ('in_progress', 'completed')
  ), changed as (
    update public.outgoing_events target_event set status = 'exception', exception_reason = 'Employee clocked out before ending outgoing.', exception_detected_at = matching_clock_outs.punched_at, updated_at = now()
    from matching_clock_outs
    where target_event.id = matching_clock_outs.event_id and target_event.status in ('in_progress', 'completed')
    returning target_event.id, target_event.request_id, matching_clock_outs.attendance_record_id
  ), audit as (
    insert into public.outgoing_event_audit_history(event_id, request_id, action, actor_name, note)
    select id, request_id, 'exception_detected', 'System outgoing reconciliation', 'Attendance clock-out record: ' || attendance_record_id::text from changed
  ) select count(*)::integer into changed_count from changed;
  return coalesce(changed_count, 0);
end;
$$;

create or replace function public.handle_outgoing_exception(p_event_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare event_row public.outgoing_events; actor_name text;
begin
  select * into event_row from public.outgoing_events where id = p_event_id for update;
  if event_row.id is null then raise exception 'Outgoing event not found.'; end if;
  if not public.current_user_has_permission('outgoing-exception-handling', 'use') or not public.current_user_can_access_region(event_row.region_id) then raise exception 'No permission to handle this outgoing exception.'; end if;
  if event_row.status <> 'exception' then raise exception 'Only an outgoing exception can be handled.'; end if;
  if event_row.exception_handled_at is not null then return; end if;
  actor_name := coalesce(public.outgoing_current_actor_name(), auth.uid()::text);
  update public.outgoing_events set exception_handled_by = auth.uid(), exception_handled_at = now(), updated_at = now() where id = event_row.id;
  insert into public.outgoing_event_audit_history(event_id, request_id, action, actor_profile_id, actor_name) values (event_row.id, event_row.request_id, 'exception_handled', auth.uid(), actor_name);
end;
$$;

revoke all on function public.outgoing_find_verified_location(uuid, numeric, numeric) from public, anon, authenticated;
revoke all on function public.outgoing_verify_photo_path(uuid, text) from public, anon, authenticated;
revoke all on function public.reconcile_outgoing_exceptions(uuid) from public, anon;
revoke all on function public.start_outgoing_event(uuid, text, numeric, numeric, numeric, uuid) from public, anon;
revoke all on function public.finish_outgoing_event(uuid, text, numeric, numeric, numeric, uuid) from public, anon;
revoke all on function public.handle_outgoing_exception(uuid) from public, anon;
grant execute on function public.start_outgoing_event(uuid, text, numeric, numeric, numeric, uuid) to authenticated;
grant execute on function public.finish_outgoing_event(uuid, text, numeric, numeric, numeric, uuid) to authenticated;
grant execute on function public.reconcile_outgoing_exceptions(uuid) to authenticated;
grant execute on function public.handle_outgoing_exception(uuid) to authenticated;

commit;
