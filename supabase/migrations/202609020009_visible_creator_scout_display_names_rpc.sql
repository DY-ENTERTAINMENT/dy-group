create or replace function public.get_visible_creator_scout_display_names(
  p_creator_entity_ids uuid[] default '{}'::uuid[],
  p_creator_profile_ids uuid[] default '{}'::uuid[]
)
returns table (
  creator_entity_id uuid,
  creator_profile_id uuid,
  scout_employee_id uuid,
  scout_display_name text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with requested_entities as (
    select distinct entity_id
    from unnest(coalesce(p_creator_entity_ids, '{}'::uuid[])) as entity_id
  ),
  visible_entities as (
    select
      cp.creator_entity_id,
      array_agg(distinct cp.scout_employee_id) filter (where cp.scout_employee_id is not null) as scout_employee_ids
    from public.creator_profiles cp
    join requested_entities requested on requested.entity_id = cp.creator_entity_id
    where auth.uid() is not null
      and public.current_user_has_permission('management-streamer-stats', 'view')
    group by cp.creator_entity_id
    having bool_and(coalesce(public.current_user_can_access_region(cp.region_id), false))
  ),
  resolved_entities as (
    select
      creator_entity_id,
      case when cardinality(coalesce(scout_employee_ids, '{}'::uuid[])) = 1
        then scout_employee_ids[1]
        else null
      end as scout_employee_id
    from visible_entities
  ),
  visible_profiles as (
    select cp.id as creator_profile_id, cp.scout_employee_id
    from public.creator_profiles cp
    where cp.creator_entity_id is null
      and cp.id = any(coalesce(p_creator_profile_ids, '{}'::uuid[]))
      and auth.uid() is not null
      and public.current_user_has_permission('management-streamer-stats', 'view')
      and public.current_user_can_access_region(cp.region_id)
  )
  select
    entity.creator_entity_id,
    null::uuid as creator_profile_id,
    entity.scout_employee_id,
    coalesce(nullif(btrim(employee.nickname), ''), nullif(btrim(employee.full_name), '')) as scout_display_name
  from resolved_entities entity
  left join public.employees employee
    on employee.id = entity.scout_employee_id
   and employee.deleted_at is null

  union all

  select
    null::uuid as creator_entity_id,
    profile.creator_profile_id,
    profile.scout_employee_id,
    coalesce(nullif(btrim(employee.nickname), ''), nullif(btrim(employee.full_name), '')) as scout_display_name
  from visible_profiles profile
  left join public.employees employee
    on employee.id = profile.scout_employee_id
   and employee.deleted_at is null;
$$;

revoke all on function public.get_visible_creator_scout_display_names(uuid[], uuid[]) from public;
grant execute on function public.get_visible_creator_scout_display_names(uuid[], uuid[]) to authenticated;
