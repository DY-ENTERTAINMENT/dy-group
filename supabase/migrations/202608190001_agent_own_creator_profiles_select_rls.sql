drop policy if exists "Users can read scoped creator profiles" on public.creator_profiles;

create policy "Users can read scoped creator profiles"
on public.creator_profiles for select
to authenticated
using (
  (
    scout_profile_id = auth.uid()
    and (
      public.current_user_has_permission('scout-recruiting-data', 'view')
      or public.current_user_has_permission('scout-streamer-stats', 'view')
    )
  )
  or (
    public.current_user_has_permission('management-streamer-stats', 'view')
    and public.current_user_can_access_region(region_id)
  )
  or (
    public.current_user_has_permission('management-recruiting-data', 'view')
    and public.current_user_can_access_region(region_id)
  )
  or (
    public.current_user_has_permission('agent-creator-data', 'view')
    and manager_employee_id = public.current_user_employee_id()
  )
);
