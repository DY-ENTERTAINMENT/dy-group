create or replace function public.get_visible_creator_manager_display_names()
returns table (
  creator_id uuid,
  manager_employee_id uuid,
  manager_display_name text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    cp.id as creator_id,
    cp.manager_employee_id,
    coalesce(nullif(btrim(e.nickname), ''), e.full_name) as manager_display_name
  from public.creator_profiles cp
  join public.employees e
    on e.id = cp.manager_employee_id
  where cp.manager_employee_id is not null
    and e.deleted_at is null
    and (
      (
        cp.scout_profile_id = auth.uid()
        and (
          public.current_user_has_permission('scout-recruiting-data', 'view')
          or public.current_user_has_permission('scout-streamer-stats', 'view')
        )
      )
      or (
        public.current_user_has_permission('management-streamer-stats', 'view')
        and public.current_user_can_access_region(cp.region_id)
      )
      or (
        public.current_user_has_permission('management-recruiting-data', 'view')
        and public.current_user_can_access_region(cp.region_id)
      )
    );
$$;

revoke all on function public.get_visible_creator_manager_display_names() from public;
grant execute on function public.get_visible_creator_manager_display_names() to authenticated;
