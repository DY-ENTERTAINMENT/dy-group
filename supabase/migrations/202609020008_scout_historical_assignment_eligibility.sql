create or replace function public.is_historical_onboarding_scout_employee(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.employees e
    join public.profiles p on p.id = e.profile_id
    join public.job_titles jt on jt.id = e.job_title_id
    where e.id = p_employee_id
      and e.deleted_at is null
      and e.status in ('active', 'probation', 'left')
      and e.profile_id is not null
      and p.status = 'approved'
      and jt.is_active = true
      and (
        jt.name in ('TALENT SCOUT', 'TALENT SCOUT LEAD')
        or (
          not exists (
            select 1
            from public.employee_permission_overrides denied_override
            where denied_override.employee_id = e.id
              and denied_override.permission_key = 'scout-assignment-eligible'
              and denied_override.effect = 'deny'
          )
          and exists (
            select 1
            from public.employee_permission_overrides granted_override
            where granted_override.employee_id = e.id
              and granted_override.permission_key = 'scout-assignment-eligible'
              and granted_override.effect = 'grant'
              and granted_override.can_view = true
              and granted_override.can_use = true
          )
        )
      )
  );
$$;

revoke all on function public.is_historical_onboarding_scout_employee(uuid) from public;

create or replace function public.get_scout_onboarding_scout_options(p_registration_type text)
returns table (employee_id uuid, display_name text, region_id uuid, employee_status public.employee_status)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.id, coalesce(nullif(btrim(e.nickname), ''), e.full_name), e.region_id, e.status
  from public.employees e
  where p_registration_type in ('new_onboarding', 'existing_creator')
    and public.current_user_has_permission('scout-onboarding', 'use')
    and e.region_id is not null
    and public.current_user_can_access_region(e.region_id)
    and case
      when p_registration_type = 'existing_creator' then public.is_historical_onboarding_scout_employee(e.id)
      else public.is_onboarding_scout_employee(e.id)
    end
  order by coalesce(nullif(btrim(e.nickname), ''), e.full_name), e.id;
$$;

revoke all on function public.get_scout_onboarding_scout_options(text) from public;
grant execute on function public.get_scout_onboarding_scout_options(text) to authenticated;

create or replace function public.get_creator_collaborator_options(
  p_assignment_type text,
  p_region_id uuid,
  p_registration_type text
)
returns table (employee_id uuid, display_name text, region_id uuid, employee_status public.employee_status)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.id, coalesce(nullif(btrim(e.nickname), ''), e.full_name), e.region_id, e.status
  from public.employees e
  where p_assignment_type in ('scout', 'manager')
    and p_registration_type in ('new_onboarding', 'existing_creator')
    and (public.current_user_has_permission('scout-onboarding', 'use') or public.current_user_has_permission('management-streamer-stats', 'use'))
    and e.region_id is not null
    and public.current_user_can_access_region(e.region_id)
    and (p_region_id is null or e.region_id = p_region_id)
    and case
      when p_assignment_type = 'scout' and p_registration_type = 'existing_creator' then public.is_historical_onboarding_scout_employee(e.id)
      when p_assignment_type = 'scout' then public.is_onboarding_scout_employee(e.id)
      else public.is_onboarding_manager_employee(e.id)
    end
  order by coalesce(nullif(btrim(e.nickname), ''), e.full_name), e.id;
$$;

revoke all on function public.get_creator_collaborator_options(text, uuid, text) from public;
grant execute on function public.get_creator_collaborator_options(text, uuid, text) to authenticated;

create or replace function public.create_creator_entity_with_platforms(
  p_display_name text,
  p_region_id uuid,
  p_scout_employee_id uuid,
  p_manager_employee_id uuid,
  p_platforms jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_profile_id uuid := auth.uid();
  v_entity_id uuid;
  v_scout_profile_id uuid;
  v_platform_count integer;
  v_item jsonb;
  v_platform text;
  v_seen_platforms text[] := array[]::text[];
  v_joined_date date;
  v_platform_user_id text;
  v_platform_account text;
  v_platform_public_id text;
  v_creator_name text;
  v_creator_type text;
  v_bank_account_name text;
  v_bank_name text;
  v_bank_account text;
  v_registration_type text;
  v_item_registration_type text;
  v_guild_joined_date date;
  v_item_guild_joined_date date;
begin
  if v_actor_profile_id is null then raise exception 'Authentication is required.'; end if;
  if not (public.current_user_has_permission('scout-onboarding', 'use') or public.current_user_has_permission('management-streamer-stats', 'use')) then raise exception 'Permission denied.'; end if;
  if nullif(btrim(coalesce(p_display_name, '')), '') is null then raise exception 'Display name is required.'; end if;
  if p_region_id is null then raise exception 'Region is required.'; end if;
  if not public.current_user_can_access_region(p_region_id) then raise exception 'Region access denied.'; end if;
  if p_scout_employee_id is null then raise exception 'Scout employee is required.'; end if;
  if p_manager_employee_id is null then raise exception 'Manager employee is required.'; end if;
  if not exists (select 1 from public.employees e join public.profiles p on p.id = e.profile_id where e.id = p_manager_employee_id and e.deleted_at is null and e.status in ('active', 'probation') and p.status = 'approved') then raise exception 'Invalid manager employee.'; end if;
  if p_platforms is null or jsonb_typeof(p_platforms) <> 'array' then raise exception 'Platforms must be an array.'; end if;
  v_platform_count := jsonb_array_length(p_platforms);
  if v_platform_count < 1 or v_platform_count > 2 then raise exception 'Platforms must contain one or two entries.'; end if;

  for v_item in select value from jsonb_array_elements(p_platforms) loop
    v_platform := v_item ->> 'platform';
    v_joined_date := nullif(btrim(coalesce(v_item ->> 'joined_date', '')), '')::date;
    v_platform_user_id := nullif(btrim(coalesce(v_item ->> 'platform_user_id', '')), '');
    v_platform_account := nullif(btrim(coalesce(v_item ->> 'platform_account', '')), '');
    v_platform_public_id := nullif(btrim(coalesce(v_item ->> 'platform_public_id', '')), '');
    v_creator_name := nullif(btrim(coalesce(v_item ->> 'creator_name', '')), '');
    v_creator_type := v_item ->> 'creator_type';
    v_bank_account_name := nullif(btrim(coalesce(v_item ->> 'bank_account_name', '')), '');
    v_bank_name := nullif(btrim(coalesce(v_item ->> 'bank_name', '')), '');
    v_bank_account := nullif(btrim(coalesce(v_item ->> 'bank_account', '')), '');
    v_item_registration_type := nullif(btrim(coalesce(v_item ->> 'registration_type', '')), '');
    v_item_guild_joined_date := nullif(btrim(coalesce(v_item ->> 'guild_joined_date', '')), '')::date;

    if v_platform not in ('tiktok', 'douyin') or v_platform = any(v_seen_platforms) then raise exception 'Invalid or duplicate platform.'; end if;
    v_seen_platforms := array_append(v_seen_platforms, v_platform);
    if v_joined_date is null or v_platform_user_id is null or v_platform_account is null or v_platform_public_id is null or v_creator_name is null then raise exception 'Platform details are required for %.', v_platform; end if;
    if v_creator_type not in ('5+1', 'online', 'offline', 'company') then raise exception 'Invalid creator type for platform %.', v_platform; end if;
    if v_bank_account_name is null or v_bank_name is null or v_bank_account is null then raise exception 'Bank account name, bank name, and bank account are required for platform %.', v_platform; end if;
    if v_item_registration_type is null or v_item_registration_type not in ('new_onboarding', 'existing_creator') or v_item_guild_joined_date is null then raise exception 'Registration type and guild joined date are required.'; end if;
    if v_registration_type is null then
      v_registration_type := v_item_registration_type;
      v_guild_joined_date := v_item_guild_joined_date;
    elsif v_registration_type is distinct from v_item_registration_type or v_guild_joined_date is distinct from v_item_guild_joined_date then
      raise exception 'Platform registration metadata must match.';
    end if;
  end loop;

  select e.profile_id into v_scout_profile_id from public.employees e where e.id = p_scout_employee_id and e.region_id = p_region_id;
  if v_scout_profile_id is null then raise exception 'Invalid scout employee for selected region.'; end if;
  if v_registration_type = 'existing_creator' then
    if not public.is_historical_onboarding_scout_employee(p_scout_employee_id) then raise exception 'Invalid historical scout employee for selected region.'; end if;
  elsif not public.is_onboarding_scout_employee(p_scout_employee_id) then
    raise exception 'Invalid scout employee for selected region.';
  end if;

  insert into public.creator_entities (display_name, region_id, scout_employee_id, scout_profile_id, manager_employee_id, registration_type, guild_joined_date)
  values (btrim(p_display_name), p_region_id, p_scout_employee_id, v_scout_profile_id, p_manager_employee_id, v_registration_type, v_guild_joined_date)
  returning id into v_entity_id;

  for v_item in select value from jsonb_array_elements(p_platforms) loop
    insert into public.creator_profiles (creator_entity_id, membership_status, joined_date, platform, platform_user_id, platform_account, platform_public_id, region_id, creator_name, scout_employee_id, scout_profile_id, manager_employee_id, creator_type, bank_account_name, bank_name, bank_account)
    values (v_entity_id, 'active', (v_item ->> 'joined_date')::date, (v_item ->> 'platform')::public.creator_platform,
      btrim(v_item ->> 'platform_user_id'), btrim(v_item ->> 'platform_account'), nullif(btrim(v_item ->> 'platform_public_id'), ''), p_region_id, btrim(v_item ->> 'creator_name'),
      p_scout_employee_id, v_scout_profile_id, p_manager_employee_id, (v_item ->> 'creator_type')::public.creator_type,
      nullif(btrim(v_item ->> 'bank_account_name'), ''), nullif(btrim(v_item ->> 'bank_name'), ''), nullif(btrim(v_item ->> 'bank_account'), ''));
  end loop;
  return v_entity_id;
end;
$$;

create or replace function public.create_creator_entity_with_platforms(
  p_display_name text,
  p_region_id uuid,
  p_scout_employee_id uuid,
  p_manager_employee_id uuid,
  p_platforms jsonb,
  p_secondary_scout_employee_id uuid,
  p_secondary_manager_employee_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entity_id uuid;
  v_registration_type text;
begin
  select public.create_creator_entity_with_platforms(p_display_name, p_region_id, p_scout_employee_id, p_manager_employee_id, p_platforms) into v_entity_id;
  v_registration_type := nullif(btrim(coalesce(p_platforms -> 0 ->> 'registration_type', '')), '');

  if p_secondary_scout_employee_id is not null then
    if p_secondary_scout_employee_id = p_scout_employee_id then raise exception 'Secondary scout cannot be the primary scout.'; end if;
    if not exists (select 1 from public.employees e where e.id = p_secondary_scout_employee_id and e.region_id = p_region_id) then
      raise exception 'Invalid secondary scout employee for selected region.';
    end if;
    if v_registration_type = 'existing_creator' then
      if not public.is_historical_onboarding_scout_employee(p_secondary_scout_employee_id) then raise exception 'Invalid historical secondary scout employee for selected region.'; end if;
    elsif not public.is_onboarding_scout_employee(p_secondary_scout_employee_id) then
      raise exception 'Invalid secondary scout employee for selected region.';
    end if;
    insert into public.creator_collaborator_assignments (creator_entity_id, assignment_type, employee_id)
    values (v_entity_id, 'scout', p_secondary_scout_employee_id);
  end if;

  if p_secondary_manager_employee_id is not null then
    if p_secondary_manager_employee_id = p_manager_employee_id then raise exception 'Secondary manager cannot be the primary manager.'; end if;
    if not exists (select 1 from public.employees e where e.id = p_secondary_manager_employee_id and e.region_id = p_region_id) or not public.is_onboarding_manager_employee(p_secondary_manager_employee_id) then
      raise exception 'Invalid secondary manager employee for selected region.';
    end if;
    insert into public.creator_collaborator_assignments (creator_entity_id, assignment_type, employee_id)
    values (v_entity_id, 'manager', p_secondary_manager_employee_id);
  end if;

  return v_entity_id;
end;
$$;
