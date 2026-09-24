begin;

create function public.list_personal_manager_weekly_revenue_profiles()
returns table (
  id uuid, creator_entity_id uuid, joined_date date, platform public.creator_platform,
  platform_user_id text, platform_account text, platform_public_id text, region_id uuid,
  region_code text, region_name text, creator_name text, scout_employee_id uuid,
  scout_profile_id uuid, scout_full_name text, scout_nickname text, manager_employee_id uuid,
  manager_full_name text, manager_nickname text, secondary_manager_employee_id uuid,
  secondary_manager_display_name text, creator_type public.creator_type, status text,
  membership_status text, revenue_cycle text, revenue_input_mode text,
  bank_account_name text, bank_name text, bank_account text, created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select creator.id, creator.creator_entity_id, creator.joined_date, creator.platform,
    creator.platform_user_id, creator.platform_account, creator.platform_public_id,
    creator.region_id, region.code, region.name, creator.creator_name,
    creator.scout_employee_id, creator.scout_profile_id, scout.full_name, scout.nickname,
    creator.manager_employee_id, manager.full_name, manager.nickname,
    secondary_manager.employee_id, secondary_manager.display_name, creator.creator_type,
    creator.status, creator.membership_status,
    coalesce(creator.revenue_cycle, 'weekly'), coalesce(creator.revenue_input_mode, 'direct'),
    case when creator.manager_employee_id = public.current_user_employee_id() then creator.bank_account_name else null end,
    case when creator.manager_employee_id = public.current_user_employee_id() then creator.bank_name else null end,
    case when creator.manager_employee_id = public.current_user_employee_id() then creator.bank_account else null end,
    creator.created_at, creator.updated_at
  from public.creator_profiles creator
  join public.creator_entities entity
    on entity.id = creator.creator_entity_id
   and entity.status = 'active'
  left join public.regions region on region.id = creator.region_id
  left join public.employees scout on scout.id = creator.scout_employee_id
  left join public.employees manager on manager.id = creator.manager_employee_id
  left join lateral (
    select collaborator.employee_id,
      coalesce(nullif(btrim(employee.nickname), ''), employee.full_name) as display_name
    from public.creator_collaborator_assignments collaborator
    join public.employees employee on employee.id = collaborator.employee_id
    where collaborator.creator_entity_id = creator.creator_entity_id
      and collaborator.assignment_type = 'manager'
      and collaborator.assignment_role = 'secondary'
      and collaborator.status = 'active'
    limit 1
  ) secondary_manager on true
  where auth.uid() is not null
    -- The Agent weekly workbench must only list Profiles that its existing
    -- direct and cumulative write paths can submit. Secondary collaborators
    -- may view creator data elsewhere, but they cannot submit weekly revenue.
    and public.current_user_has_permission('agent-revenue-data', 'use')
    and public.current_user_can_access_region(creator.region_id)
    and creator.status = 'active'
    and creator.membership_status = 'active'
    and creator.manager_employee_id = public.current_user_employee_id()
  order by creator.joined_date desc, creator.id;
$$;

revoke all on function public.list_personal_manager_weekly_revenue_profiles() from public, anon;
grant execute on function public.list_personal_manager_weekly_revenue_profiles() to authenticated;

commit;
