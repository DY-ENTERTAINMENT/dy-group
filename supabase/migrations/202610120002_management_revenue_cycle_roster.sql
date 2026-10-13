begin;

-- Read-only reporting v2: start with profiles in the caller's current access
-- scope, then attach canonical revenue rows. This intentionally keeps profiles
-- with no rows in the requested period visible with a zero amount.
create function public.list_management_revenue_canonical_records_v2(
  p_start_date date, p_end_date date, p_manager_employee_id uuid default null,
  p_platform text default null, p_creator_type text default null, p_region_id uuid default null,
  p_status text default null, p_limit integer default 500, p_offset integer default 0,
  p_revenue_cycle text default null
)
returns table (
  id uuid, creator_entity_id uuid, creator_profile_id uuid, platform public.creator_platform, platform_uid text,
  week_start_date date, week_end_date date, revenue_amount numeric, revenue_unit text, is_cumulative_generated boolean,
  source text, source_reference text, agent_note text, manager_note text, status text,
  submitted_by_employee_id uuid, submitted_at timestamptz, confirmed_by_employee_id uuid, confirmed_at timestamptz,
  created_by_employee_id uuid, updated_by_employee_id uuid, created_at timestamptz, updated_at timestamptz,
  reporting_manager_employee_id uuid, manager_attribution_source text, creator_current_entity_id uuid,
  creator_joined_date date, creator_platform public.creator_platform, creator_platform_user_id text,
  creator_platform_account text, creator_region_id uuid, creator_name text, creator_scout_employee_id uuid,
  creator_scout_profile_id uuid, creator_current_manager_employee_id uuid, creator_revenue_cycle text,
  creator_revenue_input_mode text, creator_status text, creator_type public.creator_type,
  creator_created_at timestamptz, creator_updated_at timestamptz, region_code text, region_name text,
  scout_full_name text, scout_nickname text, reporting_manager_full_name text, reporting_manager_nickname text,
  submitted_by_full_name text, submitted_by_nickname text, submitted_by_email text,
  confirmed_by_full_name text, confirmed_by_nickname text, confirmed_by_email text, has_revenue_record boolean
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.current_user_has_permission('management-revenue-data', 'view') then raise exception 'Permission denied.'; end if;
  if p_start_date is null or p_end_date is null or p_start_date > p_end_date then raise exception 'A valid reporting date range is required.' using errcode = '22023'; end if;
  if p_platform is not null and p_platform not in ('tiktok', 'douyin') then raise exception 'Invalid platform filter.' using errcode = '22023'; end if;
  if p_creator_type is not null and p_creator_type not in ('5+1', 'non_5_1') then raise exception 'Invalid creator type filter.' using errcode = '22023'; end if;
  if p_status is not null and p_status not in ('pending', 'confirmed') then raise exception 'Invalid status filter.' using errcode = '22023'; end if;
  if p_revenue_cycle is not null and p_revenue_cycle not in ('weekly', 'monthly', 'none') then raise exception 'Invalid revenue cycle filter.' using errcode = '22023'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 or p_offset is null or p_offset < 0 then raise exception 'Invalid pagination.' using errcode = '22023'; end if;

  return query
  with scoped_profiles as (
    select cp.id profile_id, cp.creator_entity_id profile_entity_id, cp.joined_date profile_joined_date, cp.platform profile_platform,
      cp.platform_user_id profile_platform_user_id, cp.platform_account profile_platform_account, cp.region_id profile_region_id,
      cp.creator_name profile_creator_name, cp.scout_employee_id profile_scout_employee_id, cp.scout_profile_id profile_scout_profile_id,
      cp.manager_employee_id profile_manager_employee_id, cp.revenue_cycle profile_revenue_cycle,
      cp.revenue_input_mode profile_revenue_input_mode, cp.status profile_status, cp.creator_type profile_creator_type,
      cp.created_at profile_created_at, cp.updated_at profile_updated_at
    from public.creator_profiles cp
    where cp.status <> 'invalid'
      and public.current_user_can_access_region(cp.region_id)
      and (p_platform is null or cp.platform::text = p_platform)
      and (p_region_id is null or cp.region_id = p_region_id)
      and (p_creator_type is null or (p_creator_type = '5+1' and cp.creator_type::text = '5+1') or (p_creator_type = 'non_5_1' and cp.creator_type::text <> '5+1'))
      and (p_revenue_cycle is null or cp.revenue_cycle = p_revenue_cycle)
  ), canonical_records as (
    select ranked.* from (
      select wr.*, row_number() over (partition by wr.creator_profile_id, wr.week_start_date order by wr.updated_at desc nulls last, wr.submitted_at desc nulls last, wr.created_at desc nulls last, wr.id desc) rn
      from public.creator_weekly_revenue_records wr
      join scoped_profiles cp on cp.profile_id = wr.creator_profile_id
      where wr.status in ('submitted', 'confirmed') and wr.week_start_date between p_start_date and p_end_date
    ) ranked where ranked.rn = 1
  ), rows as (
    select cp.*, wr.*, coalesce(wr.manager_employee_id_attribution, cp.profile_manager_employee_id) resolved_manager_employee_id,
      case when wr.id is null then 'current_manager_no_record' when wr.manager_employee_id_attribution is not null then 'historical_attribution' else 'legacy_current_manager_fallback' end resolved_manager_attribution_source
    from scoped_profiles cp left join canonical_records wr on wr.creator_profile_id = cp.profile_id
  )
  select wr.id, coalesce(wr.creator_entity_id, wr.profile_entity_id), wr.profile_id, coalesce(wr.platform, wr.profile_platform), coalesce(wr.platform_uid, wr.profile_platform_user_id), wr.week_start_date, wr.week_end_date,
    coalesce(wr.revenue_amount, 0), wr.revenue_unit, coalesce(wr.is_cumulative_generated, false), wr.source, wr.source_reference,
    wr.agent_note, wr.manager_note, wr.status::text, wr.submitted_by_employee_id, wr.submitted_at, wr.confirmed_by_employee_id, wr.confirmed_at,
    wr.created_by_employee_id, wr.updated_by_employee_id, wr.created_at, wr.updated_at, wr.resolved_manager_employee_id, wr.resolved_manager_attribution_source,
    wr.profile_entity_id, wr.profile_joined_date, wr.profile_platform, wr.profile_platform_user_id, wr.profile_platform_account, wr.profile_region_id, wr.profile_creator_name,
    wr.profile_scout_employee_id, wr.profile_scout_profile_id, wr.profile_manager_employee_id, wr.profile_revenue_cycle, wr.profile_revenue_input_mode, wr.profile_status::text,
    wr.profile_creator_type, wr.profile_created_at, wr.profile_updated_at, region.code, region.name, scout.full_name, scout.nickname,
    reporting_manager.full_name, reporting_manager.nickname, submitted_by.full_name, submitted_by.nickname, submitted_by.email,
    confirmed_by.full_name, confirmed_by.nickname, confirmed_by.email, wr.id is not null
  from rows wr
  left join public.regions region on region.id = wr.profile_region_id
  left join public.employees scout on scout.id = wr.profile_scout_employee_id
  left join public.employees reporting_manager on reporting_manager.id = wr.resolved_manager_employee_id
  left join public.employees submitted_by on submitted_by.id = wr.submitted_by_employee_id
  left join public.employees confirmed_by on confirmed_by.id = wr.confirmed_by_employee_id
  where (p_manager_employee_id is null or wr.resolved_manager_employee_id = p_manager_employee_id)
    and (p_status is null or (p_status = 'pending' and wr.status = 'submitted') or (p_status = 'confirmed' and wr.status = 'confirmed'))
  order by wr.week_start_date desc nulls last, wr.created_at desc nulls last, wr.id desc nulls last, wr.profile_id
  limit p_limit offset p_offset;
end;
$$;

create function public.list_management_revenue_representative_options_v2(
  p_start_date date, p_end_date date, p_platform text default null, p_creator_type text default null,
  p_region_id uuid default null, p_status text default null, p_revenue_cycle text default null
)
returns table (id uuid, full_name text, nickname text)
language sql stable security definer set search_path = public, pg_temp as $$
  select distinct employee.id, employee.full_name, employee.nickname
  from public.employees employee
  join lateral public.list_management_revenue_canonical_records_v2(p_start_date, p_end_date, employee.id, p_platform, p_creator_type, p_region_id, p_status, 500, 0, p_revenue_cycle) rows on true
  where employee.deleted_at is null and employee.status in ('active', 'probation')
  order by employee.full_name, employee.id;
$$;

revoke all on function public.list_management_revenue_canonical_records_v2(date, date, uuid, text, text, uuid, text, integer, integer, text) from public, anon;
grant execute on function public.list_management_revenue_canonical_records_v2(date, date, uuid, text, text, uuid, text, integer, integer, text) to authenticated;
revoke all on function public.list_management_revenue_representative_options_v2(date, date, text, text, uuid, text, text) from public, anon;
grant execute on function public.list_management_revenue_representative_options_v2(date, date, text, text, uuid, text, text) to authenticated;

commit;
