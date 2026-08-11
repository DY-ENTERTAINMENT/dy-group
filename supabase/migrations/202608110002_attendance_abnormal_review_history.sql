begin;

create table if not exists public.attendance_abnormal_review_history (
  id uuid primary key default gen_random_uuid(),

  attendance_record_id uuid not null
    references public.attendance_records(id) on delete restrict,

  review_status text not null,
  reason text,
  source_abnormal_types text[] not null,

  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_by_name text not null,
  reviewed_at timestamptz not null default now(),

  constraint attendance_abnormal_review_status_check
    check (review_status in ('normal', 'pending', 'abnormal')),

  constraint attendance_abnormal_review_reason_check
    check (
      review_status <> 'abnormal'
      or nullif(btrim(coalesce(reason, '')), '') is not null
    ),

  constraint attendance_abnormal_review_source_types_non_empty_check
    check (cardinality(source_abnormal_types) > 0),

  constraint attendance_abnormal_review_source_types_no_null_check
    check (array_position(source_abnormal_types, null) is null),

  constraint attendance_abnormal_review_source_types_allowed_check
    check (
      source_abnormal_types <@ array['IP异常', 'GPS异常', '设备异常']::text[]
    )
);

comment on table public.attendance_abnormal_review_history is
  'Stores append-only HR manual review history for attendance technical abnormalities: IP, GPS, and device anomalies. This is not the original attendance abnormal source data.';

comment on column public.attendance_abnormal_review_history.source_abnormal_types is
  'Snapshot of the technical abnormal types shown to HR at review time. Allowed values: IP异常, GPS异常, 设备异常.';

comment on column public.attendance_abnormal_review_history.reviewed_by_name is
  'Immutable reviewer display-name snapshot captured by database RPC from auth.uid(); not provided by the frontend.';

create index if not exists attendance_abnormal_review_record_idx
on public.attendance_abnormal_review_history(attendance_record_id, reviewed_at desc);

create index if not exists attendance_abnormal_review_reviewed_at_idx
on public.attendance_abnormal_review_history(reviewed_at desc);

alter table public.attendance_abnormal_review_history enable row level security;

revoke all on table public.attendance_abnormal_review_history from public;
revoke all on table public.attendance_abnormal_review_history from anon;
revoke all on table public.attendance_abnormal_review_history from authenticated;

create or replace function public.review_attendance_abnormal_record(
  p_attendance_record_id uuid,
  p_review_status text,
  p_source_abnormal_types text[],
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_status text;
  normalized_reason text;
  normalized_source_types text[];
  allowed_source_types constant text[] := array['IP异常', 'GPS异常', '设备异常'];
  target_employee_id uuid;
  target_region_id uuid;
  reviewer_display_name text;
  created_history_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Unable to identify current user.';
  end if;

  if not public.current_user_has_permission('attendance-management', 'use') then
    raise exception 'No permission to review attendance abnormalities.';
  end if;

  normalized_status := lower(nullif(btrim(coalesce(p_review_status, '')), ''));
  normalized_reason := nullif(btrim(coalesce(p_reason, '')), '');

  if normalized_status is null or normalized_status not in ('normal', 'pending', 'abnormal') then
    raise exception 'Invalid review status: %', p_review_status;
  end if;

  if normalized_status = 'abnormal' and normalized_reason is null then
    raise exception 'Reason is required when marking attendance as abnormal.';
  end if;

  select array_agg(distinct normalized_type order by normalized_type)
  into normalized_source_types
  from (
    select btrim(source_type) as normalized_type
    from unnest(coalesce(p_source_abnormal_types, array[]::text[])) as t(source_type)
    where nullif(btrim(source_type), '') is not null
  ) normalized;

  if normalized_source_types is null or cardinality(normalized_source_types) = 0 then
    raise exception 'At least one source abnormal type is required.';
  end if;

  if not normalized_source_types <@ allowed_source_types then
    raise exception 'Invalid source abnormal types.';
  end if;

  select ar.employee_id, e.region_id
  into target_employee_id, target_region_id
  from public.attendance_records ar
  join public.employees e
    on e.id = ar.employee_id
   and e.deleted_at is null
  where ar.id = p_attendance_record_id
  limit 1;

  if target_employee_id is null then
    raise exception 'Attendance record does not exist or is not linked to an active employee.';
  end if;

  if target_region_id is null then
    raise exception 'Attendance record employee has no region.';
  end if;

  if not public.current_user_can_access_region(target_region_id) then
    raise exception 'No permission to review attendance records in this region.';
  end if;

  select coalesce(
    nullif(btrim(reviewer_employee.nickname), ''),
    nullif(btrim(reviewer_employee.full_name), ''),
    nullif(btrim(reviewer_profile.nickname), ''),
    nullif(btrim(reviewer_profile.full_name), ''),
    reviewer_profile.email,
    auth.uid()::text
  )
  into reviewer_display_name
  from public.profiles reviewer_profile
  left join public.employees reviewer_employee
    on reviewer_employee.profile_id = reviewer_profile.id
   and reviewer_employee.deleted_at is null
  where reviewer_profile.id = auth.uid()
  limit 1;

  reviewer_display_name := coalesce(nullif(btrim(reviewer_display_name), ''), auth.uid()::text);

  insert into public.attendance_abnormal_review_history (
    attendance_record_id,
    review_status,
    reason,
    source_abnormal_types,
    reviewed_by,
    reviewed_by_name,
    reviewed_at
  )
  values (
    p_attendance_record_id,
    normalized_status,
    normalized_reason,
    normalized_source_types,
    auth.uid(),
    reviewer_display_name,
    now()
  )
  returning id into created_history_id;

  return created_history_id;
end;
$$;

revoke all on function public.review_attendance_abnormal_record(uuid, text, text[], text) from public;
revoke all on function public.review_attendance_abnormal_record(uuid, text, text[], text) from anon;
revoke all on function public.review_attendance_abnormal_record(uuid, text, text[], text) from authenticated;
grant execute on function public.review_attendance_abnormal_record(uuid, text, text[], text) to authenticated;

create or replace function public.get_attendance_abnormal_review_history(
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_region_id uuid default null
)
returns table (
  id uuid,
  attendance_record_id uuid,
  review_status text,
  reason text,
  source_abnormal_types text[],
  reviewed_by uuid,
  reviewed_by_name text,
  reviewed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Unable to identify current user.';
  end if;

  if not public.current_user_has_permission('attendance-management', 'view') then
    raise exception 'No permission to view attendance abnormal reviews.';
  end if;

  if p_start_at is null or p_end_at is null or p_start_at >= p_end_at then
    raise exception 'Invalid review history time range.';
  end if;

  if p_region_id is not null and not public.current_user_can_access_region(p_region_id) then
    raise exception 'No permission to view attendance abnormal reviews in this region.';
  end if;

  return query
  select
    h.id,
    h.attendance_record_id,
    h.review_status,
    h.reason,
    h.source_abnormal_types,
    h.reviewed_by,
    h.reviewed_by_name,
    h.reviewed_at
  from public.attendance_abnormal_review_history h
  join public.attendance_records ar
    on ar.id = h.attendance_record_id
  join public.employees e
    on e.id = ar.employee_id
   and e.deleted_at is null
  where ar.punched_at >= p_start_at
    and ar.punched_at < p_end_at
    and e.region_id is not null
    and (p_region_id is null or e.region_id = p_region_id)
    and public.current_user_can_access_region(e.region_id)
  order by h.reviewed_at desc, h.id desc;
end;
$$;

revoke all on function public.get_attendance_abnormal_review_history(timestamptz, timestamptz, uuid) from public;
revoke all on function public.get_attendance_abnormal_review_history(timestamptz, timestamptz, uuid) from anon;
revoke all on function public.get_attendance_abnormal_review_history(timestamptz, timestamptz, uuid) from authenticated;
grant execute on function public.get_attendance_abnormal_review_history(timestamptz, timestamptz, uuid) to authenticated;

commit;
