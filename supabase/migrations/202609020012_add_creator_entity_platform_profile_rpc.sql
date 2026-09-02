create or replace function public.add_creator_entity_platform_profile(
  p_creator_entity_id uuid,
  p_platform text,
  p_joined_date date,
  p_platform_user_id text,
  p_platform_account text,
  p_platform_public_id text,
  p_creator_type text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_profile_id uuid := auth.uid();
  v_entity public.creator_entities;
  v_source_profile public.creator_profiles;
  v_profile_id uuid;
  v_platform public.creator_platform;
  v_joined_date date := p_joined_date;
  v_platform_user_id text := nullif(btrim(coalesce(p_platform_user_id, '')), '');
  v_platform_account text := nullif(btrim(coalesce(p_platform_account, '')), '');
  v_platform_public_id text := nullif(btrim(coalesce(p_platform_public_id, '')), '');
  v_creator_type public.creator_type;
  v_active_platform_count integer;
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

  if p_platform not in ('tiktok', 'douyin') then
    raise exception 'Invalid platform.';
  end if;
  v_platform := p_platform::public.creator_platform;

  if v_joined_date is null then
    raise exception 'Joined date is required.';
  end if;
  if v_platform_user_id is null then
    raise exception 'Platform user id is required.';
  end if;
  if v_platform_account is null then
    raise exception 'Platform account is required.';
  end if;
  if v_platform_public_id is null then
    raise exception 'Platform public id is required.';
  end if;
  if p_creator_type not in ('5+1', 'online', 'offline', 'company') then
    raise exception 'Invalid creator type.';
  end if;
  v_creator_type := p_creator_type::public.creator_type;

  select count(*)
  into v_active_platform_count
  from public.creator_profiles profile
  where profile.creator_entity_id = p_creator_entity_id
    and profile.membership_status = 'active';

  if v_active_platform_count <> 1 then
    raise exception 'Creator entity must have exactly one active platform before adding another.';
  end if;

  if exists (
    select 1
    from public.creator_profiles profile
    where profile.creator_entity_id = p_creator_entity_id
      and profile.platform = v_platform
      and profile.membership_status = 'active'
  ) then
    raise exception 'Creator entity already has an active % profile.', p_platform;
  end if;

  if exists (
    select 1
    from public.creator_profiles profile
    where profile.platform = v_platform
      and profile.platform_user_id = v_platform_user_id
  ) then
    raise exception 'Platform user id is already in use for this platform.';
  end if;

  if exists (
    select 1
    from public.creator_profiles profile
    where profile.platform = v_platform
      and profile.platform_public_id = v_platform_public_id
  ) then
    if v_platform = 'tiktok' then
      raise exception '该 TikTok User ID 已存在，请确认主播资料';
    end if;
    raise exception '该抖音号已存在，请确认主播资料';
  end if;

  select *
  into v_source_profile
  from public.creator_profiles profile
  where profile.creator_entity_id = p_creator_entity_id
    and profile.membership_status = 'active'
  order by profile.created_at
  limit 1;

  insert into public.creator_profiles (
    creator_entity_id,
    membership_status,
    joined_date,
    platform,
    platform_user_id,
    platform_account,
    platform_public_id,
    region_id,
    creator_name,
    scout_employee_id,
    scout_profile_id,
    manager_employee_id,
    creator_type,
    bank_account_name,
    bank_name,
    bank_account
  )
  values (
    v_entity.id,
    'active',
    v_joined_date,
    v_platform,
    v_platform_user_id,
    v_platform_account,
    v_platform_public_id,
    v_entity.region_id,
    v_entity.display_name,
    v_entity.scout_employee_id,
    v_entity.scout_profile_id,
    v_entity.manager_employee_id,
    v_creator_type,
    v_source_profile.bank_account_name,
    v_source_profile.bank_name,
    v_source_profile.bank_account
  )
  returning id into v_profile_id;

  return v_profile_id;
end;
$$;

revoke all on function public.add_creator_entity_platform_profile(uuid, text, date, text, text, text, text) from public;
grant execute on function public.add_creator_entity_platform_profile(uuid, text, date, text, text, text, text) to authenticated;
