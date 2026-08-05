create or replace function public.get_scout_onboarding_manager_options()
returns table (
  employee_id uuid,
  display_name text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    e.id as employee_id,
    coalesce(nullif(btrim(e.nickname), ''), e.full_name) as display_name
  from public.employees e
  join public.profiles p
    on p.id = e.profile_id
  where (
      public.current_user_has_permission('scout-onboarding', 'use')
      or public.current_user_has_permission('management-streamer-stats', 'use')
    )
    and e.deleted_at is null
    and e.status in ('active', 'probation')
    and p.status = 'approved'
  order by
    coalesce(nullif(btrim(e.nickname), ''), e.full_name),
    e.id;
$$;

revoke all on function public.get_scout_onboarding_manager_options() from public;
grant execute on function public.get_scout_onboarding_manager_options() to authenticated;
