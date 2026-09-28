begin;

-- Count canonical people, not platform profiles. A merged entity is excluded so
-- a TikTok/Douyin association remains one creator in the KPI.
create or replace function public.get_management_revenue_creator_entity_count(
  p_region_id uuid default null
)
returns bigint
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.current_user_has_permission('agent-revenue-data', 'use') then
    raise exception 'Permission denied.';
  end if;

  if p_region_id is not null and not public.current_user_can_access_region(p_region_id) then
    raise exception 'Region access denied.';
  end if;

  return (
    select count(*)
    from public.creator_entities entity
    where entity.status = 'active'
      and public.current_user_can_access_region(entity.region_id)
      and (p_region_id is null or entity.region_id = p_region_id)
  );
end;
$$;

-- Kept separate from list_management_revenue_manager_options(), whose
-- job-title based contract remains unchanged for existing callers.
create or replace function public.list_management_revenue_representative_options(
  p_start_date date,
  p_end_date date,
  p_platform text default null,
  p_creator_type text default null,
  p_region_id uuid default null,
  p_status text default null
)
returns table (
  id uuid,
  full_name text,
  nickname text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.current_user_has_permission('management-revenue-data', 'view') then
    raise exception 'Permission denied.';
  end if;

  if p_start_date is null or p_end_date is null or p_start_date > p_end_date then
    raise exception 'A valid reporting date range is required.' using errcode = '22023';
  end if;
  if p_platform is not null and p_platform not in ('tiktok', 'douyin') then
    raise exception 'Invalid platform filter.' using errcode = '22023';
  end if;
  if p_creator_type is not null and p_creator_type not in ('5+1', 'non_5_1') then
    raise exception 'Invalid creator type filter.' using errcode = '22023';
  end if;
  if p_status is not null and p_status not in ('pending', 'confirmed') then
    raise exception 'Invalid status filter.' using errcode = '22023';
  end if;

  if p_region_id is not null and not public.current_user_can_access_region(p_region_id) then
    raise exception 'Region access denied.';
  end if;

  return query
  with valid_rows as (
    select
      revenue.*,
      creator.manager_employee_id as current_manager_employee_id,
      coalesce(revenue.manager_employee_id_attribution, creator.manager_employee_id) as resolved_manager_employee_id
    from public.creator_weekly_revenue_records revenue
    join public.creator_profiles creator on creator.id = revenue.creator_profile_id
    where revenue.status in ('submitted', 'confirmed')
      and revenue.week_start_date between p_start_date and p_end_date
      and creator.status <> 'invalid'
      and public.current_user_can_access_region(creator.region_id)
      and (p_platform is null or revenue.platform::text = p_platform)
      and (p_region_id is null or creator.region_id = p_region_id)
      and (p_creator_type is null or (p_creator_type = '5+1' and creator.creator_type::text = '5+1') or (p_creator_type = 'non_5_1' and creator.creator_type::text <> '5+1'))
  ), canonical_rows as (
    select valid_rows.*, row_number() over (
      partition by valid_rows.creator_profile_id, valid_rows.week_start_date
      order by valid_rows.updated_at desc nulls last, valid_rows.submitted_at desc nulls last, valid_rows.created_at desc nulls last, valid_rows.id desc
    ) as rn
    from valid_rows
  )
  select employee.id, employee.full_name, employee.nickname
  from public.employees employee
  where employee.deleted_at is null
    and employee.status in ('active', 'probation')
    and exists (
      select 1
      from canonical_rows revenue
      where revenue.rn = 1
        and (p_status is null or (p_status = 'pending' and revenue.status = 'submitted') or (p_status = 'confirmed' and revenue.status = 'confirmed'))
        and revenue.resolved_manager_employee_id = employee.id
    )
  order by employee.full_name, employee.id;
end;
$$;

create or replace function public.list_current_revenue_representative_options(
  p_region_id uuid default null
)
returns table (
  id uuid,
  full_name text,
  nickname text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.current_user_has_permission('agent-revenue-data', 'use') then
    raise exception 'Permission denied.';
  end if;

  if p_region_id is not null and not public.current_user_can_access_region(p_region_id) then
    raise exception 'Region access denied.';
  end if;

  return query
  select employee.id, employee.full_name, employee.nickname
  from public.employees employee
  where employee.deleted_at is null
    and employee.status in ('active', 'probation')
    and exists (
      select 1
      from public.creator_profiles creator
      join public.creator_entities entity on entity.id = creator.creator_entity_id
      where entity.status = 'active'
        and creator.status = 'active'
        and creator.membership_status = 'active'
        and public.current_user_can_access_region(creator.region_id)
        and (p_region_id is null or creator.region_id = p_region_id)
        and creator.manager_employee_id = employee.id
    )
  order by employee.full_name, employee.id;
end;
$$;

revoke all on function public.get_management_revenue_creator_entity_count(uuid) from public, anon;
grant execute on function public.get_management_revenue_creator_entity_count(uuid) to authenticated;
revoke all on function public.list_management_revenue_representative_options(date, date, text, text, uuid, text) from public, anon;
grant execute on function public.list_management_revenue_representative_options(date, date, text, text, uuid, text) to authenticated;
revoke all on function public.list_current_revenue_representative_options(uuid) from public, anon;
grant execute on function public.list_current_revenue_representative_options(uuid) to authenticated;

commit;
