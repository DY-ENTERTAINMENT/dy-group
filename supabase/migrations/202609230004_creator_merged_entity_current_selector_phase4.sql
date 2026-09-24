begin;

-- Current-action guard only. Historical rows remain readable through their existing list/detail RPCs.
create or replace function public.require_active_creator_entity_for_current_action(p_creator_entity_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1
    from public.creator_entities entity
    where entity.id = p_creator_entity_id
      and entity.status = 'active'
  ) then
    raise exception '该主播主体当前不可用于此操作。';
  end if;
end;
$$;

create or replace function public.prevent_current_designer_request_for_inactive_entity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_active_creator_entity_for_current_action(new.creator_entity_id);
  return new;
end;
$$;

drop trigger if exists prevent_current_designer_request_for_inactive_entity on public.designer_requests;
create trigger prevent_current_designer_request_for_inactive_entity
before insert on public.designer_requests
for each row execute function public.prevent_current_designer_request_for_inactive_entity();

create or replace function public.prevent_current_creator_activity_for_inactive_entity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_active_creator_entity_for_current_action(new.creator_entity_id);
  return new;
end;
$$;

drop trigger if exists prevent_current_creator_activity_for_inactive_entity on public.creator_activities;
create trigger prevent_current_creator_activity_for_inactive_entity
before insert on public.creator_activities
for each row execute function public.prevent_current_creator_activity_for_inactive_entity();

create or replace function public.prevent_current_creator_milestone_for_inactive_entity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_active_creator_entity_for_current_action(new.creator_entity_id);
  return new;
end;
$$;

drop trigger if exists prevent_current_creator_milestone_for_inactive_entity on public.creator_milestone_notes;
create trigger prevent_current_creator_milestone_for_inactive_entity
before insert on public.creator_milestone_notes
for each row execute function public.prevent_current_creator_milestone_for_inactive_entity();

create or replace function public.list_designer_request_creators()
returns table(
  id uuid,
  creator_entity_id uuid,
  region_id uuid,
  region_name text,
  platform public.creator_platform,
  platform_user_id text,
  platform_account text,
  creator_name text,
  creator_type public.creator_type,
  manager_employee_id uuid,
  manager_name text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    cp.id,
    cp.creator_entity_id,
    cp.region_id,
    r.name,
    cp.platform,
    cp.platform_user_id,
    cp.platform_account,
    cp.creator_name,
    cp.creator_type,
    cp.manager_employee_id,
    coalesce(e.nickname, e.full_name)
  from public.creator_profiles cp
  join public.creator_entities entity
    on entity.id = cp.creator_entity_id
   and entity.status = 'active'
  left join public.regions r on r.id = cp.region_id
  left join public.employees e on e.id = cp.manager_employee_id
  where public.current_user_has_permission('agent-design-requests', 'use')
    and public.current_user_can_access_region(cp.region_id)
    and cp.status = 'active'
  order by cp.creator_name;
$$;

create or replace function public.list_personal_manager_creator_profiles(
  p_status text default 'active'
)
returns table (
  id uuid, creator_entity_id uuid, joined_date date, platform public.creator_platform,
  platform_user_id text, platform_account text, platform_public_id text, region_id uuid,
  region_code text, region_name text, creator_name text, scout_employee_id uuid,
  scout_profile_id uuid, scout_full_name text, scout_nickname text, manager_employee_id uuid,
  manager_full_name text, manager_nickname text, secondary_manager_employee_id uuid,
  secondary_manager_display_name text, creator_type public.creator_type, status text,
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
    creator.status,
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
    and public.current_user_has_permission('agent-creator-data', 'view')
    and public.current_user_can_access_region(creator.region_id)
    and (coalesce(nullif(btrim(p_status), ''), 'active') = 'all'
      or creator.status::text = coalesce(nullif(btrim(p_status), ''), 'active'))
    and (
      creator.manager_employee_id = public.current_user_employee_id()
      or exists (
        select 1
        from public.creator_collaborator_assignments collaborator
        where collaborator.creator_entity_id = creator.creator_entity_id
          and collaborator.assignment_type = 'manager'
          and collaborator.assignment_role = 'secondary'
          and collaborator.employee_id = public.current_user_employee_id()
          and collaborator.status = 'active'
      )
    )
  order by creator.joined_date desc, creator.id;
$$;

revoke all on function public.require_active_creator_entity_for_current_action(uuid) from public, anon, authenticated;
revoke all on function public.prevent_current_designer_request_for_inactive_entity() from public, anon, authenticated;
revoke all on function public.prevent_current_creator_activity_for_inactive_entity() from public, anon, authenticated;
revoke all on function public.prevent_current_creator_milestone_for_inactive_entity() from public, anon, authenticated;
revoke all on function public.list_designer_request_creators() from public, anon;
grant execute on function public.list_designer_request_creators() to authenticated;

commit;
