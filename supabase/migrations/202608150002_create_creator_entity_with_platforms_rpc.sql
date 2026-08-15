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
  v_creator_name text;
  v_creator_type text;
  v_bank_name text;
  v_bank_account text;
begin
  if v_actor_profile_id is null then
    raise exception 'Authentication is required.';
  end if;

  if not (
    public.current_user_has_permission('scout-onboarding', 'use')
    or public.current_user_has_permission('management-streamer-stats', 'use')
  ) then
    raise exception 'Permission denied.';
  end if;

  if nullif(btrim(coalesce(p_display_name, '')), '') is null then
    raise exception 'Display name is required.';
  end if;

  if p_region_id is null then
    raise exception 'Region is required.';
  end if;

  if not public.current_user_can_access_region(p_region_id) then
    raise exception 'Region access denied.';
  end if;

  if p_scout_employee_id is null then
    raise exception 'Scout employee is required.';
  end if;

  if p_manager_employee_id is null then
    raise exception 'Manager employee is required.';
  end if;

  select e.profile_id
  into v_scout_profile_id
  from public.employees e
  where e.id = p_scout_employee_id
    and e.deleted_at is null
    and e.status in ('active', 'probation')
    and e.region_id = p_region_id
    and e.profile_id is not null
  limit 1;

  if v_scout_profile_id is null then
    raise exception 'Invalid scout employee for selected region.';
  end if;

  if not exists (
    select 1
    from public.employees e
    join public.profiles p
      on p.id = e.profile_id
    where e.id = p_manager_employee_id
      and e.deleted_at is null
      and e.status in ('active', 'probation')
      and p.status = 'approved'
  ) then
    raise exception 'Invalid manager employee.';
  end if;

  if p_platforms is null or jsonb_typeof(p_platforms) <> 'array' then
    raise exception 'Platforms must be an array.';
  end if;

  v_platform_count := jsonb_array_length(p_platforms);

  if v_platform_count < 1 or v_platform_count > 2 then
    raise exception 'Platforms must contain one or two entries.';
  end if;

  for v_item in
    select value from jsonb_array_elements(p_platforms)
  loop
    v_platform := v_item ->> 'platform';
    v_joined_date := nullif(btrim(coalesce(v_item ->> 'joined_date', '')), '')::date;
    v_platform_user_id := nullif(btrim(coalesce(v_item ->> 'platform_user_id', '')), '');
    v_platform_account := nullif(btrim(coalesce(v_item ->> 'platform_account', '')), '');
    v_creator_name := nullif(btrim(coalesce(v_item ->> 'creator_name', '')), '');
    v_creator_type := v_item ->> 'creator_type';
    v_bank_name := nullif(btrim(coalesce(v_item ->> 'bank_name', '')), '');
    v_bank_account := nullif(btrim(coalesce(v_item ->> 'bank_account', '')), '');

    if v_platform not in ('tiktok', 'douyin') then
      raise exception 'Invalid platform: %', coalesce(v_platform, '<null>');
    end if;

    if v_platform = any(v_seen_platforms) then
      raise exception 'Duplicate platform: %', v_platform;
    end if;

    v_seen_platforms := array_append(v_seen_platforms, v_platform);

    if v_joined_date is null then
      raise exception 'Joined date is required for platform %.', v_platform;
    end if;

    if v_platform_user_id is null then
      raise exception 'Platform user id is required for platform %.', v_platform;
    end if;

    if v_platform_account is null then
      raise exception 'Platform account is required for platform %.', v_platform;
    end if;

    if v_creator_name is null then
      raise exception 'Creator name is required for platform %.', v_platform;
    end if;

    if v_creator_type not in ('5+1', 'online', 'offline', 'company') then
      raise exception 'Invalid creator type for platform %: %', v_platform, coalesce(v_creator_type, '<null>');
    end if;

    if v_creator_type in ('5+1', 'company') and (v_bank_name is null or v_bank_account is null) then
      raise exception 'Bank name and bank account are required for % creator on platform %.', v_creator_type, v_platform;
    end if;
  end loop;

  insert into public.creator_entities (
    display_name,
    region_id,
    scout_employee_id,
    scout_profile_id,
    manager_employee_id
  )
  values (
    btrim(p_display_name),
    p_region_id,
    p_scout_employee_id,
    v_scout_profile_id,
    p_manager_employee_id
  )
  returning id into v_entity_id;

  for v_item in
    select value from jsonb_array_elements(p_platforms)
  loop
    v_platform := v_item ->> 'platform';
    v_joined_date := nullif(btrim(coalesce(v_item ->> 'joined_date', '')), '')::date;
    v_platform_user_id := nullif(btrim(coalesce(v_item ->> 'platform_user_id', '')), '');
    v_platform_account := nullif(btrim(coalesce(v_item ->> 'platform_account', '')), '');
    v_creator_name := nullif(btrim(coalesce(v_item ->> 'creator_name', '')), '');
    v_creator_type := v_item ->> 'creator_type';
    v_bank_name := nullif(btrim(coalesce(v_item ->> 'bank_name', '')), '');
    v_bank_account := nullif(btrim(coalesce(v_item ->> 'bank_account', '')), '');

    insert into public.creator_profiles (
      creator_entity_id,
      membership_status,
      joined_date,
      platform,
      platform_user_id,
      platform_account,
      region_id,
      creator_name,
      scout_employee_id,
      scout_profile_id,
      manager_employee_id,
      creator_type,
      bank_name,
      bank_account
    )
    values (
      v_entity_id,
      'active',
      v_joined_date,
      v_platform::public.creator_platform,
      v_platform_user_id,
      v_platform_account,
      p_region_id,
      v_creator_name,
      p_scout_employee_id,
      v_scout_profile_id,
      p_manager_employee_id,
      v_creator_type::public.creator_type,
      case when v_creator_type in ('5+1', 'company') then v_bank_name else null end,
      case when v_creator_type in ('5+1', 'company') then v_bank_account else null end
    );
  end loop;

  return v_entity_id;
end;
$$;

revoke all on function public.create_creator_entity_with_platforms(text, uuid, uuid, uuid, jsonb) from public;
grant execute on function public.create_creator_entity_with_platforms(text, uuid, uuid, uuid, jsonb) to authenticated;
