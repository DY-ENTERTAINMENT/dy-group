create or replace function public.get_management_scout_workload_stats(
  p_month text,
  p_region_id uuid default null,
  p_granularity text default 'monthly'
)
returns table (
  period_start date,
  period_end date,
  period_label text,
  scout_employee_id uuid,
  scout_profile_id uuid,
  scout_name text,
  region_id uuid,
  region_code text,
  contacted_count bigint,
  replied_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  month_start date;
  month_end date;
begin
  if p_month is null or p_month !~ '^\d{4}-\d{2}$' then
    raise exception 'Invalid month format: %', p_month;
  end if;

  if p_granularity is null or p_granularity not in ('daily', 'weekly', 'monthly') then
    raise exception 'Invalid workload granularity: %', p_granularity;
  end if;

  if not public.current_user_has_permission('management-recruiting-data', 'view') then
    raise exception 'Permission denied.';
  end if;

  month_start := to_date(p_month || '-01', 'YYYY-MM-DD');
  month_end := (month_start + interval '1 month - 1 day')::date;

  if p_region_id is not null and not public.current_user_can_access_region(p_region_id) then
    raise exception 'Permission denied for selected region.';
  end if;

  return query
  with scoped_logs as (
    select
      case p_granularity
        when 'daily' then log.work_date
        when 'weekly' then date_trunc('week', log.work_date::timestamp)::date
        else month_start
      end as bucket_start,
      case p_granularity
        when 'daily' then log.work_date
        when 'weekly' then (date_trunc('week', log.work_date::timestamp)::date + 6)
        else month_end
      end as bucket_end,
      log.scout_employee_id,
      log.scout_profile_id,
      log.region_id,
      log.contacted_count,
      log.replied_count,
      employee.full_name,
      employee.nickname,
      region.code as region_code
    from public.scout_daily_work_logs log
    left join public.employees employee
      on employee.id = log.scout_employee_id
    left join public.regions region
      on region.id = log.region_id
    where log.work_date between month_start and month_end
      and (p_region_id is null or log.region_id = p_region_id)
      and public.current_user_can_access_region(log.region_id)
  )
  select
    scoped_logs.bucket_start as period_start,
    scoped_logs.bucket_end as period_end,
    case p_granularity
      when 'daily' then to_char(scoped_logs.bucket_start, 'YYYY-MM-DD')
      when 'weekly' then to_char(scoped_logs.bucket_start, 'YYYY-MM-DD') || ' - ' || to_char(scoped_logs.bucket_end, 'YYYY-MM-DD')
      else to_char(scoped_logs.bucket_start, 'YYYY-MM')
    end as period_label,
    scoped_logs.scout_employee_id,
    scoped_logs.scout_profile_id,
    coalesce(nullif(btrim(scoped_logs.nickname), ''), scoped_logs.full_name, 'Unknown scout') as scout_name,
    scoped_logs.region_id,
    scoped_logs.region_code,
    sum(scoped_logs.contacted_count)::bigint as contacted_count,
    sum(scoped_logs.replied_count)::bigint as replied_count
  from scoped_logs
  group by
    scoped_logs.bucket_start,
    scoped_logs.bucket_end,
    scoped_logs.scout_employee_id,
    scoped_logs.scout_profile_id,
    scoped_logs.region_id,
    scoped_logs.region_code,
    coalesce(nullif(btrim(scoped_logs.nickname), ''), scoped_logs.full_name, 'Unknown scout')
  order by scoped_logs.bucket_start desc, scout_name asc;
end;
$$;

revoke all on function public.get_management_scout_workload_stats(text, uuid, text) from public;
grant execute on function public.get_management_scout_workload_stats(text, uuid, text) to authenticated;
