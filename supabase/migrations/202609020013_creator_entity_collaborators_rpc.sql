create or replace function public.get_creator_entity_collaborators(
  p_creator_entity_id uuid
)
returns table (
  assignment_type text,
  employee_id uuid,
  display_name text,
  employee_status public.employee_status
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_region_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  if not public.current_user_has_permission('management-streamer-stats', 'view') then
    raise exception 'Permission denied.';
  end if;

  select entity.region_id
  into v_region_id
  from public.creator_entities entity
  where entity.id = p_creator_entity_id;

  if not found then
    raise exception 'Creator entity not found.';
  end if;

  if v_region_id is null or not public.current_user_can_access_region(v_region_id) then
    raise exception 'Region access denied.';
  end if;

  return query
  select
    collaborator.assignment_type,
    employee.id,
    coalesce(nullif(btrim(employee.nickname), ''), employee.full_name),
    employee.status
  from public.creator_collaborator_assignments collaborator
  join public.employees employee on employee.id = collaborator.employee_id
  where collaborator.creator_entity_id = p_creator_entity_id
    and collaborator.assignment_role = 'secondary'
    and collaborator.assignment_type in ('scout', 'manager')
    and collaborator.status = 'active'
  order by collaborator.assignment_type;
end;
$$;

create or replace function public.update_creator_entity_collaborators(
  p_creator_entity_id uuid,
  p_secondary_scout_employee_id uuid,
  p_secondary_manager_employee_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_profile_id uuid := auth.uid();
  v_entity public.creator_entities;
  v_current_secondary_scout_employee_id uuid;
  v_current_secondary_manager_employee_id uuid;
begin
  if v_actor_profile_id is null then
    raise exception 'Authentication is required.';
  end if;

  if not public.current_user_has_permission('management-streamer-stats', 'use') then
    raise exception 'Permission denied.';
  end if;

  select *
  into v_entity
  from public.creator_entities entity
  where entity.id = p_creator_entity_id
  for update;

  if not found then
    raise exception 'Creator entity not found.';
  end if;

  if v_entity.region_id is null or not public.current_user_can_access_region(v_entity.region_id) then
    raise exception 'Region access denied.';
  end if;

  select collaborator.employee_id
  into v_current_secondary_scout_employee_id
  from public.creator_collaborator_assignments collaborator
  where collaborator.creator_entity_id = p_creator_entity_id
    and collaborator.assignment_type = 'scout'
    and collaborator.assignment_role = 'secondary'
    and collaborator.status = 'active'
  for update;

  select collaborator.employee_id
  into v_current_secondary_manager_employee_id
  from public.creator_collaborator_assignments collaborator
  where collaborator.creator_entity_id = p_creator_entity_id
    and collaborator.assignment_type = 'manager'
    and collaborator.assignment_role = 'secondary'
    and collaborator.status = 'active'
  for update;

  if p_secondary_scout_employee_id is not null and p_secondary_scout_employee_id = v_entity.scout_employee_id then
    raise exception 'Secondary scout cannot be the primary scout.';
  end if;

  if p_secondary_scout_employee_id is not null and p_secondary_scout_employee_id is distinct from v_current_secondary_scout_employee_id then
    if not exists (
      select 1
      from public.employees employee
      where employee.id = p_secondary_scout_employee_id
        and employee.region_id = v_entity.region_id
        and employee.status = 'active'
        and (
          (v_entity.registration_type = 'existing_creator' and public.is_historical_onboarding_scout_employee(employee.id))
          or (coalesce(v_entity.registration_type, 'new_onboarding') <> 'existing_creator' and public.is_onboarding_scout_employee(employee.id))
        )
    ) then
      raise exception 'Invalid secondary scout employee for selected region.';
    end if;
  end if;

  if p_secondary_manager_employee_id is not null and p_secondary_manager_employee_id = v_entity.manager_employee_id then
    raise exception 'Secondary manager cannot be the primary manager.';
  end if;

  if p_secondary_manager_employee_id is not null and p_secondary_manager_employee_id is distinct from v_current_secondary_manager_employee_id then
    if not exists (
      select 1
      from public.employees employee
      where employee.id = p_secondary_manager_employee_id
        and employee.region_id = v_entity.region_id
        and employee.status = 'active'
        and public.is_onboarding_manager_employee(employee.id)
    ) then
      raise exception 'Invalid secondary manager employee for selected region.';
    end if;
  end if;

  if p_secondary_scout_employee_id is distinct from v_current_secondary_scout_employee_id then
    update public.creator_collaborator_assignments
    set status = 'inactive',
        ended_at = now(),
        ended_by = v_actor_profile_id
    where creator_entity_id = p_creator_entity_id
      and assignment_type = 'scout'
      and assignment_role = 'secondary'
      and status = 'active';

    if p_secondary_scout_employee_id is not null then
      insert into public.creator_collaborator_assignments (creator_entity_id, assignment_type, employee_id)
      values (p_creator_entity_id, 'scout', p_secondary_scout_employee_id);
    end if;
  end if;

  if p_secondary_manager_employee_id is distinct from v_current_secondary_manager_employee_id then
    update public.creator_collaborator_assignments
    set status = 'inactive',
        ended_at = now(),
        ended_by = v_actor_profile_id
    where creator_entity_id = p_creator_entity_id
      and assignment_type = 'manager'
      and assignment_role = 'secondary'
      and status = 'active';

    if p_secondary_manager_employee_id is not null then
      insert into public.creator_collaborator_assignments (creator_entity_id, assignment_type, employee_id)
      values (p_creator_entity_id, 'manager', p_secondary_manager_employee_id);
    end if;
  end if;
end;
$$;

revoke all on function public.get_creator_entity_collaborators(uuid) from public;
grant execute on function public.get_creator_entity_collaborators(uuid) to authenticated;

revoke all on function public.update_creator_entity_collaborators(uuid, uuid, uuid) from public;
grant execute on function public.update_creator_entity_collaborators(uuid, uuid, uuid) to authenticated;
