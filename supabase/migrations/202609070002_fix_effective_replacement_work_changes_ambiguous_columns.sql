begin;

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
  select
    sr.source_id,
    sr.employee_id,
    sr.effective_makeup_date,
    case when sr.change_type = 'annual_leave' then 'annual_leave' when sr.change_type = 'unpaid_leave' then 'unpaid_leave' else 'none' end,
    sr.change_id,
    sr.change_type::text,
    sr.requested_start_time
  from source_rows sr
  where sr.start_date between p_start_date and p_end_date
    or sr.effective_makeup_date between p_start_date and p_end_date;
end;
$$;

commit;
