-- Draft migration: work time adjustment requests.
-- This migration is intentionally additive. It does not modify attendance_records,
-- leave_requests, rest_days, public_holidays, or employees work-time columns.

begin;

insert into public.permission_items (permission_key, parent_key, name, sort_order, is_reserved)
values ('work-time-adjustment', null, 'Work Time Adjustment', 45, false)
on conflict (permission_key) do update
set
  parent_key = excluded.parent_key,
  name = excluded.name,
  sort_order = excluded.sort_order,
  is_reserved = excluded.is_reserved,
  is_active = true,
  updated_at = now();

insert into public.job_title_permission_templates (job_title_id, permission_key, can_view, can_use)
select jt.id, 'work-time-adjustment', true, true
from public.job_titles jt
where jt.name in ('HR ADMIN', 'DIRECTOR')
on conflict (job_title_id, permission_key) do update
set
  can_view = true,
  can_use = true,
  updated_at = now();

do $$
begin
  if not exists (select 1 from pg_type where typname = 'work_time_adjustment_detail_status') then
    create type public.work_time_adjustment_detail_status as enum (
      'pending',
      'approved',
      'rejected',
      'cancelled',
      'revoked'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'work_time_adjustment_audit_action') then
    create type public.work_time_adjustment_audit_action as enum (
      'request_created',
      'detail_updated',
      'detail_cancelled',
      'detail_approved',
      'detail_rejected',
      'detail_revoked'
    );
  end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'work-time-adjustment-attachments',
  'work-time-adjustment-attachments',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'application/pdf']::text[]
)
on conflict (id) do update
set
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'application/pdf']::text[];

create table if not exists public.work_time_adjustment_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  region_id uuid not null references public.regions(id) on delete restrict,
  requested_start_date date not null,
  requested_end_date date not null,
  original_start_work_time time not null,
  original_end_work_time time not null,
  requested_start_time time not null,
  requested_end_time time not null,
  reason text not null,
  attachment_path text,
  attachment_original_name text,
  attachment_content_type text,
  attachment_size_bytes integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_time_adjustment_requests_date_range_check
    check (requested_end_date >= requested_start_date),
  constraint work_time_adjustment_requests_reason_check
    check (length(trim(reason)) > 0),
  constraint work_time_adjustment_requests_start_quarter_check
    check (
      extract(second from requested_start_time) = 0
      and mod(extract(minute from requested_start_time)::integer, 15) = 0
    ),
  constraint work_time_adjustment_requests_duration_check
    check (requested_end_time = requested_start_time + interval '8 hours 30 minutes'),
  constraint work_time_adjustment_requests_no_overnight_check
    check (requested_end_time > requested_start_time),
  constraint work_time_adjustment_requests_attachment_check
    check (
      attachment_path is null
      or (
        attachment_content_type in ('image/jpeg', 'image/png', 'application/pdf')
        and attachment_size_bytes between 1 and 5242880
      )
    )
);

create table if not exists public.work_time_adjustment_request_dates (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.work_time_adjustment_requests(id) on delete restrict,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  region_id uuid not null references public.regions(id) on delete restrict,
  work_date date not null,
  original_start_work_time time not null,
  original_end_work_time time not null,
  adjusted_start_time time not null,
  adjusted_end_time time not null,
  status public.work_time_adjustment_detail_status not null default 'pending',
  review_note text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete set null,
  revoked_at timestamptz,
  revoke_note text,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_time_adjustment_dates_start_quarter_check
    check (
      extract(second from adjusted_start_time) = 0
      and mod(extract(minute from adjusted_start_time)::integer, 15) = 0
    ),
  constraint work_time_adjustment_dates_duration_check
    check (adjusted_end_time = adjusted_start_time + interval '8 hours 30 minutes'),
  constraint work_time_adjustment_dates_no_overnight_check
    check (adjusted_end_time > adjusted_start_time),
  constraint work_time_adjustment_dates_status_timestamp_check
    check (
      (status = 'pending' and reviewed_at is null and revoked_at is null and cancelled_at is null)
      or (status in ('approved', 'rejected') and reviewed_at is not null and cancelled_at is null and revoked_at is null)
      or (status = 'cancelled' and cancelled_at is not null and reviewed_at is null and revoked_at is null)
      or (status = 'revoked' and reviewed_at is not null and revoked_at is not null)
    )
);

create table if not exists public.work_time_adjustment_audit_history (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.work_time_adjustment_requests(id) on delete restrict,
  detail_id uuid references public.work_time_adjustment_request_dates(id) on delete restrict,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  actor_employee_id uuid references public.employees(id) on delete set null,
  action public.work_time_adjustment_audit_action not null,
  from_status public.work_time_adjustment_detail_status,
  to_status public.work_time_adjustment_detail_status,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists work_time_adjustment_requests_employee_created_idx
on public.work_time_adjustment_requests(employee_id, created_at desc);

create index if not exists work_time_adjustment_requests_region_created_idx
on public.work_time_adjustment_requests(region_id, created_at desc);

create index if not exists work_time_adjustment_dates_employee_date_idx
on public.work_time_adjustment_request_dates(employee_id, work_date, created_at desc);

create index if not exists work_time_adjustment_dates_effective_idx
on public.work_time_adjustment_request_dates(employee_id, work_date, reviewed_at desc, created_at desc)
where status = 'approved';

create index if not exists work_time_adjustment_dates_status_idx
on public.work_time_adjustment_request_dates(status);

create index if not exists work_time_adjustment_audit_request_idx
on public.work_time_adjustment_audit_history(request_id, created_at desc);

drop trigger if exists set_work_time_adjustment_requests_updated_at on public.work_time_adjustment_requests;
create trigger set_work_time_adjustment_requests_updated_at
before update on public.work_time_adjustment_requests
for each row execute function public.set_updated_at();

drop trigger if exists set_work_time_adjustment_dates_updated_at on public.work_time_adjustment_request_dates;
create trigger set_work_time_adjustment_dates_updated_at
before update on public.work_time_adjustment_request_dates
for each row execute function public.set_updated_at();

create or replace function public.current_malaysia_business_date()
returns date
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (now() at time zone 'Asia/Kuala_Lumpur')::date
$$;

create or replace function public.current_user_kch_employee()
returns table (
  profile_id uuid,
  employee_id uuid,
  region_id uuid
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id, e.id, e.region_id
  from public.profiles p
  join public.employees e
    on e.profile_id = p.id
    and e.deleted_at is null
  join public.regions r
    on r.id = e.region_id
    and r.code = 'KCH'
    and r.is_active = true
  where p.id = auth.uid()
    and p.status = 'approved'
  limit 1
$$;

create or replace function public.current_user_can_review_work_time_adjustment(p_region_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.regions r
    where r.id = p_region_id
      and r.code = 'KCH'
      and public.current_user_has_permission('work-time-adjustment', 'use')
      and public.current_user_can_access_region(p_region_id)
  )
$$;

create or replace function public.work_time_adjustment_detail_matches_header()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  header public.work_time_adjustment_requests;
begin
  select *
  into header
  from public.work_time_adjustment_requests
  where id = new.request_id;

  if header.id is null then
    raise exception 'Work time adjustment request header not found.';
  end if;

  if new.profile_id is distinct from header.profile_id
     or new.employee_id is distinct from header.employee_id
     or new.region_id is distinct from header.region_id then
    raise exception 'Work time adjustment date does not match its request header.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_work_time_adjustment_detail_header
on public.work_time_adjustment_request_dates;
create trigger validate_work_time_adjustment_detail_header
before insert or update of request_id, profile_id, employee_id, region_id
on public.work_time_adjustment_request_dates
for each row execute function public.work_time_adjustment_detail_matches_header();

create or replace function public.get_effective_work_time_adjustment(
  p_employee_id uuid,
  p_work_date date
)
returns table (
  detail_id uuid,
  request_id uuid,
  employee_id uuid,
  work_date date,
  adjusted_start_time time,
  adjusted_end_time time,
  approved_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    d.id,
    d.request_id,
    d.employee_id,
    d.work_date,
    d.adjusted_start_time,
    d.adjusted_end_time,
    d.reviewed_at
  from public.work_time_adjustment_request_dates d
  join public.employees e
    on e.id = d.employee_id
    and e.deleted_at is null
  join public.regions r
    on r.id = e.region_id
    and r.code = 'KCH'
    and r.is_active = true
  where d.employee_id = p_employee_id
    and d.work_date = p_work_date
    and d.status = 'approved'
    and (
      e.profile_id = auth.uid()
      or public.current_user_can_review_work_time_adjustment(e.region_id)
    )
  order by d.reviewed_at desc, d.created_at desc, d.id desc
  limit 1
$$;

create or replace function public.create_work_time_adjustment_request(
  p_start_date date,
  p_end_date date,
  p_adjusted_start_time time,
  p_reason text,
  p_attachment_path text default null,
  p_attachment_original_name text default null,
  p_attachment_content_type text default null,
  p_attachment_size_bytes integer default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requester record;
  employee_record public.employees;
  new_request_id uuid;
  adjusted_end time := p_adjusted_start_time + interval '8 hours 30 minutes';
  detail_count integer := 0;
  effective_original_start time;
  effective_original_end time;
  candidate record;
begin
  select * into requester from public.current_user_kch_employee() limit 1;

  if requester.employee_id is null then
    raise exception 'Only KCH employees can create work time adjustment requests.';
  end if;

  select * into employee_record
  from public.employees
  where id = requester.employee_id
    and deleted_at is null;

  if employee_record.start_work_time is null or employee_record.end_work_time is null then
    raise exception 'Employee normal work time is incomplete.';
  end if;

  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then
    raise exception 'Invalid request date range.';
  end if;

  if p_start_date < public.current_malaysia_business_date() + 1 then
    raise exception 'Work time adjustment requests must be submitted at least 1 day in advance.';
  end if;

  if p_adjusted_start_time is null
     or extract(second from p_adjusted_start_time) <> 0
     or mod(extract(minute from p_adjusted_start_time)::integer, 15) <> 0 then
    raise exception 'Adjusted start time must use a 15-minute interval.';
  end if;

  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Reason is required.';
  end if;

  if nullif(trim(coalesce(p_attachment_path, '')), '') is not null then
    if split_part(trim(p_attachment_path), '/', 1) <> auth.uid()::text then
      raise exception 'Attachment path must belong to the current user.';
    end if;

    if p_attachment_content_type not in ('image/jpeg', 'image/png', 'application/pdf')
       or coalesce(p_attachment_size_bytes, 0) < 1
       or p_attachment_size_bytes > 5242880 then
      raise exception 'Attachment must be JPG, JPEG, PNG, or PDF and no larger than 5MB.';
    end if;
  end if;

  insert into public.work_time_adjustment_requests (
    profile_id,
    employee_id,
    region_id,
    requested_start_date,
    requested_end_date,
    original_start_work_time,
    original_end_work_time,
    requested_start_time,
    requested_end_time,
    reason,
    attachment_path,
    attachment_original_name,
    attachment_content_type,
    attachment_size_bytes
  )
  values (
    requester.profile_id,
    requester.employee_id,
    requester.region_id,
    p_start_date,
    p_end_date,
    employee_record.start_work_time,
    employee_record.end_work_time,
    p_adjusted_start_time,
    adjusted_end,
    trim(p_reason),
    nullif(trim(coalesce(p_attachment_path, '')), ''),
    nullif(trim(coalesce(p_attachment_original_name, '')), ''),
    p_attachment_content_type,
    p_attachment_size_bytes
  )
  returning id into new_request_id;

  insert into public.work_time_adjustment_audit_history (
    request_id,
    actor_profile_id,
    actor_employee_id,
    action,
    note,
    metadata
  )
  values (
    new_request_id,
    requester.profile_id,
    requester.employee_id,
    'request_created',
    trim(p_reason),
    jsonb_build_object('start_date', p_start_date, 'end_date', p_end_date)
  );

  for candidate in
    select day::date as work_date
    from generate_series(p_start_date, p_end_date, interval '1 day') as day
    where not exists (
        select 1
        from public.public_holidays ph
        where ph.is_active = true
          and ph.holiday_date = day::date
          and (ph.region_id is null or ph.region_id = requester.region_id)
      )
      and not exists (
        select 1
        from public.rest_days rd
        where rd.employee_id = requester.employee_id
          and rd.rest_date = day::date
          and rd.status = 'confirmed'
      )
      and (
        extract(dow from day::date) between 1 and 5
        or exists (
          select 1
          from public.leave_requests lr
          where lr.employee_id = requester.employee_id
            and lr.leave_type = 'replacement'
            and lr.status = 'approved'
            and lr.start_date = day::date
        )
      )
    order by day::date
  loop
    select
      coalesce(effective.adjusted_start_time, employee_record.start_work_time),
      coalesce(effective.adjusted_end_time, employee_record.end_work_time)
    into effective_original_start, effective_original_end
    from (select 1) seed
    left join lateral public.get_effective_work_time_adjustment(requester.employee_id, candidate.work_date) effective
      on true;

    if detail_count = 0 then
      update public.work_time_adjustment_requests
      set
        original_start_work_time = effective_original_start,
        original_end_work_time = effective_original_end
      where id = new_request_id;
    elsif effective_original_start is distinct from (
      select original_start_work_time from public.work_time_adjustment_requests where id = new_request_id
    ) or effective_original_end is distinct from (
      select original_end_work_time from public.work_time_adjustment_requests where id = new_request_id
    ) then
      raise exception 'Request range contains different original work periods. Please split the request.';
    end if;

    insert into public.work_time_adjustment_request_dates (
      request_id,
      profile_id,
      employee_id,
      region_id,
      work_date,
      original_start_work_time,
      original_end_work_time,
      adjusted_start_time,
      adjusted_end_time
    )
    values (
      new_request_id,
      requester.profile_id,
      requester.employee_id,
      requester.region_id,
      candidate.work_date,
      effective_original_start,
      effective_original_end,
      p_adjusted_start_time,
      adjusted_end
    );

    detail_count := detail_count + 1;
  end loop;

  if detail_count = 0 then
    raise exception 'The selected range has no eligible KCH work dates.';
  end if;

  return new_request_id;
end;
$$;

create or replace function public.update_pending_work_time_adjustment_date(
  p_detail_id uuid,
  p_adjusted_start_time time
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_detail public.work_time_adjustment_request_dates;
  adjusted_end time := p_adjusted_start_time + interval '8 hours 30 minutes';
begin
  select * into target_detail
  from public.work_time_adjustment_request_dates
  where id = p_detail_id
  for update;

  if target_detail.id is null then
    raise exception 'Work time adjustment date not found.';
  end if;

  if target_detail.profile_id <> auth.uid() then
    raise exception 'Employees can only update their own requests.';
  end if;

  if not exists (
    select 1
    from public.employees e
    join public.regions r
      on r.id = e.region_id
      and r.code = 'KCH'
      and r.is_active = true
    where e.id = target_detail.employee_id
      and e.profile_id = auth.uid()
      and e.deleted_at is null
  ) then
    raise exception 'Only KCH employees can update work time adjustment requests.';
  end if;

  if target_detail.status <> 'pending' then
    raise exception 'Only pending request dates can be updated.';
  end if;

  if target_detail.work_date < public.current_malaysia_business_date() + 1 then
    raise exception 'Pending request dates can only be updated at least 1 day in advance.';
  end if;

  if p_adjusted_start_time is null
     or extract(second from p_adjusted_start_time) <> 0
     or mod(extract(minute from p_adjusted_start_time)::integer, 15) <> 0 then
    raise exception 'Adjusted start time must use a 15-minute interval.';
  end if;

  update public.work_time_adjustment_request_dates
  set
    adjusted_start_time = p_adjusted_start_time,
    adjusted_end_time = adjusted_end,
    updated_at = now()
  where id = p_detail_id;

  insert into public.work_time_adjustment_audit_history (
    request_id,
    detail_id,
    actor_profile_id,
    action,
    from_status,
    to_status,
    metadata
  )
  values (
    target_detail.request_id,
    target_detail.id,
    auth.uid(),
    'detail_updated',
    target_detail.status,
    target_detail.status,
    jsonb_build_object(
      'old_start_time', target_detail.adjusted_start_time,
      'new_start_time', p_adjusted_start_time
    )
  );
end;
$$;

create or replace function public.cancel_pending_work_time_adjustment_date(
  p_detail_id uuid,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_detail public.work_time_adjustment_request_dates;
begin
  select * into target_detail
  from public.work_time_adjustment_request_dates
  where id = p_detail_id
  for update;

  if target_detail.id is null then
    raise exception 'Work time adjustment date not found.';
  end if;

  if target_detail.profile_id <> auth.uid() then
    raise exception 'Employees can only cancel their own requests.';
  end if;

  if not exists (
    select 1
    from public.employees e
    join public.regions r
      on r.id = e.region_id
      and r.code = 'KCH'
      and r.is_active = true
    where e.id = target_detail.employee_id
      and e.profile_id = auth.uid()
      and e.deleted_at is null
  ) then
    raise exception 'Only KCH employees can cancel work time adjustment requests.';
  end if;

  if target_detail.status <> 'pending' then
    raise exception 'Only pending request dates can be cancelled by employees.';
  end if;

  update public.work_time_adjustment_request_dates
  set
    status = 'cancelled',
    cancelled_at = now(),
    updated_at = now()
  where id = p_detail_id;

  insert into public.work_time_adjustment_audit_history (
    request_id,
    detail_id,
    actor_profile_id,
    action,
    from_status,
    to_status,
    note
  )
  values (
    target_detail.request_id,
    target_detail.id,
    auth.uid(),
    'detail_cancelled',
    target_detail.status,
    'cancelled',
    nullif(trim(coalesce(p_note, '')), '')
  );
end;
$$;

create or replace function public.review_work_time_adjustment_date(
  p_detail_id uuid,
  p_status text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_detail public.work_time_adjustment_request_dates;
  normalized_status text := lower(trim(coalesce(p_status, '')));
  audit_action public.work_time_adjustment_audit_action;
begin
  if normalized_status not in ('approved', 'rejected') then
    raise exception 'Review status must be approved or rejected.';
  end if;

  select * into target_detail
  from public.work_time_adjustment_request_dates
  where id = p_detail_id
  for update;

  if target_detail.id is null then
    raise exception 'Work time adjustment date not found.';
  end if;

  if target_detail.status <> 'pending' then
    raise exception 'Only pending request dates can be reviewed.';
  end if;

  if not public.current_user_can_review_work_time_adjustment(target_detail.region_id) then
    raise exception 'No permission to review this work time adjustment date.';
  end if;

  audit_action := case
    when normalized_status = 'approved' then 'detail_approved'::public.work_time_adjustment_audit_action
    else 'detail_rejected'::public.work_time_adjustment_audit_action
  end;

  update public.work_time_adjustment_request_dates
  set
    status = normalized_status::public.work_time_adjustment_detail_status,
    review_note = nullif(trim(coalesce(p_note, '')), ''),
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    updated_at = now()
  where id = p_detail_id;

  insert into public.work_time_adjustment_audit_history (
    request_id,
    detail_id,
    actor_profile_id,
    action,
    from_status,
    to_status,
    note
  )
  values (
    target_detail.request_id,
    target_detail.id,
    auth.uid(),
    audit_action,
    target_detail.status,
    normalized_status::public.work_time_adjustment_detail_status,
    nullif(trim(coalesce(p_note, '')), '')
  );
end;
$$;

create or replace function public.revoke_approved_work_time_adjustment_date(
  p_detail_id uuid,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_detail public.work_time_adjustment_request_dates;
begin
  select * into target_detail
  from public.work_time_adjustment_request_dates
  where id = p_detail_id
  for update;

  if target_detail.id is null then
    raise exception 'Work time adjustment date not found.';
  end if;

  if target_detail.status <> 'approved' then
    raise exception 'Only approved request dates can be revoked.';
  end if;

  if length(trim(coalesce(p_note, ''))) = 0 then
    raise exception 'Revoke note is required.';
  end if;

  if not public.current_user_can_review_work_time_adjustment(target_detail.region_id) then
    raise exception 'No permission to revoke this work time adjustment date.';
  end if;

  update public.work_time_adjustment_request_dates
  set
    status = 'revoked',
    revoked_by = auth.uid(),
    revoked_at = now(),
    revoke_note = trim(p_note),
    updated_at = now()
  where id = p_detail_id;

  insert into public.work_time_adjustment_audit_history (
    request_id,
    detail_id,
    actor_profile_id,
    action,
    from_status,
    to_status,
    note
  )
  values (
    target_detail.request_id,
    target_detail.id,
    auth.uid(),
    'detail_revoked',
    target_detail.status,
    'revoked',
    trim(p_note)
  );
end;
$$;

alter table public.work_time_adjustment_requests enable row level security;
alter table public.work_time_adjustment_request_dates enable row level security;
alter table public.work_time_adjustment_audit_history enable row level security;

revoke insert, update, delete on public.work_time_adjustment_requests from authenticated;
revoke insert, update, delete on public.work_time_adjustment_request_dates from authenticated;
revoke insert, update, delete on public.work_time_adjustment_audit_history from authenticated;

grant select on public.work_time_adjustment_requests to authenticated;
grant select on public.work_time_adjustment_request_dates to authenticated;
grant select on public.work_time_adjustment_audit_history to authenticated;

drop policy if exists "Users can read own or reviewable work time adjustment requests"
on public.work_time_adjustment_requests;
create policy "Users can read own or reviewable work time adjustment requests"
on public.work_time_adjustment_requests
for select
to authenticated
using (
  (
    profile_id = auth.uid()
    and exists (
      select 1
      from public.employees e
      join public.regions r
        on r.id = e.region_id
        and r.code = 'KCH'
        and r.is_active = true
      where e.id = work_time_adjustment_requests.employee_id
        and e.profile_id = auth.uid()
        and e.deleted_at is null
    )
  )
  or public.current_user_can_review_work_time_adjustment(region_id)
);

drop policy if exists "Users can read own or reviewable work time adjustment dates"
on public.work_time_adjustment_request_dates;
create policy "Users can read own or reviewable work time adjustment dates"
on public.work_time_adjustment_request_dates
for select
to authenticated
using (
  (
    profile_id = auth.uid()
    and exists (
      select 1
      from public.employees e
      join public.regions r
        on r.id = e.region_id
        and r.code = 'KCH'
        and r.is_active = true
      where e.id = work_time_adjustment_request_dates.employee_id
        and e.profile_id = auth.uid()
        and e.deleted_at is null
    )
  )
  or public.current_user_can_review_work_time_adjustment(region_id)
);

drop policy if exists "Users can read own or reviewable work time adjustment audit"
on public.work_time_adjustment_audit_history;
create policy "Users can read own or reviewable work time adjustment audit"
on public.work_time_adjustment_audit_history
for select
to authenticated
using (
  exists (
    select 1
    from public.work_time_adjustment_requests r
    where r.id = work_time_adjustment_audit_history.request_id
      and (
        (
          r.profile_id = auth.uid()
          and exists (
            select 1
            from public.employees e
            join public.regions rg
              on rg.id = e.region_id
              and rg.code = 'KCH'
              and rg.is_active = true
            where e.id = r.employee_id
              and e.profile_id = auth.uid()
              and e.deleted_at is null
          )
        )
        or public.current_user_can_review_work_time_adjustment(r.region_id)
      )
  )
);

drop policy if exists "KCH employees can upload own work time adjustment attachments"
on storage.objects;
create policy "KCH employees can upload own work time adjustment attachments"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'work-time-adjustment-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
  and exists (select 1 from public.current_user_kch_employee())
);

drop policy if exists "Users can read own or reviewable work time adjustment attachments"
on storage.objects;
create policy "Users can read own or reviewable work time adjustment attachments"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'work-time-adjustment-attachments'
  and (
    (
      (storage.foldername(name))[1] = auth.uid()::text
      and exists (select 1 from public.current_user_kch_employee())
    )
    or exists (
      select 1
      from public.work_time_adjustment_requests r
      where r.attachment_path = storage.objects.name
        and public.current_user_can_review_work_time_adjustment(r.region_id)
    )
  )
);

revoke all on function public.current_user_kch_employee() from public;
revoke all on function public.current_user_can_review_work_time_adjustment(uuid) from public;
revoke all on function public.current_malaysia_business_date() from public;
revoke all on function public.work_time_adjustment_detail_matches_header() from public;
revoke all on function public.get_effective_work_time_adjustment(uuid, date) from public;
revoke all on function public.create_work_time_adjustment_request(
  date,
  date,
  time,
  text,
  text,
  text,
  text,
  integer
) from public;
revoke all on function public.update_pending_work_time_adjustment_date(uuid, time) from public;
revoke all on function public.cancel_pending_work_time_adjustment_date(uuid, text) from public;
revoke all on function public.review_work_time_adjustment_date(uuid, text, text) from public;
revoke all on function public.revoke_approved_work_time_adjustment_date(uuid, text) from public;

grant execute on function public.current_user_kch_employee() to authenticated;
grant execute on function public.current_user_can_review_work_time_adjustment(uuid) to authenticated;
grant execute on function public.current_malaysia_business_date() to authenticated;
grant execute on function public.get_effective_work_time_adjustment(uuid, date) to authenticated;
grant execute on function public.create_work_time_adjustment_request(
  date,
  date,
  time,
  text,
  text,
  text,
  text,
  integer
) to authenticated;
grant execute on function public.update_pending_work_time_adjustment_date(uuid, time) to authenticated;
grant execute on function public.cancel_pending_work_time_adjustment_date(uuid, text) to authenticated;
grant execute on function public.review_work_time_adjustment_date(uuid, text, text) to authenticated;
grant execute on function public.revoke_approved_work_time_adjustment_date(uuid, text) to authenticated;

comment on table public.work_time_adjustment_requests is
  'Header table for KCH work time adjustment requests. Per-date status is stored in work_time_adjustment_request_dates.';

comment on table public.work_time_adjustment_request_dates is
  'Per-date work time adjustment details. Latest approved non-revoked row is the effective schedule for that employee/date.';

comment on table public.work_time_adjustment_audit_history is
  'Append-only audit trail for work time adjustment review, cancellation, and revocation actions.';

commit;
