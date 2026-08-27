begin;

create or replace function public.save_creator_revenue_period_settings(
  p_revenue_month date,
  p_periods jsonb
)
returns table (
  id uuid,
  revenue_month date,
  period_no integer,
  label text,
  start_date date,
  end_date date,
  is_enabled boolean,
  source text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_month date := date_trunc('month', p_revenue_month)::date;
  target_month_end date := (date_trunc('month', p_revenue_month)::date + interval '1 month - 1 day')::date;
  current_employee_id uuid := public.current_user_employee_id();
  old_period public.creator_revenue_period_settings;
  next_period_no integer;
  next_start_date date;
  next_end_date date;
  next_is_enabled boolean;
  enabled_period_count integer;
  existing_setting_count integer;
  fixed_period_mismatch_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  if current_employee_id is null then
    raise exception 'Current employee profile was not found.';
  end if;

  if not public.current_user_has_permission('agent-revenue-period-settings', 'use') then
    raise exception 'No permission to manage creator revenue period settings.';
  end if;

  if p_periods is null or jsonb_typeof(p_periods) <> 'array' then
    raise exception 'Revenue period settings must be a JSON array.';
  end if;

  drop table if exists pg_temp.next_creator_revenue_period_settings;

  create temporary table next_creator_revenue_period_settings (
    period_no integer not null,
    label text not null,
    start_date date not null,
    end_date date not null,
    is_enabled boolean not null
  ) on commit drop;

  insert into next_creator_revenue_period_settings (
    period_no,
    label,
    start_date,
    end_date,
    is_enabled
  )
  select
    input.period_no,
    btrim(coalesce(input.label, '')),
    input.start_date,
    input.end_date,
    coalesce(input.is_enabled, true)
  from jsonb_to_recordset(p_periods) as input(
    period_no integer,
    label text,
    start_date date,
    end_date date,
    is_enabled boolean
  );

  if exists (
    select 1
    from next_creator_revenue_period_settings next
    where next.period_no not between 1 and 5
       or nullif(next.label, '') is null
       or next.start_date > next.end_date
       or date_trunc('month', next.start_date)::date <> target_month
       or date_trunc('month', next.end_date)::date <> target_month
  ) then
    raise exception 'Revenue period settings contain invalid period number, label, or dates.';
  end if;

  if exists (
    select 1
    from next_creator_revenue_period_settings next
    group by next.period_no
    having count(*) > 1
  ) then
    raise exception 'Revenue period numbers must be unique within the month.';
  end if;

  if exists (
    select 1
    from next_creator_revenue_period_settings first
    join next_creator_revenue_period_settings second
      on first.period_no < second.period_no
     and first.is_enabled = true
     and second.is_enabled = true
     and daterange(first.start_date, first.end_date + 1, '[)') && daterange(second.start_date, second.end_date + 1, '[)')
  ) then
    raise exception 'Revenue period settings cannot overlap within the same month.';
  end if;

  select count(*)
  into enabled_period_count
  from next_creator_revenue_period_settings next
  where next.is_enabled = true;

  if enabled_period_count not in (4, 5) then
    raise exception 'Creator revenue period settings require complete periods from week 1 to week 4.';
  end if;

  if exists (
    select 1
    from generate_series(1, 4) as required(required_period_no)
    where not exists (
      select 1
      from next_creator_revenue_period_settings next
      where next.period_no = required.required_period_no
        and next.is_enabled = true
    )
  ) then
    raise exception 'Creator revenue period settings require complete periods from week 1 to week 4.';
  end if;

  if exists (
    select 1
    from next_creator_revenue_period_settings next
    where next.is_enabled = true
      and next.period_no = 5
      and not exists (
        select 1
        from next_creator_revenue_period_settings previous
        where previous.period_no = 4
          and previous.is_enabled = true
      )
  ) then
    raise exception 'The fifth revenue period can only be enabled after week 4.';
  end if;

  if exists (
    select 1
    from next_creator_revenue_period_settings next
    where next.is_enabled = true
      and next.period_no not between 1 and enabled_period_count
  ) then
    raise exception 'Creator revenue period settings require continuous period numbers.';
  end if;

  if not exists (
    select 1
    from next_creator_revenue_period_settings next
    where next.period_no = 1
      and next.is_enabled = true
      and next.start_date = target_month
  ) then
    raise exception 'The first creator revenue period must start on the first day of the month.';
  end if;

  if exists (
    select 1
    from next_creator_revenue_period_settings previous
    join next_creator_revenue_period_settings next
      on next.period_no = previous.period_no + 1
     and previous.is_enabled = true
     and next.is_enabled = true
    where next.start_date <> previous.end_date + 1
  ) then
    raise exception 'Creator revenue period settings must continuously cover the whole month.';
  end if;

  if not exists (
    select 1
    from next_creator_revenue_period_settings next
    where next.period_no = enabled_period_count
      and next.is_enabled = true
      and next.end_date = target_month_end
  ) then
    raise exception 'The last creator revenue period must end on the last day of the month.';
  end if;

  select count(*)
  into existing_setting_count
  from public.creator_revenue_period_settings crps
  where crps.revenue_month = target_month;

  if existing_setting_count = 0
     and exists (
       select 1
       from public.creator_weekly_revenue_records wr
       where date_trunc('month', wr.week_start_date)::date = target_month
     ) then
    with fallback_periods as (
      select
        fallback.period_no,
        make_date(
          extract(year from target_month)::int,
          extract(month from target_month)::int,
          fallback.start_day
        ) as start_date,
        make_date(
          extract(year from target_month)::int,
          extract(month from target_month)::int,
          case
            when fallback.start_day = 29 then extract(day from target_month_end)::int
            else least(fallback.start_day + 6, extract(day from target_month_end)::int)
          end
        ) as end_date
      from (
        values
          (1, 1),
          (2, 8),
          (3, 15),
          (4, 22),
          (5, 29)
      ) as fallback(period_no, start_day)
      where fallback.start_day <= extract(day from target_month_end)::int
    ),
    mismatches as (
      select count(*) as mismatch_count
      from fallback_periods fallback
      full join (
        select next.period_no, next.start_date, next.end_date
        from next_creator_revenue_period_settings next
        where next.is_enabled = true
      ) next
        on next.period_no = fallback.period_no
      where fallback.period_no is null
         or next.period_no is null
         or next.start_date is distinct from fallback.start_date
         or next.end_date is distinct from fallback.end_date
    )
    select mismatches.mismatch_count
    into fixed_period_mismatch_count
    from mismatches;

    if fixed_period_mismatch_count > 0 then
      raise exception 'This month already has weekly revenue records; existing period dates cannot be changed.';
    end if;
  end if;

  for old_period in
    select crps.*
    from public.creator_revenue_period_settings crps
    where crps.revenue_month = target_month
  loop
    next_period_no := null;
    next_start_date := null;
    next_end_date := null;
    next_is_enabled := null;

    select
      next.period_no,
      next.start_date,
      next.end_date,
      next.is_enabled
    into
      next_period_no,
      next_start_date,
      next_end_date,
      next_is_enabled
    from next_creator_revenue_period_settings next
    where next.period_no = old_period.period_no
    limit 1;

    if public.creator_revenue_period_setting_has_records(old_period.start_date)
       and (
         next_period_no is null
         or next_is_enabled = false
         or next_start_date is distinct from old_period.start_date
         or next_end_date is distinct from old_period.end_date
       ) then
      raise exception 'Cannot change, disable, or remove a revenue period that already has weekly revenue records.';
    end if;
  end loop;

  delete from public.creator_revenue_period_settings crps
  where crps.revenue_month = target_month
    and not exists (
      select 1
      from next_creator_revenue_period_settings next
      where next.period_no = crps.period_no
    );

  insert into public.creator_revenue_period_settings (
    revenue_month,
    period_no,
    label,
    start_date,
    end_date,
    is_enabled,
    created_by_employee_id,
    updated_by_employee_id
  )
  select
    target_month,
    next.period_no,
    next.label,
    next.start_date,
    next.end_date,
    next.is_enabled,
    current_employee_id,
    current_employee_id
  from next_creator_revenue_period_settings next
  on conflict on constraint creator_revenue_period_settings_unique_period do update
  set label = excluded.label,
      start_date = excluded.start_date,
      end_date = excluded.end_date,
      is_enabled = excluded.is_enabled,
      updated_by_employee_id = current_employee_id,
      updated_at = now();

  return query
  select settings.id,
         settings.revenue_month,
         settings.period_no,
         settings.label,
         settings.start_date,
         settings.end_date,
         settings.is_enabled,
         settings.source
  from public.list_creator_revenue_period_settings(target_month) settings;
end;
$$;

commit;
