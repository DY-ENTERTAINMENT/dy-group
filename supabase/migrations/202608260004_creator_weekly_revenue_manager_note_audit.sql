begin;

alter table public.creator_weekly_revenue_records
  add column if not exists manager_note text;

create table if not exists public.creator_weekly_revenue_confirmation_history (
  id uuid primary key default gen_random_uuid(),
  weekly_record_id uuid,
  action text not null,
  previous_status text not null,
  new_status text not null,
  previous_confirmed_by_employee_id uuid,
  previous_confirmed_at timestamptz,
  acted_by_employee_id uuid,
  acted_at timestamptz not null default now(),
  reason text,
  created_at timestamptz not null default now(),
  weekly_record_id_snapshot uuid,
  creator_profile_id uuid not null,
  creator_entity_id uuid,
  platform public.creator_platform not null,
  platform_uid text not null,
  week_start_date date not null,
  week_end_date date not null,
  revenue_amount numeric(14,2) not null,
  revenue_unit text not null,
  agent_note text,
  manager_note text,
  submitted_by_employee_id uuid,
  submitted_at timestamptz,
  confirmed_by_employee_id uuid not null,
  confirmed_at timestamptz not null
);

alter table public.creator_weekly_revenue_confirmation_history
  add column if not exists weekly_record_id uuid,
  add column if not exists action text,
  add column if not exists previous_status text,
  add column if not exists new_status text,
  add column if not exists previous_confirmed_by_employee_id uuid,
  add column if not exists previous_confirmed_at timestamptz,
  add column if not exists acted_by_employee_id uuid,
  add column if not exists acted_at timestamptz not null default now(),
  add column if not exists reason text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists weekly_record_id_snapshot uuid,
  add column if not exists creator_profile_id uuid,
  add column if not exists creator_entity_id uuid,
  add column if not exists platform public.creator_platform,
  add column if not exists platform_uid text,
  add column if not exists week_start_date date,
  add column if not exists week_end_date date,
  add column if not exists revenue_amount numeric(14,2),
  add column if not exists revenue_unit text,
  add column if not exists agent_note text,
  add column if not exists manager_note text,
  add column if not exists submitted_by_employee_id uuid,
  add column if not exists submitted_at timestamptz,
  add column if not exists confirmed_by_employee_id uuid,
  add column if not exists confirmed_at timestamptz;

drop trigger if exists prevent_creator_weekly_revenue_confirmation_history_changes
on public.creator_weekly_revenue_confirmation_history;

update public.creator_weekly_revenue_confirmation_history
set weekly_record_id_snapshot = weekly_record_id
where weekly_record_id_snapshot is null
  and weekly_record_id is not null;

with recoverable_confirmation_history as (
  select
    h.id,
    (array_agg(distinct wr.creator_profile_id))[1] as creator_profile_id
  from public.creator_weekly_revenue_confirmation_history h
  join public.creator_weekly_revenue_records wr
    on wr.id = h.weekly_record_id
    or wr.id = h.weekly_record_id_snapshot
  where h.creator_profile_id is null
  group by h.id
  having count(distinct wr.creator_profile_id) = 1
)
update public.creator_weekly_revenue_confirmation_history h
set creator_profile_id = recoverable.creator_profile_id
from recoverable_confirmation_history recoverable
where h.id = recoverable.id
  and h.creator_profile_id is null;

alter table public.creator_weekly_revenue_confirmation_history
  alter column weekly_record_id drop not null;

alter table public.creator_weekly_revenue_confirmation_history
  drop constraint if exists creator_weekly_revenue_confirmation_histo_weekly_record_id_fkey;

alter table public.creator_weekly_revenue_confirmation_history
  drop constraint if exists creator_weekly_revenue_confirmation_history_weekly_record_id_fkey;

alter table public.creator_weekly_revenue_confirmation_history
  drop constraint if exists creator_weekly_revenue_confirmation_history_weekly_record_id_fk;

alter table public.creator_weekly_revenue_confirmation_history
  add constraint creator_weekly_revenue_confirmation_history_weekly_record_id_fk
  foreign key (weekly_record_id)
  references public.creator_weekly_revenue_records(id)
  on delete set null
  not valid;

create index if not exists creator_weekly_revenue_confirmation_history_record_idx
on public.creator_weekly_revenue_confirmation_history(weekly_record_id_snapshot, confirmed_at desc);

create index if not exists creator_weekly_revenue_confirmation_history_profile_period_idx
on public.creator_weekly_revenue_confirmation_history(creator_profile_id, week_start_date, confirmed_at desc);

create index if not exists creator_weekly_revenue_confirmation_history_actor_idx
on public.creator_weekly_revenue_confirmation_history(confirmed_by_employee_id, confirmed_at desc);

create or replace function public.prevent_creator_weekly_revenue_confirmation_history_changes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'Creator weekly revenue confirmation history is append-only.';
end;
$$;

create trigger prevent_creator_weekly_revenue_confirmation_history_changes
before update or delete on public.creator_weekly_revenue_confirmation_history
for each row execute function public.prevent_creator_weekly_revenue_confirmation_history_changes();

create or replace function public.audit_creator_weekly_revenue_confirmation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status = 'submitted'
     and new.status = 'confirmed'
     and not exists (
       select 1
       from public.creator_weekly_revenue_confirmation_history h
       where h.weekly_record_id_snapshot = new.id
         and h.action = 'confirm'
         and h.previous_status = old.status
         and h.new_status = new.status
     ) then
    insert into public.creator_weekly_revenue_confirmation_history (
      weekly_record_id,
      action,
      previous_status,
      new_status,
      previous_confirmed_by_employee_id,
      previous_confirmed_at,
      acted_by_employee_id,
      acted_at,
      reason,
      created_at,
      weekly_record_id_snapshot,
      creator_profile_id,
      creator_entity_id,
      platform,
      platform_uid,
      week_start_date,
      week_end_date,
      revenue_amount,
      revenue_unit,
      agent_note,
      manager_note,
      submitted_by_employee_id,
      submitted_at,
      confirmed_by_employee_id,
      confirmed_at
    )
    values (
      new.id,
      'confirm',
      old.status,
      new.status,
      old.confirmed_by_employee_id,
      old.confirmed_at,
      new.confirmed_by_employee_id,
      new.confirmed_at,
      null,
      now(),
      new.id,
      new.creator_profile_id,
      new.creator_entity_id,
      new.platform,
      new.platform_uid,
      new.week_start_date,
      new.week_end_date,
      new.revenue_amount,
      new.revenue_unit,
      new.agent_note,
      new.manager_note,
      new.submitted_by_employee_id,
      new.submitted_at,
      new.confirmed_by_employee_id,
      new.confirmed_at
    );
  end if;

  return new;
end;
$$;

drop trigger if exists audit_creator_weekly_revenue_confirmation
on public.creator_weekly_revenue_records;

create trigger audit_creator_weekly_revenue_confirmation
after update of status on public.creator_weekly_revenue_records
for each row
when (old.status = 'submitted' and new.status = 'confirmed')
execute function public.audit_creator_weekly_revenue_confirmation();

create or replace function public.review_creator_weekly_revenue_record(
  p_record_id uuid,
  p_manager_note text default null
)
returns public.creator_weekly_revenue_records
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_employee_id uuid := public.current_user_employee_id();
  target_record public.creator_weekly_revenue_records;
  target_region_id uuid;
  normalized_note text;
  confirmed_record public.creator_weekly_revenue_records;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  if current_employee_id is null then
    raise exception 'Current employee profile was not found.';
  end if;

  if not public.current_user_has_permission('management-creator-operation-review', 'use') then
    raise exception 'No permission to review creator weekly revenue.';
  end if;

  select wr.*
  into target_record
  from public.creator_weekly_revenue_records wr
  where wr.id = p_record_id
  for update;

  if target_record.id is null then
    raise exception 'Weekly revenue record not found.';
  end if;

  if target_record.status <> 'submitted' then
    raise exception 'Only submitted weekly revenue records can be reviewed.';
  end if;

  select cp.region_id
  into target_region_id
  from public.creator_profiles cp
  where cp.id = target_record.creator_profile_id
  limit 1;

  if target_region_id is null or not public.current_user_can_access_region(target_region_id) then
    raise exception 'No permission to review creator weekly revenue in this region.';
  end if;

  normalized_note := nullif(btrim(coalesce(p_manager_note, '')), '');

  update public.creator_weekly_revenue_records
  set manager_note = normalized_note
  where id = p_record_id
    and status = 'submitted';

  select *
  into confirmed_record
  from public.confirm_creator_weekly_revenue_record(p_record_id);
  return confirmed_record;
end;
$$;

alter table public.creator_weekly_revenue_confirmation_history enable row level security;

revoke all on table public.creator_weekly_revenue_confirmation_history from public;
revoke all on table public.creator_weekly_revenue_confirmation_history from anon;
revoke all on table public.creator_weekly_revenue_confirmation_history from authenticated;
grant select on table public.creator_weekly_revenue_confirmation_history to authenticated;

drop policy if exists "Managers can read weekly revenue confirmation history"
on public.creator_weekly_revenue_confirmation_history;

create policy "Managers can read weekly revenue confirmation history"
on public.creator_weekly_revenue_confirmation_history
for select
to authenticated
using (
  public.current_user_is_super_admin()
  or exists (
    select 1
    from public.creator_profiles cp
    where cp.id = creator_profile_id
      and public.current_user_can_access_region(cp.region_id)
      and public.current_user_has_permission('management-revenue-data', 'view')
  )
);

revoke all on function public.prevent_creator_weekly_revenue_confirmation_history_changes() from public;
revoke all on function public.audit_creator_weekly_revenue_confirmation() from public;
revoke all on function public.review_creator_weekly_revenue_record(uuid, text) from public;
revoke all on function public.review_creator_weekly_revenue_record(uuid, text) from anon;

grant execute on function public.review_creator_weekly_revenue_record(uuid, text) to authenticated;

revoke update, delete on table public.creator_weekly_revenue_records from authenticated;

commit;
