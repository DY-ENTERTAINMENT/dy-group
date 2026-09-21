begin;

create or replace function public.list_management_revenue_manager_options()
returns table (
  id uuid,
  full_name text,
  nickname text,
  email text,
  region_id uuid,
  status public.employee_status,
  job_title_name text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.current_user_has_permission('management-revenue-data', 'view') then
    raise exception 'Permission denied.';
  end if;

  return query
  select
    employee.id,
    employee.full_name,
    employee.nickname,
    employee.email,
    employee.region_id,
    employee.status,
    job_title.name
  from public.employees employee
  join public.job_titles job_title on job_title.id = employee.job_title_id
  where employee.deleted_at is null
    and employee.status in ('active', 'probation')
    and job_title.name in ('TALENT AGENT', 'TALENT AGENT LEAD')
    and public.current_user_can_access_region(employee.region_id)
  order by employee.full_name, employee.id;
end;
$$;

revoke all on function public.list_management_revenue_manager_options() from public;
grant execute on function public.list_management_revenue_manager_options() to authenticated;

commit;
