create or replace function public.is_onboarding_scout_employee(p_employee_id uuid)
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
      and e.status in ('active', 'probation')
      and e.profile_id is not null
      and p.status = 'approved'
      and jt.is_active = true
      and jt.name in ('TALENT SCOUT', 'TALENT SCOUT LEAD')
  );
$$;

revoke all on function public.is_onboarding_scout_employee(uuid) from public;
