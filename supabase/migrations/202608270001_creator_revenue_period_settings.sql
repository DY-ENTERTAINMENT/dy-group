begin;

insert into public.permission_items (permission_key, parent_key, name, sort_order, is_reserved)
values
  ('agent-revenue-period-settings', null, '流水周期设置', 26, false)
on conflict (permission_key) do update
set parent_key = excluded.parent_key,
    name = excluded.name,
    sort_order = excluded.sort_order,
    is_reserved = excluded.is_reserved;

create table if not exists public.creator_revenue_period_settings (
  id uuid primary key default gen_random_uuid(),
  revenue_month date not null,
  period_no integer not null,
  label text not null,
  start_date date not null,
  end_date date not null,
  is_enabled boolean not null default true,
  created_by_employee_id uuid references public.employees(id) on delete set null,
  updated_by_employee_id uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint creator_revenue_period_settings_month_check
    check (revenue_month = date_trunc('month', revenue_month)::date),
  constraint creator_revenue_period_settings_period_no_check
    check (period_no between 1 and 5),
  constraint creator_revenue_period_settings_label_check
    check (nullif(btrim(label), '') is not null),
  constraint creator_revenue_period_settings_date_order_check
    check (start_date <= end_date),
  constraint creator_revenue_period_settings_start_month_check
    check (date_trunc('month', start_date)::date = revenue_month),
  constraint creator_revenue_period_settings_end_month_check
    check (date_trunc('month', end_date)::date = revenue_month),
  constraint creator_revenue_period_settings_unique_period
    unique (revenue_month, period_no)
);

create index if not exists creator_revenue_period_settings_month_idx
on public.creator_revenue_period_settings(revenue_month, is_enabled, period_no);

create index if not exists creator_revenue_period_settings_start_idx
on public.creator_revenue_period_settings(start_date)
where is_enabled = true;

create or replace function public.creator_revenue_period_setting_has_records(p_start_date date)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.creator_weekly_revenue_records wr
    where wr.week_start_date = p_start_date
  );
$$;

create or replace function public.validate_creator_revenue_period_setting()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE'
     and public.creator_revenue_period_setting_has_records(old.start_date)
     and (
       old.period_no is distinct from new.period_no
       or old.start_date is distinct from new.start_date
       or old.end_date is distinct from new.end_date
       or (old.is_enabled = true and new.is_enabled = false)
     ) then
    raise exception 'Cannot change or disable a revenue period that already has weekly revenue records.';
  end if;

  if new.is_enabled and exists (
    select 1
    from public.creator_revenue_period_settings existing
    where existing.revenue_month = new.revenue_month
      and existing.is_enabled = true
      and existing.id is distinct from new.id
      and existing.period_no is distinct from new.period_no
      and daterange(existing.start_date, existing.end_date + 1, '[)') && daterange(new.start_date, new.end_date + 1, '[)')
  ) then
    raise exception 'Creator revenue periods cannot overlap within the same month.';
  end if;

  if tg_op = 'INSERT' then
    new.created_by_employee_id := public.current_user_employee_id();
  end if;

  new.updated_by_employee_id := public.current_user_employee_id();
  new.label := btrim(new.label);
  new.updated_at := now();

  return new;
end;
$$;

drop trigger if exists validate_creator_revenue_period_setting
on public.creator_revenue_period_settings;

create trigger validate_creator_revenue_period_setting
before insert or update on public.creator_revenue_period_settings
for each row execute function public.validate_creator_revenue_period_setting();

create or replace function public.prevent_creator_revenue_period_setting_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.creator_revenue_period_setting_has_records(old.start_date) then
    raise exception 'Cannot delete a revenue period that already has weekly revenue records.';
  end if;

  return old;
end;
$$;

drop trigger if exists prevent_creator_revenue_period_setting_delete
on public.creator_revenue_period_settings;

create trigger prevent_creator_revenue_period_setting_delete
before delete on public.creator_revenue_period_settings
for each row execute function public.prevent_creator_revenue_period_setting_delete();

create or replace function public.creator_weekly_revenue_period_start(p_date date)
returns date
language plpgsql
stable
strict
set search_path = public, pg_temp
as $$
declare
  target_month date := date_trunc('month', p_date)::date;
  target_year int := extract(year from p_date)::int;
  target_month_number int := extract(month from p_date)::int;
  target_day int := extract(day from p_date)::int;
  configured_start date;
  configured_count int;
begin
  select crps.start_date
  into configured_start
  from public.creator_revenue_period_settings crps
  where crps.revenue_month = target_month
    and crps.is_enabled = true
    and p_date between crps.start_date and crps.end_date
  order by crps.period_no
  limit 1;

  if configured_start is not null then
    return configured_start;
  end if;

  select count(*)
  into configured_count
  from public.creator_revenue_period_settings crps
  where crps.revenue_month = target_month
    and crps.is_enabled = true;

  if configured_count > 0 then
    raise exception 'Creator revenue period settings must continuously cover the whole month.';
  end if;

  return make_date(
    target_year,
    target_month_number,
    case
      when target_day between 1 and 7 then 1
      when target_day between 8 and 14 then 8
      when target_day between 15 and 21 then 15
      when target_day between 22 and 28 then 22
      else 29
    end
  );
end;
$$;

create or replace function public.creator_weekly_revenue_period_end(p_period_start date)
returns date
language plpgsql
stable
strict
set search_path = public, pg_temp
as $$
declare
  target_month date := date_trunc('month', p_period_start)::date;
  start_year int := extract(year from p_period_start)::int;
  start_month int := extract(month from p_period_start)::int;
  start_day int := extract(day from p_period_start)::int;
  next_month_start date;
  configured_end date;
  configured_count int;
begin
  select crps.end_date
  into configured_end
  from public.creator_revenue_period_settings crps
  where crps.revenue_month = target_month
    and crps.is_enabled = true
    and crps.start_date = p_period_start
  limit 1;

  if configured_end is not null then
    return configured_end;
  end if;

  select count(*)
  into configured_count
  from public.creator_revenue_period_settings crps
  where crps.revenue_month = target_month
    and crps.is_enabled = true;

  if configured_count > 0 then
    raise exception 'Creator weekly revenue period start is not configured for this month.';
  end if;

  if start_day not in (1, 8, 15, 22, 29)
     or p_period_start <> public.creator_weekly_revenue_period_start(p_period_start) then
    raise exception 'Creator weekly revenue period start must be day 1, 8, 15, 22, or 29.';
  end if;

  if start_day in (1, 8, 15, 22) then
    return p_period_start + 6;
  end if;

  next_month_start := case
    when start_month = 12 then make_date(start_year + 1, 1, 1)
    else make_date(start_year, start_month + 1, 1)
  end;

  return next_month_start - 1;
end;
$$;

create or replace function public.sync_creator_weekly_revenue_record()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_creator public.creator_profiles;
  current_employee_id uuid := public.current_user_employee_id();
  previous_status text;
begin
  if tg_op = 'UPDATE' then
    previous_status := old.status;
  end if;

  select * into target_creator
  from public.creator_profiles cp
  where cp.id = new.creator_profile_id
  limit 1;

  if target_creator.id is null then
    raise exception 'Creator profile does not exist.';
  end if;

  new.creator_entity_id := target_creator.creator_entity_id;
  new.platform := target_creator.platform;
  new.platform_uid := target_creator.platform_user_id;
  new.revenue_unit := case
    when target_creator.platform = 'tiktok' then 'diamond'
    when target_creator.platform = 'douyin' then 'yinlang'
  end;
  new.week_end_date := public.creator_weekly_revenue_period_end(new.week_start_date);

  if tg_op = 'INSERT' then
    new.created_by_employee_id := current_employee_id;
  end if;

  new.updated_by_employee_id := current_employee_id;

  if new.status = 'draft' then
    new.submitted_by_employee_id := null;
    new.submitted_at := null;
  elsif new.status = 'submitted' and previous_status is distinct from 'submitted' then
    new.submitted_by_employee_id := current_employee_id;
    new.submitted_at := now();
  elsif new.status = 'submitted' then
    new.submitted_by_employee_id := old.submitted_by_employee_id;
    new.submitted_at := old.submitted_at;
  elsif new.status = 'confirmed' and (previous_status is null or previous_status = 'draft') then
    new.submitted_by_employee_id := current_employee_id;
    new.submitted_at := now();
  elsif new.status = 'confirmed' then
    new.submitted_by_employee_id := old.submitted_by_employee_id;
    new.submitted_at := old.submitted_at;
  end if;

  if new.status = 'confirmed' and previous_status is distinct from 'confirmed' then
    new.confirmed_by_employee_id := current_employee_id;
    new.confirmed_at := now();
  elsif new.status = 'confirmed' then
    new.confirmed_by_employee_id := old.confirmed_by_employee_id;
    new.confirmed_at := old.confirmed_at;
  elsif new.status <> 'confirmed' then
    new.confirmed_by_employee_id := null;
    new.confirmed_at := null;
  end if;

  return new;
end;
$$;

create or replace function public.list_creator_revenue_period_settings(p_revenue_month date)
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
stable
security definer
set search_path = public, pg_temp
as $$
declare
  target_month date := date_trunc('month', p_revenue_month)::date;
  target_year int := extract(year from p_revenue_month)::int;
  target_month_number int := extract(month from p_revenue_month)::int;
  last_day int := extract(day from (date_trunc('month', p_revenue_month)::date + interval '1 month - 1 day'))::int;
  configured_count int;
begin
  select count(*)
  into configured_count
  from public.creator_revenue_period_settings crps
  where crps.revenue_month = target_month
    and crps.is_enabled = true;

  if configured_count > 0 then
    return query
    select
      crps.id,
      crps.revenue_month,
      crps.period_no,
      crps.label,
      crps.start_date,
      crps.end_date,
      crps.is_enabled,
      'custom'::text as source
    from public.creator_revenue_period_settings crps
    where crps.revenue_month = target_month
      and crps.is_enabled = true
    order by crps.period_no;
    return;
  end if;

  return query
  select
    null::uuid as id,
    target_month as revenue_month,
    fallback.period_no,
    fallback.label,
    make_date(target_year, target_month_number, fallback.start_day) as start_date,
    make_date(
      target_year,
      target_month_number,
      case
        when fallback.start_day = 29 then last_day
        else least(fallback.start_day + 6, last_day)
      end
    ) as end_date,
    true as is_enabled,
    'fallback'::text as source
  from (
    values
      (1, '第一周', 1),
      (2, '第二周', 8),
      (3, '第三周', 15),
      (4, '第四周', 22),
      (5, '第五周', 29)
  ) as fallback(period_no, label, start_day)
  where fallback.start_day <= last_day
  order by fallback.period_no;
end;
$$;

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
    period_no,
    btrim(coalesce(label, '')),
    start_date,
    end_date,
    coalesce(is_enabled, true)
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
    from generate_series(1, 4) as required(period_no)
    where not exists (
      select 1
      from next_creator_revenue_period_settings next
      where next.period_no = required.period_no
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
    select mismatch_count
    into fixed_period_mismatch_count
    from mismatches;

    if fixed_period_mismatch_count > 0 then
      raise exception 'This month already has weekly revenue records; existing period dates cannot be changed.';
    end if;
  end if;

  for old_period in
    select *
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
  on conflict (revenue_month, period_no) do update
  set label = excluded.label,
      start_date = excluded.start_date,
      end_date = excluded.end_date,
      is_enabled = excluded.is_enabled,
      updated_by_employee_id = current_employee_id,
      updated_at = now();

  return query
  select *
  from public.list_creator_revenue_period_settings(target_month);
end;
$$;

alter table public.creator_revenue_period_settings enable row level security;

revoke all on table public.creator_revenue_period_settings from public;
revoke all on table public.creator_revenue_period_settings from anon;
revoke all on table public.creator_revenue_period_settings from authenticated;
grant select on table public.creator_revenue_period_settings to authenticated;

drop policy if exists "Authenticated users can read creator revenue period settings"
on public.creator_revenue_period_settings;

create policy "Authenticated users can read creator revenue period settings"
on public.creator_revenue_period_settings
for select to authenticated
using (true);

revoke all on function public.creator_revenue_period_setting_has_records(date) from public;
revoke all on function public.validate_creator_revenue_period_setting() from public;
revoke all on function public.prevent_creator_revenue_period_setting_delete() from public;
revoke all on function public.list_creator_revenue_period_settings(date) from public;
revoke all on function public.save_creator_revenue_period_settings(date, jsonb) from public;
revoke all on function public.list_creator_revenue_period_settings(date) from anon;
revoke all on function public.save_creator_revenue_period_settings(date, jsonb) from anon;
grant execute on function public.list_creator_revenue_period_settings(date) to authenticated, service_role;
grant execute on function public.save_creator_revenue_period_settings(date, jsonb) to authenticated, service_role;
grant execute on function public.creator_weekly_revenue_period_start(date) to authenticated, service_role;
grant execute on function public.creator_weekly_revenue_period_end(date) to authenticated, service_role;

commit;
