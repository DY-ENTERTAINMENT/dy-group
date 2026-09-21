-- Keep daily work logs as the only workload source while adding actor attribution
-- and narrowly-scoped management backfill APIs.
alter table public.scout_daily_work_logs
  add column if not exists created_by uuid references public.profiles(id) on delete set null,
  add column if not exists updated_by uuid references public.profiles(id) on delete set null;

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
  current_week_start date := date_trunc('week', today_kl::timestamp)::date;
  previous_week_start date := current_week_start - 7;
begin
  if auth.uid() is null then raise exception 'Authentication is required.'; end if;
  if not public.current_user_has_permission('scout-recruiting-data', 'use') then raise exception 'Permission denied.'; end if;
  if p_work_date < previous_week_start or p_work_date > today_kl then
    raise exception 'Daily work logs can only be saved for this week or the complete previous week.';
  end if;
  if p_contacted_count < 0 then raise exception 'Contacted count cannot be negative.'; end if;
  if p_replied_count < 0 then raise exception 'Replied count cannot be negative.'; end if;
  if p_replied_count > p_contacted_count then raise exception 'Replied count cannot be greater than contacted count.'; end if;

  select * into current_employee from public.employees e
  where e.profile_id = auth.uid() and e.deleted_at is null limit 1;
  if current_employee.id is null then raise exception 'Current employee profile was not found.'; end if;

  insert into public.scout_daily_work_logs (
    work_date, scout_profile_id, scout_employee_id, region_id,
    contacted_count, replied_count, note, created_by, updated_by
  ) values (
    p_work_date, auth.uid(), current_employee.id, current_employee.region_id,
    p_contacted_count, p_replied_count, nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), auth.uid()
  ) on conflict (scout_profile_id, work_date) do update set
    contacted_count = excluded.contacted_count,
    replied_count = excluded.replied_count,
    note = excluded.note,
    updated_by = auth.uid()
  returning * into target_log;
  return target_log;
end;
$$;

create or replace function public.get_management_scout_daily_work_logs(
  p_scout_profile_id uuid,
  p_month text
)
returns setof public.scout_daily_work_logs
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  target_employee public.employees;
  month_start date;
  month_end date;
  today_kl date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
begin
  if auth.uid() is null then raise exception 'Authentication is required.'; end if;
  if not public.current_user_has_permission('management-recruiting-data', 'view') then raise exception 'Permission denied.'; end if;
  if p_month is null or p_month !~ '^\d{4}-\d{2}$' then raise exception 'Invalid month format.'; end if;
  month_start := to_date(p_month || '-01', 'YYYY-MM-DD');
  if month_start <> date_trunc('month', today_kl::timestamp)::date then raise exception 'Only the current month may be viewed for management backfill.'; end if;
  month_end := least((month_start + interval '1 month - 1 day')::date, today_kl);
  select * into target_employee from public.employees e
  where e.profile_id = p_scout_profile_id and e.deleted_at is null limit 1;
  if target_employee.id is null then raise exception 'Target scout was not found.'; end if;
  if not public.current_user_can_access_region(target_employee.region_id) then raise exception 'Permission denied for target region.'; end if;
  return query select log.* from public.scout_daily_work_logs log
  where log.scout_profile_id = p_scout_profile_id and log.scout_employee_id = target_employee.id
    and log.work_date between month_start and month_end
    and public.current_user_can_access_region(log.region_id)
  order by log.work_date desc;
end;
$$;

create or replace function public.upsert_management_scout_daily_work_log(
  p_scout_profile_id uuid,
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
  target_employee public.employees;
  target_log public.scout_daily_work_logs;
  existing_log public.scout_daily_work_logs;
  today_kl date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
begin
  if auth.uid() is null then raise exception 'Authentication is required.'; end if;
  if not public.current_user_has_permission('management-recruiting-data', 'use') then raise exception 'Permission denied.'; end if;
  if date_trunc('month', p_work_date::timestamp)::date <> date_trunc('month', today_kl::timestamp)::date or p_work_date > today_kl then
    raise exception 'Management backfill is limited to dates already elapsed in the current month.';
  end if;
  if p_contacted_count < 0 then raise exception 'Contacted count cannot be negative.'; end if;
  if p_replied_count < 0 then raise exception 'Replied count cannot be negative.'; end if;
  if p_replied_count > p_contacted_count then raise exception 'Replied count cannot be greater than contacted count.'; end if;
  select * into target_employee from public.employees e
  where e.profile_id = p_scout_profile_id and e.deleted_at is null limit 1;
  if target_employee.id is null then raise exception 'Target scout was not found.'; end if;
  if not public.current_user_can_access_region(target_employee.region_id) then raise exception 'Permission denied for target region.'; end if;
  select * into existing_log from public.scout_daily_work_logs log
  where log.scout_profile_id = p_scout_profile_id and log.work_date = p_work_date
  for update;
  if existing_log.id is not null and not public.current_user_can_access_region(existing_log.region_id) then
    raise exception 'Permission denied for existing log region.';
  end if;
  insert into public.scout_daily_work_logs (
    work_date, scout_profile_id, scout_employee_id, region_id,
    contacted_count, replied_count, note, created_by, updated_by
  ) values (
    p_work_date, p_scout_profile_id, target_employee.id, target_employee.region_id,
    p_contacted_count, p_replied_count, nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), auth.uid()
  ) on conflict (scout_profile_id, work_date) do update set
    contacted_count = excluded.contacted_count,
    replied_count = excluded.replied_count,
    note = excluded.note,
    updated_by = auth.uid()
  returning * into target_log;
  return target_log;
end;
$$;

revoke all on function public.upsert_scout_daily_work_log(date, integer, integer, text) from public;
grant execute on function public.upsert_scout_daily_work_log(date, integer, integer, text) to authenticated;
revoke all on function public.get_management_scout_daily_work_logs(uuid, text) from public;
grant execute on function public.get_management_scout_daily_work_logs(uuid, text) to authenticated;
revoke all on function public.upsert_management_scout_daily_work_log(uuid, date, integer, integer, text) from public;
grant execute on function public.upsert_management_scout_daily_work_log(uuid, date, integer, integer, text) to authenticated;

create or replace function public.get_management_scout_daily_work_completion(
  p_scout_profile_ids uuid[]
)
returns table (
  scout_profile_id uuid,
  current_week_filled_days integer,
  current_week_expected_days integer,
  current_week_missing_days integer,
  previous_week_filled_days integer,
  previous_week_expected_days integer,
  previous_week_missing_days integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  today_kl date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  current_week_start date := date_trunc('week', ((now() at time zone 'Asia/Kuala_Lumpur')::date)::timestamp)::date;
  previous_week_start date;
  previous_week_end date;
begin
  if auth.uid() is null then raise exception 'Authentication is required.'; end if;
  if not public.current_user_has_permission('management-recruiting-data', 'view') then raise exception 'Permission denied.'; end if;
  if coalesce(array_length(p_scout_profile_ids, 1), 0) = 0 then return; end if;
  previous_week_start := current_week_start - 7;
  previous_week_end := current_week_start - 1;

  return query
  with scoped_scouts as (
    select distinct e.profile_id
    from public.employees e
    where e.profile_id = any(p_scout_profile_ids)
      and e.deleted_at is null
      and public.current_user_can_access_region(e.region_id)
  ), filled as (
    select log.scout_profile_id, log.work_date
    from public.scout_daily_work_logs log
    join scoped_scouts scout on scout.profile_id = log.scout_profile_id
    where log.work_date between previous_week_start and today_kl
      and public.current_user_can_access_region(log.region_id)
    group by log.scout_profile_id, log.work_date
  )
  select
    scout.profile_id,
    count(*) filter (where filled.work_date between current_week_start and today_kl)::integer,
    (today_kl - current_week_start + 1)::integer,
    ((today_kl - current_week_start + 1) - count(*) filter (where filled.work_date between current_week_start and today_kl))::integer,
    count(*) filter (where filled.work_date between previous_week_start and previous_week_end)::integer,
    7,
    (7 - count(*) filter (where filled.work_date between previous_week_start and previous_week_end))::integer
  from scoped_scouts scout
  left join filled on filled.scout_profile_id = scout.profile_id
  group by scout.profile_id;
end;
$$;

revoke all on function public.get_management_scout_daily_work_completion(uuid[]) from public;
grant execute on function public.get_management_scout_daily_work_completion(uuid[]) to authenticated;
