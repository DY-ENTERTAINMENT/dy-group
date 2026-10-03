begin;

-- Phase 3A is intentionally isolated from attendance_records and its RPCs.
-- Approval eligibility is the existing permission runtime plus region access.

create table if not exists public.outgoing_requests (
  id uuid primary key default gen_random_uuid(), profile_id uuid not null references public.profiles(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict, region_id uuid not null references public.regions(id) on delete restrict,
  outgoing_date date not null, planned_start_time time not null, planned_return_time time not null, outgoing_type text not null,
  location text not null, reason text not null, related_contact text, remarks text, status text not null default 'pending',
  reviewed_by uuid references public.profiles(id) on delete set null, reviewed_by_name text, reviewed_at timestamptz, review_note text,
  cancelled_by uuid references public.profiles(id) on delete set null, cancelled_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint outgoing_requests_time_range_check check (planned_return_time > planned_start_time),
  constraint outgoing_requests_type_check check (outgoing_type in ('streamer_visit', 'client_visit', 'company_business', 'procurement', 'event', 'other')),
  constraint outgoing_requests_text_check check (length(btrim(location)) > 0 and length(btrim(reason)) > 0),
  constraint outgoing_requests_status_check check (status in ('pending', 'approved', 'rejected', 'cancelled', 'expired')),
  constraint outgoing_requests_review_state_check check (
    (status = 'pending' and reviewed_by is null and reviewed_by_name is null and reviewed_at is null and review_note is null and cancelled_at is null)
    or (status = 'approved' and reviewed_by is not null and reviewed_by_name is not null and reviewed_at is not null and review_note is null and cancelled_at is null)
    or (status = 'rejected' and reviewed_by is not null and reviewed_by_name is not null and reviewed_at is not null and nullif(btrim(coalesce(review_note, '')), '') is not null and cancelled_at is null)
    or (status = 'cancelled' and cancelled_by is not null and cancelled_at is not null)
    or (status = 'expired' and cancelled_at is null)
  )
);

create table if not exists public.outgoing_request_review_history (
  id uuid primary key default gen_random_uuid(), request_id uuid not null references public.outgoing_requests(id) on delete restrict,
  action text not null, actor_profile_id uuid references public.profiles(id) on delete set null, actor_name text not null,
  previous_status text, next_status text, note text, created_at timestamptz not null default now(),
  constraint outgoing_request_review_history_action_check check (action in ('submitted', 'approved', 'rejected', 'cancelled')),
  constraint outgoing_request_review_history_rejection_note_check check (action <> 'rejected' or nullif(btrim(coalesce(note, '')), '') is not null)
);

create index if not exists outgoing_requests_employee_date_idx on public.outgoing_requests(employee_id, outgoing_date);
create index if not exists outgoing_requests_region_status_date_idx on public.outgoing_requests(region_id, status, outgoing_date);
create index if not exists outgoing_request_review_history_request_created_idx on public.outgoing_request_review_history(request_id, created_at desc);

drop trigger if exists trg_outgoing_requests_updated_at on public.outgoing_requests;
create trigger trg_outgoing_requests_updated_at before update on public.outgoing_requests for each row execute function public.set_updated_at();

insert into public.permission_items (permission_key, parent_key, name, sort_order, is_reserved) values
  ('outgoing-application', 'hr', '外出申请', 48, false), ('outgoing-approval', 'hr', '外出审批', 49, false),
  ('outgoing-management', 'hr', '外出管理', 50, false), ('outgoing-exception-handling', 'hr', '外出异常处理', 51, false),
  ('outgoing-photos', 'hr', '查看外出照片', 52, false), ('outgoing-settings', 'hr', '外出设置', 53, false)
on conflict (permission_key) do update set parent_key = excluded.parent_key, name = excluded.name, sort_order = excluded.sort_order, is_reserved = excluded.is_reserved, is_active = true, updated_at = now();

alter table public.outgoing_requests enable row level security;
alter table public.outgoing_request_review_history enable row level security;
create policy "Outgoing users can read own or scoped requests" on public.outgoing_requests for select to authenticated using (
  (profile_id = auth.uid() and public.current_user_is_active_employee() and public.current_user_has_permission('outgoing-application', 'view'))
  or (public.current_user_has_permission('outgoing-management', 'view') and public.current_user_can_access_region(region_id))
  or (public.current_user_has_permission('outgoing-approval', 'view') and public.current_user_can_access_region(region_id))
);
create policy "Outgoing users can read scoped review history" on public.outgoing_request_review_history for select to authenticated using (
  exists (select 1 from public.outgoing_requests r where r.id = request_id and (
    (r.profile_id = auth.uid() and public.current_user_is_active_employee() and public.current_user_has_permission('outgoing-application', 'view'))
    or (public.current_user_has_permission('outgoing-management', 'view') and public.current_user_can_access_region(r.region_id))
    or (public.current_user_has_permission('outgoing-approval', 'view') and public.current_user_can_access_region(r.region_id))
  ))
);

create or replace function public.outgoing_current_actor_name()
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(nullif(btrim(e.nickname), ''), nullif(btrim(e.full_name), ''), nullif(btrim(p.nickname), ''), nullif(btrim(p.full_name), ''), p.email, auth.uid()::text)
  from public.profiles p left join public.employees e on e.profile_id = p.id and e.deleted_at is null where p.id = auth.uid() limit 1
$$;

create or replace function public.create_outgoing_request(p_outgoing_date date, p_planned_start_time time, p_planned_return_time time, p_outgoing_type text, p_location text, p_reason text, p_related_contact text default null, p_remarks text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare current_employee public.employees; request_id uuid; actor_name text;
begin
  if auth.uid() is null or not public.current_user_has_permission('outgoing-application', 'use') then raise exception 'No permission to create outgoing requests.'; end if;
  select * into current_employee from public.employees where profile_id = auth.uid() and deleted_at is null and status in ('active', 'probation') limit 1;
  if current_employee.id is null or current_employee.region_id is null then raise exception 'Current account is not an active employee with an assigned region.'; end if;
  if p_outgoing_date is null or p_outgoing_date < (now() at time zone 'Asia/Kuala_Lumpur')::date then raise exception 'Outgoing applications cannot use a past Malaysia date.'; end if;
  if p_planned_start_time is null or p_planned_return_time is null or p_planned_return_time <= p_planned_start_time then raise exception 'Planned return time must be after planned start time on the same day.'; end if;
  if p_outgoing_type not in ('streamer_visit', 'client_visit', 'company_business', 'procurement', 'event', 'other') then raise exception 'Invalid outgoing type.'; end if;
  if nullif(btrim(coalesce(p_location, '')), '') is null or nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'Location and reason are required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(current_employee.id::text, 0));
  if exists (select 1 from public.outgoing_requests r where r.employee_id = current_employee.id and r.outgoing_date = p_outgoing_date and r.status in ('pending', 'approved') and not (p_planned_return_time <= r.planned_start_time or p_planned_start_time >= r.planned_return_time)) then raise exception 'This outgoing application overlaps another active application.'; end if;
  actor_name := coalesce(public.outgoing_current_actor_name(), auth.uid()::text);
  insert into public.outgoing_requests(profile_id, employee_id, region_id, outgoing_date, planned_start_time, planned_return_time, outgoing_type, location, reason, related_contact, remarks)
  values (auth.uid(), current_employee.id, current_employee.region_id, p_outgoing_date, p_planned_start_time, p_planned_return_time, p_outgoing_type, btrim(p_location), btrim(p_reason), nullif(btrim(coalesce(p_related_contact, '')), ''), nullif(btrim(coalesce(p_remarks, '')), '')) returning id into request_id;
  insert into public.outgoing_request_review_history(request_id, action, actor_profile_id, actor_name, next_status) values (request_id, 'submitted', auth.uid(), actor_name, 'pending');
  return request_id;
end;
$$;

create or replace function public.cancel_outgoing_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare request_row public.outgoing_requests; actor_name text;
begin
  select * into request_row from public.outgoing_requests where id = p_request_id for update;
  if request_row.id is null or request_row.profile_id <> auth.uid() then raise exception 'Outgoing request not found.'; end if;
  if not public.current_user_has_permission('outgoing-application', 'use') or request_row.status not in ('pending', 'approved') then raise exception 'Only pending or approved outgoing requests that have not started can be cancelled.'; end if;
  actor_name := coalesce(public.outgoing_current_actor_name(), auth.uid()::text);
  update public.outgoing_requests set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(), updated_at = now() where id = request_row.id;
  insert into public.outgoing_request_review_history(request_id, action, actor_profile_id, actor_name, previous_status, next_status) values (request_row.id, 'cancelled', auth.uid(), actor_name, request_row.status, 'cancelled');
end;
$$;

create or replace function public.review_outgoing_request(p_request_id uuid, p_decision text, p_note text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare request_row public.outgoing_requests; actor_name text; next_status text;
begin
  select * into request_row from public.outgoing_requests where id = p_request_id for update;
  if request_row.id is null then raise exception 'Outgoing request not found.'; end if;
  if not public.current_user_has_permission('outgoing-approval', 'use') or not public.current_user_can_access_region(request_row.region_id) then raise exception 'No permission to review this outgoing request.'; end if;
  if request_row.profile_id = auth.uid() then raise exception 'An applicant cannot review their own outgoing request.'; end if;
  if request_row.status <> 'pending' then raise exception 'This outgoing request already has a final result.'; end if;
  next_status := lower(nullif(btrim(coalesce(p_decision, '')), ''));
  if next_status not in ('approved', 'rejected') then raise exception 'Invalid review decision.'; end if;
  if next_status = 'rejected' and nullif(btrim(coalesce(p_note, '')), '') is null then raise exception 'A rejection reason is required.'; end if;
  actor_name := coalesce(public.outgoing_current_actor_name(), auth.uid()::text);
  update public.outgoing_requests set status = next_status, reviewed_by = auth.uid(), reviewed_by_name = actor_name, reviewed_at = now(), review_note = case when next_status = 'rejected' then btrim(p_note) else null end, updated_at = now() where id = request_row.id;
  insert into public.outgoing_request_review_history(request_id, action, actor_profile_id, actor_name, previous_status, next_status, note) values (request_row.id, next_status, auth.uid(), actor_name, 'pending', next_status, case when next_status = 'rejected' then btrim(p_note) else null end);
end;
$$;

create or replace function public.get_my_outgoing_approval_pending_count()
returns integer language sql stable security definer set search_path = public, pg_temp as $$
  select case when not public.current_user_has_permission('outgoing-approval', 'view') then 0 else count(distinct r.id)::integer end
  from public.outgoing_requests r where r.status = 'pending' and public.current_user_can_access_region(r.region_id)
$$;

revoke all on function public.outgoing_current_actor_name() from public, anon, authenticated;
revoke all on function public.create_outgoing_request(date, time, time, text, text, text, text, text) from public, anon;
revoke all on function public.cancel_outgoing_request(uuid) from public, anon;
revoke all on function public.review_outgoing_request(uuid, text, text) from public, anon;
revoke all on function public.get_my_outgoing_approval_pending_count() from public, anon;
grant execute on function public.create_outgoing_request(date, time, time, text, text, text, text, text) to authenticated;
grant execute on function public.cancel_outgoing_request(uuid) to authenticated;
grant execute on function public.review_outgoing_request(uuid, text, text) to authenticated;
grant execute on function public.get_my_outgoing_approval_pending_count() to authenticated;

commit;
