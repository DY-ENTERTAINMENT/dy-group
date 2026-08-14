alter table public.scout_daily_work_logs
add column if not exists note text null;

drop function if exists public.upsert_scout_daily_work_log(date, integer, integer);

create or replace function public.upsert_scout_daily_work_log(
  p_work_date date,
  p_contacted_count integer,
  p_replied_count integer,
  p_note text default null
)
returns public.scout_daily_work_logs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_employee public.employees;
  target_log public.scout_daily_work_logs;
  today_kl date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  if not public.current_user_has_permission('scout-recruiting-data', 'use') then
    raise exception 'Permission denied.';
  end if;

  if p_work_date < today_kl - 1 or p_work_date > today_kl then
    raise exception 'Daily work logs can only be saved for today or yesterday.';
  end if;

  if p_contacted_count < 0 then
    raise exception 'Contacted count cannot be negative.';
  end if;

  if p_replied_count < 0 then
    raise exception 'Replied count cannot be negative.';
  end if;

  if p_replied_count > p_contacted_count then
    raise exception 'Replied count cannot be greater than contacted count.';
  end if;

  select *
  into current_employee
  from public.employees e
  where e.profile_id = auth.uid()
    and e.deleted_at is null
  limit 1;

  if current_employee.id is null then
    raise exception 'Current employee profile was not found.';
  end if;

  insert into public.scout_daily_work_logs (
    work_date,
    scout_profile_id,
    scout_employee_id,
    region_id,
    contacted_count,
    replied_count,
    note
  )
  values (
    p_work_date,
    auth.uid(),
    current_employee.id,
    current_employee.region_id,
    p_contacted_count,
    p_replied_count,
    nullif(btrim(coalesce(p_note, '')), '')
  )
  on conflict (scout_profile_id, work_date) do update
  set
    scout_employee_id = excluded.scout_employee_id,
    region_id = excluded.region_id,
    contacted_count = excluded.contacted_count,
    replied_count = excluded.replied_count,
    note = excluded.note
  returning * into target_log;

  return target_log;
end;
$$;

revoke all on function public.upsert_scout_daily_work_log(date, integer, integer, text) from public;
grant execute on function public.upsert_scout_daily_work_log(date, integer, integer, text) to authenticated;

drop function if exists public.get_management_scout_workload_stats(text, uuid, text);

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
  replied_count bigint,
  note text
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
      case p_granularity
        when 'daily' then log.note
        else null::text
      end as note,
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
    sum(scoped_logs.replied_count)::bigint as replied_count,
    case p_granularity
      when 'daily' then scoped_logs.note
      else null::text
    end as note
  from scoped_logs
  group by
    scoped_logs.bucket_start,
    scoped_logs.bucket_end,
    scoped_logs.scout_employee_id,
    scoped_logs.scout_profile_id,
    scoped_logs.region_id,
    scoped_logs.region_code,
    coalesce(nullif(btrim(scoped_logs.nickname), ''), scoped_logs.full_name, 'Unknown scout'),
    case p_granularity
      when 'daily' then scoped_logs.note
      else null::text
    end
  order by scoped_logs.bucket_start desc, scout_name asc;
end;
$$;

revoke all on function public.get_management_scout_workload_stats(text, uuid, text) from public;
grant execute on function public.get_management_scout_workload_stats(text, uuid, text) to authenticated;
