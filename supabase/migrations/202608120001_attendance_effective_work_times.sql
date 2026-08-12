begin;

create or replace function public.get_attendance_effective_work_times(
  p_start_date date,
  p_end_date date,
  p_region_id uuid default null
)
returns table (
  employee_id uuid,
  work_date date,
  effective_start_time time,
  effective_end_time time,
  is_from_work_time_adjustment boolean,
  detail_id uuid,
  request_id uuid,
  approved_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_start_date is null then
    raise exception 'Start date is required.';
  end if;

  if p_end_date is null then
    raise exception 'End date is required.';
  end if;

  if p_start_date > p_end_date then
    raise exception 'Start date must be before or equal to end date.';
  end if;

  if not public.current_user_has_permission('attendance-management', 'view') then
    raise exception 'No permission to view attendance effective work times.';
  end if;

  if p_region_id is not null and not public.current_user_can_access_region(p_region_id) then
    raise exception 'No permission to view attendance effective work times in this region.';
  end if;

  return query
  with ranked_adjustments as (
    select
      d.employee_id,
      d.work_date,
      d.adjusted_start_time,
      d.adjusted_end_time,
      d.id as detail_id,
      d.request_id,
      d.reviewed_at,
      row_number() over (
        partition by d.employee_id, d.work_date
        order by d.reviewed_at desc, d.created_at desc, d.id desc
      ) as row_number
    from public.work_time_adjustment_request_dates d
    join public.employees e
      on e.id = d.employee_id
      and e.deleted_at is null
    join public.regions r
      on r.id = e.region_id
      and r.code = 'KCH'
      and r.is_active = true
    where d.status = 'approved'
      and d.work_date between p_start_date and p_end_date
      and (p_region_id is null or e.region_id = p_region_id)
      and public.current_user_can_access_region(e.region_id)
  )
  select
    ranked_adjustments.employee_id,
    ranked_adjustments.work_date,
    ranked_adjustments.adjusted_start_time as effective_start_time,
    ranked_adjustments.adjusted_end_time as effective_end_time,
    true as is_from_work_time_adjustment,
    ranked_adjustments.detail_id,
    ranked_adjustments.request_id,
    ranked_adjustments.reviewed_at as approved_at
  from ranked_adjustments
  where ranked_adjustments.row_number = 1
  order by ranked_adjustments.work_date, ranked_adjustments.employee_id;
end;
$$;

revoke all on function public.get_attendance_effective_work_times(date, date, uuid) from public;
grant execute on function public.get_attendance_effective_work_times(date, date, uuid) to authenticated;

comment on function public.get_attendance_effective_work_times(date, date, uuid) is
  'Returns approved work-time adjustment overrides for attendance reports. Dates without a row should use the employee default work times.';

commit;
