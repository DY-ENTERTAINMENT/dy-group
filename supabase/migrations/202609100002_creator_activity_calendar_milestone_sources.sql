create or replace function public.list_creator_activity_calendar_milestone_sources()
returns table(
  creator_entity_id uuid,
  creator_name text,
  guild_joined_date date,
  birthday date,
  manager_employee_id uuid,
  manager_name text,
  region_id uuid,
  platforms text[],
  joined_dates date[]
)
language sql stable security definer set search_path = public, pg_temp as $$
  select e.id, e.display_name, e.guild_joined_date, e.birthday, e.manager_employee_id,
    coalesce(nullif(btrim(manager.nickname), ''), manager.full_name), e.region_id,
    array_agg(distinct profile.platform::text order by profile.platform::text),
    array_agg(profile.joined_date order by profile.joined_date, profile.id) filter (where profile.joined_date is not null)
  from public.creator_entities e
  join public.creator_profiles profile on profile.creator_entity_id = e.id and profile.status = 'active' and profile.membership_status = 'active'
  left join public.employees manager on manager.id = e.manager_employee_id
  where auth.uid() is not null
    and public.current_user_has_permission('agent-creator-activity-calendar', 'view')
    and public.current_user_can_access_region(e.region_id)
  group by e.id, e.display_name, e.guild_joined_date, e.birthday, e.manager_employee_id, manager.nickname, manager.full_name, e.region_id
  order by e.display_name, e.id;
$$;

revoke all on function public.list_creator_activity_calendar_milestone_sources() from public, anon;
grant execute on function public.list_creator_activity_calendar_milestone_sources() to authenticated;
