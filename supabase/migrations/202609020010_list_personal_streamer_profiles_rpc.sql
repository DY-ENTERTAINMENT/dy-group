create or replace function public.list_personal_streamer_profiles(
  p_status text default 'active'
)
returns table (
  id uuid,
  creator_entity_id uuid,
  registration_type text,
  guild_joined_date date,
  joined_date date,
  platform public.creator_platform,
  platform_user_id text,
  platform_account text,
  platform_public_id text,
  region_id uuid,
  region_code text,
  region_name text,
  creator_name text,
  scout_employee_id uuid,
  scout_profile_id uuid,
  scout_full_name text,
  scout_nickname text,
  manager_employee_id uuid,
  manager_full_name text,
  manager_nickname text,
  creator_type public.creator_type,
  status text,
  bank_account_name text,
  bank_name text,
  bank_account text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    creator.id,
    creator.creator_entity_id,
    entity.registration_type,
    entity.guild_joined_date,
    creator.joined_date,
    creator.platform,
    creator.platform_user_id,
    creator.platform_account,
    creator.platform_public_id,
    creator.region_id,
    region.code,
    region.name,
    creator.creator_name,
    creator.scout_employee_id,
    creator.scout_profile_id,
    scout.full_name,
    scout.nickname,
    creator.manager_employee_id,
    manager.full_name,
    manager.nickname,
    creator.creator_type,
    creator.status,
    creator.bank_account_name,
    creator.bank_name,
    creator.bank_account,
    creator.created_at,
    creator.updated_at
  from public.creator_profiles creator
  left join public.creator_entities entity on entity.id = creator.creator_entity_id
  left join public.regions region on region.id = creator.region_id
  left join public.employees scout on scout.id = creator.scout_employee_id
  left join public.employees manager on manager.id = creator.manager_employee_id
  where auth.uid() is not null
    and public.current_user_has_permission('scout-streamer-stats', 'view')
    and (coalesce(nullif(btrim(p_status), ''), 'active') = 'all' or creator.status::text = coalesce(nullif(btrim(p_status), ''), 'active'))
    and (
      creator.scout_profile_id = auth.uid()
      or exists (
        select 1
        from public.creator_collaborator_assignments collaborator
        where collaborator.assignment_type = 'scout'
          and collaborator.assignment_role = 'secondary'
          and collaborator.status = 'active'
          and collaborator.employee_id = public.current_user_employee_id()
          and public.current_user_can_access_region(creator.region_id)
          and (
            (collaborator.creator_entity_id is not null and collaborator.creator_entity_id = creator.creator_entity_id)
            or collaborator.creator_profile_id = creator.id
          )
      )
    )
  order by creator.joined_date desc, creator.id;
$$;

revoke all on function public.list_personal_streamer_profiles(text) from public;
grant execute on function public.list_personal_streamer_profiles(text) to authenticated;
