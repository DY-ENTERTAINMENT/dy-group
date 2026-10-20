begin;

create or replace function public.list_replacement_review_history_v3(
  p_year integer, p_month integer, p_change_type text default null, p_region_id uuid default null,
  p_status text default null, p_search text default null, p_page integer default 1, p_page_size integer default 25
) returns table (
  id uuid, record_type text, employee_name text, employee_code text, region_id uuid, region_code text,
  replacement_leave_date date, original_makeup_date date, requested_makeup_date date, change_type text,
  reason text, status text, reviewer_name text, reviewed_at timestamptz, created_at timestamptz, total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_month_start date;
  v_month_end date;
  v_offset integer;
begin
  if auth.uid() is null or not public.current_user_can_review_leave_requests() then
    raise exception 'No permission to view replacement review history.' using errcode = '42501';
  end if;
  if p_year not between 2000 and 2100 or p_month not between 1 and 12 then
    raise exception 'Invalid year or month.' using errcode = '22023';
  end if;
  if p_page < 1 or p_page_size < 1 or p_page_size > 100 then
    raise exception 'Invalid pagination.' using errcode = '22023';
  end if;
  if p_change_type is not null and p_change_type not in ('reschedule', 'annual_leave', 'unpaid_leave', 'work_time') then
    raise exception 'Invalid replacement work change type.' using errcode = '22023';
  end if;
  if p_status is not null and p_status not in ('approved', 'rejected') then
    raise exception 'Invalid review status.' using errcode = '22023';
  end if;
  if p_region_id is not null and not public.current_user_can_access_region(p_region_id) then
    raise exception 'No permission to view this region.' using errcode = '42501';
  end if;

  v_month_start := make_date(p_year, p_month, 1);
  v_month_end := (v_month_start + interval '1 month')::date;
  v_offset := (p_page - 1) * p_page_size;

  return query
  with normal_replacement_leave_events as (
    select
      lr.id,
      'replacement_leave'::text as record_type,
      coalesce(nullif(e.nickname, ''), e.full_name) as employee_name,
      e.employee_code,
      e.region_id,
      r.code as region_code,
      lr.end_date as replacement_leave_date,
      lr.start_date as original_makeup_date,
      null::date as requested_makeup_date,
      null::text as change_type,
      lr.reason,
      lr.status::text as status,
      coalesce(nullif(reviewer_employee.nickname, ''), reviewer_employee.full_name, reviewer_profile.full_name) as reviewer_name,
      lr.reviewed_at,
      lr.created_at
    from public.leave_requests lr
    join public.employees e
      on e.id = lr.employee_id
      and e.deleted_at is null
    left join public.regions r on r.id = e.region_id
    left join public.profiles reviewer_profile on reviewer_profile.id = lr.reviewed_by
    left join public.employees reviewer_employee
      on reviewer_employee.profile_id = lr.reviewed_by
      and reviewer_employee.deleted_at is null
    where lr.leave_type = 'replacement'
      and lr.status in ('approved', 'rejected')
  ),
  makeup_change_events as (
    select
      c.id,
      'makeup_change'::text as record_type,
      coalesce(nullif(e.nickname, ''), e.full_name) as employee_name,
      e.employee_code,
      e.region_id,
      r.code as region_code,
      source_leave.end_date as replacement_leave_date,
      c.original_makeup_date,
      c.requested_makeup_date,
      c.change_type::text as change_type,
      c.reason,
      c.status::text as status,
      coalesce(nullif(reviewer_employee.nickname, ''), reviewer_employee.full_name, reviewer_profile.full_name) as reviewer_name,
      c.reviewed_at,
      c.created_at
    from public.replacement_work_change_requests c
    join public.employees e
      on e.id = c.employee_id
      and e.deleted_at is null
    left join public.leave_requests source_leave
      on source_leave.id = c.source_replacement_leave_request_id
      and source_leave.employee_id = c.employee_id
      and source_leave.leave_type = 'replacement'
    left join public.regions r on r.id = e.region_id
    left join public.profiles reviewer_profile on reviewer_profile.id = c.reviewed_by
    left join public.employees reviewer_employee
      on reviewer_employee.profile_id = c.reviewed_by
      and reviewer_employee.deleted_at is null
    where c.status in ('approved', 'rejected')
  ),
  events as (
    select * from normal_replacement_leave_events
    union all
    select * from makeup_change_events
  ),
  filtered_events as (
    select events_row.*
    from events events_row
    where events_row.replacement_leave_date >= v_month_start
      and events_row.replacement_leave_date < v_month_end
      and public.current_user_can_access_region(events_row.region_id)
      and (p_region_id is null or events_row.region_id = p_region_id)
      and (p_change_type is null or (events_row.record_type = 'makeup_change' and events_row.change_type = p_change_type))
      and (p_status is null or events_row.status = p_status)
      and (
        nullif(btrim(p_search), '') is null
        or coalesce(events_row.employee_name, '') ilike '%' || btrim(p_search) || '%'
        or coalesce(events_row.employee_code, '') ilike '%' || btrim(p_search) || '%'
      )
  )
  select
    filtered_event.id,
    filtered_event.record_type,
    filtered_event.employee_name,
    filtered_event.employee_code,
    filtered_event.region_id,
    filtered_event.region_code,
    filtered_event.replacement_leave_date,
    filtered_event.original_makeup_date,
    filtered_event.requested_makeup_date,
    filtered_event.change_type,
    filtered_event.reason,
    filtered_event.status,
    filtered_event.reviewer_name,
    filtered_event.reviewed_at,
    filtered_event.created_at,
    count(*) over()
  from filtered_events filtered_event
  order by
    filtered_event.replacement_leave_date desc,
    filtered_event.reviewed_at desc nulls last,
    filtered_event.created_at desc,
    filtered_event.record_type,
    filtered_event.id
  limit p_page_size offset v_offset;
end;
$$;

revoke all on function public.list_replacement_review_history_v3(integer, integer, text, uuid, text, text, integer, integer) from public, anon;
grant execute on function public.list_replacement_review_history_v3(integer, integer, text, uuid, text, text, integer, integer) to authenticated;

commit;
