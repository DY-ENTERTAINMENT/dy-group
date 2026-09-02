create or replace function public.update_creator_entity_shared_profile_data(
  p_creator_entity_id uuid,
  p_display_name text,
  p_region_id uuid,
  p_scout_employee_id uuid,
  p_manager_employee_id uuid,
  p_registration_type text,
  p_guild_joined_date date,
  p_bank_account_name text,
  p_bank_name text,
  p_bank_account text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_profile_id uuid := auth.uid();
  v_current_region_id uuid;
  v_scout_profile_id uuid;
  v_display_name text := nullif(btrim(coalesce(p_display_name, '')), '');
  v_bank_account_name text := nullif(btrim(coalesce(p_bank_account_name, '')), '');
  v_bank_name text := nullif(btrim(coalesce(p_bank_name, '')), '');
  v_bank_account text := nullif(btrim(coalesce(p_bank_account, '')), '');
begin
  if v_actor_profile_id is null then
    raise exception 'Authentication is required.';
  end if;

  if not public.current_user_has_permission('management-streamer-stats', 'use') then
    raise exception 'Permission denied.';
  end if;

  select entity.region_id
  into v_current_region_id
  from public.creator_entities entity
  where entity.id = p_creator_entity_id
  for update;

  if not found then
    raise exception 'Creator entity not found.';
  end if;

  if v_current_region_id is null or not public.current_user_can_access_region(v_current_region_id) then
    raise exception 'Current region access denied.';
  end if;

  if v_display_name is null then
    raise exception 'Display name is required.';
  end if;

  if p_region_id is null or not public.current_user_can_access_region(p_region_id) then
    raise exception 'Target region access denied.';
  end if;

  if p_registration_type not in ('new_onboarding', 'existing_creator') then
    raise exception 'Invalid registration type.';
  end if;

  if p_guild_joined_date is null then
    raise exception 'Guild joined date is required.';
  end if;

  select employee.profile_id
  into v_scout_profile_id
  from public.employees employee
  where employee.id = p_scout_employee_id
    and employee.region_id = p_region_id;

  if v_scout_profile_id is null then
    raise exception 'Invalid scout employee for selected region.';
  end if;

  if p_registration_type = 'existing_creator' then
    if not public.is_historical_onboarding_scout_employee(p_scout_employee_id) then
      raise exception 'Invalid historical scout employee for selected region.';
    end if;
  elsif not public.is_onboarding_scout_employee(p_scout_employee_id) then
    raise exception 'Invalid scout employee for selected region.';
  end if;

  if not exists (
    select 1
    from public.employees employee
    where employee.id = p_manager_employee_id
      and employee.region_id = p_region_id
      and public.is_onboarding_manager_employee(employee.id)
  ) then
    raise exception 'Invalid manager employee for selected region.';
  end if;

  update public.creator_entities
  set display_name = v_display_name,
      region_id = p_region_id,
      scout_employee_id = p_scout_employee_id,
      scout_profile_id = v_scout_profile_id,
      manager_employee_id = p_manager_employee_id,
      registration_type = p_registration_type,
      guild_joined_date = p_guild_joined_date,
      updated_by = v_actor_profile_id
  where id = p_creator_entity_id;

  update public.creator_profiles
  set creator_name = v_display_name,
      region_id = p_region_id,
      scout_employee_id = p_scout_employee_id,
      scout_profile_id = v_scout_profile_id,
      manager_employee_id = p_manager_employee_id,
      bank_account_name = v_bank_account_name,
      bank_name = v_bank_name,
      bank_account = v_bank_account
  where creator_entity_id = p_creator_entity_id
    and status = 'active'
    and membership_status = 'active';
end;
$$;

revoke all on function public.update_creator_entity_shared_profile_data(uuid, text, uuid, uuid, uuid, text, date, text, text, text) from public;
grant execute on function public.update_creator_entity_shared_profile_data(uuid, text, uuid, uuid, uuid, text, date, text, text, text) to authenticated;
