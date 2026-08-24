begin;

create or replace function public.creator_weekly_revenue_period_start(p_date date)
returns date
language plpgsql
immutable
strict
set search_path = public, pg_temp
as $$
declare
  target_year int := extract(year from p_date)::int;
  target_month int := extract(month from p_date)::int;
  target_day int := extract(day from p_date)::int;
begin
  return make_date(
    target_year,
    target_month,
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
immutable
strict
set search_path = public, pg_temp
as $$
declare
  start_year int := extract(year from p_period_start)::int;
  start_month int := extract(month from p_period_start)::int;
  start_day int := extract(day from p_period_start)::int;
  next_month_start date;
begin
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

revoke all on function public.creator_weekly_revenue_period_start(date) from public;
revoke all on function public.creator_weekly_revenue_period_start(date) from anon;
revoke all on function public.creator_weekly_revenue_period_end(date) from public;
revoke all on function public.creator_weekly_revenue_period_end(date) from anon;
grant execute on function public.creator_weekly_revenue_period_start(date) to authenticated, service_role;
grant execute on function public.creator_weekly_revenue_period_end(date) to authenticated, service_role;

do $$
declare
  conflict_count int;
begin
  with mapped as (
    select
      wr.creator_profile_id,
      public.creator_weekly_revenue_period_start(wr.week_start_date) as new_period_start
    from public.creator_weekly_revenue_records wr
  ),
  conflicts as (
    select creator_profile_id, new_period_start, count(*) as record_count
    from mapped
    group by creator_profile_id, new_period_start
    having count(*) > 1
  )
  select count(*) into conflict_count
  from conflicts;

  if conflict_count > 0 then
    raise exception 'Cannot migrate creator weekly revenue records: duplicate creator_profile_id + period_start would be created.';
  end if;
end;
$$;

alter table if exists public.creator_weekly_revenue_confirmation_history
  add column if not exists weekly_record_id_snapshot uuid;

alter table if exists public.creator_weekly_revenue_confirmation_history
  disable trigger prevent_creator_weekly_revenue_confirmation_history_changes;

update public.creator_weekly_revenue_confirmation_history
set weekly_record_id_snapshot = weekly_record_id
where weekly_record_id_snapshot is null;

alter table if exists public.creator_weekly_revenue_confirmation_history
  enable trigger prevent_creator_weekly_revenue_confirmation_history_changes;

alter table if exists public.creator_weekly_revenue_confirmation_history
  alter column weekly_record_id drop not null;

alter table if exists public.creator_weekly_revenue_confirmation_history
  drop constraint if exists creator_weekly_revenue_confirmation_histo_weekly_record_id_fkey;

alter table if exists public.creator_weekly_revenue_confirmation_history
  drop constraint if exists creator_weekly_revenue_confirmation_history_weekly_record_id_fkey;

do $$
begin
  if to_regclass('public.creator_weekly_revenue_confirmation_history') is not null
     and not exists (
       select 1
       from pg_constraint
       where conrelid = 'public.creator_weekly_revenue_confirmation_history'::regclass
         and conname = 'creator_weekly_revenue_confirmation_history_weekly_record_id_fkey'
     ) then
    alter table public.creator_weekly_revenue_confirmation_history
      add constraint creator_weekly_revenue_confirmation_history_weekly_record_id_fkey
      foreign key (weekly_record_id)
      references public.creator_weekly_revenue_records(id)
      on delete set null;
  end if;
end;
$$;

alter table public.creator_weekly_revenue_records
  drop constraint if exists creator_weekly_revenue_records_week_start_check,
  drop constraint if exists creator_weekly_revenue_records_week_end_check;

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
  start_day int;
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

  start_day := extract(day from new.week_start_date)::int;
  if start_day not in (1, 8, 15, 22, 29) then
    raise exception 'Creator weekly revenue period start must be day 1, 8, 15, 22, or 29.';
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

alter table public.creator_weekly_revenue_records
  disable trigger sync_creator_weekly_revenue_record;

alter table public.creator_weekly_revenue_records
  disable trigger set_creator_weekly_revenue_records_updated_at;

with normalized as (
  select
    wr.id,
    public.creator_weekly_revenue_period_start(wr.week_start_date) as new_period_start
  from public.creator_weekly_revenue_records wr
)
update public.creator_weekly_revenue_records wr
set
  week_start_date = normalized.new_period_start,
  week_end_date = public.creator_weekly_revenue_period_end(normalized.new_period_start)
from normalized
where wr.id = normalized.id
  and (
    wr.week_start_date is distinct from normalized.new_period_start
    or wr.week_end_date is distinct from public.creator_weekly_revenue_period_end(normalized.new_period_start)
  );

alter table public.creator_weekly_revenue_records
  enable trigger sync_creator_weekly_revenue_record;

alter table public.creator_weekly_revenue_records
  enable trigger set_creator_weekly_revenue_records_updated_at;

alter table public.creator_weekly_revenue_records
  add constraint creator_weekly_revenue_records_period_start_check
    check (week_start_date = public.creator_weekly_revenue_period_start(week_start_date)),
  add constraint creator_weekly_revenue_records_period_end_check
    check (week_end_date = public.creator_weekly_revenue_period_end(week_start_date));

drop policy if exists "Agents can read own weekly revenue records"
on public.creator_weekly_revenue_records;

drop policy if exists "Managers can read submitted weekly revenue records"
on public.creator_weekly_revenue_records;

drop policy if exists "Agents can create own weekly revenue records"
on public.creator_weekly_revenue_records;

drop policy if exists "Agents can update own unconfirmed weekly revenue records"
on public.creator_weekly_revenue_records;

create policy "Agents can read own weekly revenue records"
on public.creator_weekly_revenue_records for select to authenticated
using (
  exists (
    select 1 from public.creator_profiles cp
    where cp.id = creator_profile_id
      and cp.manager_employee_id = public.current_user_employee_id()
      and public.current_user_has_permission('agent-revenue-data', 'view')
  )
);

create policy "Managers can read weekly revenue records"
on public.creator_weekly_revenue_records for select to authenticated
using (
  status in ('submitted', 'confirmed')
  and exists (
    select 1 from public.creator_profiles cp
    where cp.id = creator_profile_id
      and public.current_user_can_access_region(cp.region_id)
      and public.current_user_has_permission('management-revenue-data', 'view')
  )
);

create policy "Agents can create own weekly revenue records"
on public.creator_weekly_revenue_records for insert to authenticated
with check (
  status = 'submitted'
  and exists (
    select 1 from public.creator_profiles cp
    where cp.id = creator_profile_id
      and cp.manager_employee_id = public.current_user_employee_id()
      and public.current_user_has_permission('agent-revenue-data', 'use')
  )
);

revoke update, delete on table public.creator_weekly_revenue_records from authenticated;
grant select, insert on table public.creator_weekly_revenue_records to authenticated;

create table if not exists public.creator_weekly_revenue_cancellation_history (
  id uuid primary key default gen_random_uuid(),
  weekly_record_id uuid not null,
  creator_profile_id uuid not null,
  creator_entity_id uuid,
  platform public.creator_platform not null,
  platform_uid text not null,
  week_start_date date not null,
  week_end_date date not null,
  revenue_amount numeric(14,2) not null,
  revenue_unit text not null,
  agent_note text,
  old_status text not null,
  submitted_by_employee_id uuid,
  submitted_at timestamptz,
  confirmed_by_employee_id uuid,
  confirmed_at timestamptz,
  cancelled_by_employee_id uuid not null,
  cancelled_at timestamptz not null default now(),
  reason text,
  created_at timestamptz not null default now(),
  constraint creator_weekly_revenue_cancellation_history_status_check
    check (old_status in ('submitted', 'confirmed'))
);

alter table public.creator_weekly_revenue_cancellation_history
  add column if not exists confirmed_by_employee_id uuid,
  add column if not exists confirmed_at timestamptz;

create index if not exists creator_weekly_revenue_cancellation_history_record_idx
on public.creator_weekly_revenue_cancellation_history(weekly_record_id, cancelled_at desc);

create index if not exists creator_weekly_revenue_cancellation_history_profile_period_idx
on public.creator_weekly_revenue_cancellation_history(creator_profile_id, week_start_date, cancelled_at desc);

create index if not exists creator_weekly_revenue_cancellation_history_actor_idx
on public.creator_weekly_revenue_cancellation_history(cancelled_by_employee_id, cancelled_at desc);

create or replace function public.prevent_creator_weekly_revenue_cancellation_history_changes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'Creator weekly revenue cancellation history is append-only.';
end;
$$;

drop trigger if exists prevent_creator_weekly_revenue_cancellation_history_changes
on public.creator_weekly_revenue_cancellation_history;

create trigger prevent_creator_weekly_revenue_cancellation_history_changes
before update or delete on public.creator_weekly_revenue_cancellation_history
for each row execute function public.prevent_creator_weekly_revenue_cancellation_history_changes();

alter table public.creator_weekly_revenue_cancellation_history enable row level security;

revoke all on table public.creator_weekly_revenue_cancellation_history from public;
revoke all on table public.creator_weekly_revenue_cancellation_history from anon;
revoke all on table public.creator_weekly_revenue_cancellation_history from authenticated;
grant select on table public.creator_weekly_revenue_cancellation_history to authenticated;

drop policy if exists "Super admins can read weekly revenue cancellation history"
on public.creator_weekly_revenue_cancellation_history;

create policy "Super admins can read weekly revenue cancellation history"
on public.creator_weekly_revenue_cancellation_history
for select
to authenticated
using (public.current_user_is_super_admin());

create or replace function public.cancel_creator_weekly_revenue_entry(
  p_record_id uuid,
  p_reason text default null
)
returns public.creator_weekly_revenue_cancellation_history
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_employee_id uuid := public.current_user_employee_id();
  target_record public.creator_weekly_revenue_records;
  history_record public.creator_weekly_revenue_cancellation_history;
  target_region_id uuid;
  normalized_reason text;
  deleted_record_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  if not public.current_user_is_super_admin() then
    raise exception 'Only super_admin can cancel creator weekly revenue entries.';
  end if;

  if current_employee_id is null then
    raise exception 'Current employee profile was not found.';
  end if;

  normalized_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if normalized_reason is null then
    raise exception 'Cancellation reason is required.';
  end if;

  select wr.*
  into target_record
  from public.creator_weekly_revenue_records wr
  where wr.id = p_record_id
  for update;

  if target_record.id is null then
    raise exception 'Weekly revenue record not found.';
  end if;

  if target_record.status not in ('submitted', 'confirmed') then
    raise exception 'Only filled weekly revenue records can be cancelled.';
  end if;

  select cp.region_id
  into target_region_id
  from public.creator_profiles cp
  where cp.id = target_record.creator_profile_id
  limit 1;

  if target_region_id is null or not public.current_user_can_access_region(target_region_id) then
    raise exception 'No permission to cancel creator weekly revenue entries in this region.';
  end if;

  insert into public.creator_weekly_revenue_cancellation_history (
    weekly_record_id,
    creator_profile_id,
    creator_entity_id,
    platform,
    platform_uid,
    week_start_date,
    week_end_date,
    revenue_amount,
    revenue_unit,
    agent_note,
    old_status,
    submitted_by_employee_id,
    submitted_at,
    confirmed_by_employee_id,
    confirmed_at,
    cancelled_by_employee_id,
    cancelled_at,
    reason
  )
  values (
    target_record.id,
    target_record.creator_profile_id,
    target_record.creator_entity_id,
    target_record.platform,
    target_record.platform_uid,
    target_record.week_start_date,
    target_record.week_end_date,
    target_record.revenue_amount,
    target_record.revenue_unit,
    target_record.agent_note,
    target_record.status,
    target_record.submitted_by_employee_id,
    target_record.submitted_at,
    target_record.confirmed_by_employee_id,
    target_record.confirmed_at,
    current_employee_id,
    now(),
    normalized_reason
  )
  returning * into history_record;

  delete from public.creator_weekly_revenue_records
  where id = p_record_id
    and status in ('submitted', 'confirmed')
  returning id into deleted_record_id;

  if deleted_record_id is null then
    raise exception 'Weekly revenue entry could not be cancelled.';
  end if;

  return history_record;
end;
$$;

revoke all on function public.prevent_creator_weekly_revenue_cancellation_history_changes() from public;
revoke all on function public.cancel_creator_weekly_revenue_entry(uuid, text) from public;
revoke all on function public.cancel_creator_weekly_revenue_entry(uuid, text) from anon;
revoke all on function public.cancel_creator_weekly_revenue_entry(uuid, text) from authenticated;
grant execute on function public.cancel_creator_weekly_revenue_entry(uuid, text) to authenticated;

commit;
