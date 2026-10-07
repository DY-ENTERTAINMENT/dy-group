begin;

-- Phase 1A is additive. It neither alters revenue records nor changes the
-- fixed offline-live-room assignment relation.
create extension if not exists btree_gist;

insert into public.permission_items (permission_key, parent_key, name, sort_order, is_active, is_reserved)
values
  ('management-offline-live-room-schedule', 'management', '线下直播间直播排期', 982, true, false);

create table if not exists public.offline_live_room_schedules (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.offline_live_rooms(id) on delete restrict,
  region_id uuid not null references public.regions(id) on delete restrict,
  creator_entity_id uuid not null references public.creator_entities(id) on delete restrict,
  usage_type text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'active',
  cancel_reason text,
  cancelled_at timestamptz,
  cancelled_by_employee_id uuid references public.employees(id) on delete restrict,
  created_by_employee_id uuid not null references public.employees(id) on delete restrict,
  updated_by_employee_id uuid not null references public.employees(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint offline_live_room_schedules_usage_type_check check (usage_type in ('fixed', 'temporary')),
  constraint offline_live_room_schedules_status_check check (status in ('active', 'cancelled', 'voided')),
  constraint offline_live_room_schedules_time_check check (ends_at > starts_at),
  constraint offline_live_room_schedules_max_duration_check check (ends_at <= starts_at + interval '24 hours'),
  constraint offline_live_room_schedules_cancellation_audit_check check (
    (status = 'active' and cancel_reason is null and cancelled_at is null and cancelled_by_employee_id is null)
    or (status = 'voided' and cancel_reason is null and cancelled_at is null and cancelled_by_employee_id is null)
    or (status = 'cancelled' and nullif(btrim(coalesce(cancel_reason, '')), '') is not null and cancelled_at is not null and cancelled_by_employee_id is not null)
  )
);

create index if not exists offline_live_room_schedules_active_region_starts_idx
  on public.offline_live_room_schedules(region_id, starts_at)
  where status = 'active';
create index if not exists offline_live_room_schedules_active_room_starts_idx
  on public.offline_live_room_schedules(room_id, starts_at)
  where status = 'active';
create index if not exists offline_live_room_schedules_active_creator_starts_idx
  on public.offline_live_room_schedules(creator_entity_id, starts_at)
  where status = 'active';

alter table public.offline_live_room_schedules
  add constraint offline_live_room_schedules_active_room_no_overlap
  exclude using gist (room_id with =, tstzrange(starts_at, ends_at, '[)') with &&)
  where (status = 'active');

alter table public.offline_live_room_schedules
  add constraint offline_live_room_schedules_active_creator_no_overlap
  exclude using gist (creator_entity_id with =, tstzrange(starts_at, ends_at, '[)') with &&)
  where (status = 'active');

create or replace function public.set_offline_live_room_schedule_audit_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_id uuid;
begin
  v_employee_id := public.current_user_employee_id();
  if v_employee_id is null then
    raise exception 'An active employee identity is required to manage offline live room schedules.';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'active' then
      raise exception 'New offline live room schedules must be active.';
    end if;
    new.created_by_employee_id := v_employee_id;
    new.cancel_reason := null;
    new.cancelled_at := null;
    new.cancelled_by_employee_id := null;
  else
    new.created_by_employee_id := old.created_by_employee_id;
  end if;
  new.updated_by_employee_id := v_employee_id;
  new.cancel_reason := nullif(btrim(coalesce(new.cancel_reason, '')), '');
  new.updated_at := now();

  if tg_op = 'UPDATE' then
    if old.status in ('cancelled', 'voided') then
      raise exception 'Cancelled or voided schedules cannot be changed.';
    end if;
    if new.room_id is distinct from old.room_id
       or new.region_id is distinct from old.region_id
       or new.creator_entity_id is distinct from old.creator_entity_id
       or new.usage_type is distinct from old.usage_type then
      raise exception 'Schedule room, region, creator, and usage type cannot be changed.';
    end if;
    if new.status = 'cancelled' and old.status = 'active' then
      if new.cancel_reason is null then raise exception 'A cancellation reason is required.'; end if;
      new.cancelled_at := now();
      new.cancelled_by_employee_id := v_employee_id;
    elsif new.status is distinct from old.status then
      raise exception 'Only active schedules can be cancelled.';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.prevent_offline_live_room_schedule_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'Offline live room schedules are retained for audit and cannot be deleted.';
end;
$$;

drop trigger if exists set_offline_live_room_schedule_audit_fields on public.offline_live_room_schedules;
create trigger set_offline_live_room_schedule_audit_fields
before insert or update on public.offline_live_room_schedules
for each row execute function public.set_offline_live_room_schedule_audit_fields();
drop trigger if exists prevent_offline_live_room_schedule_delete on public.offline_live_room_schedules;
create trigger prevent_offline_live_room_schedule_delete
before delete on public.offline_live_room_schedules
for each row execute function public.prevent_offline_live_room_schedule_delete();

alter table public.offline_live_room_schedules enable row level security;
revoke all on public.offline_live_room_schedules from public, anon, authenticated;

create or replace function public.current_user_can_access_offline_live_room_schedule(
  p_action text,
  p_region_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null
     or p_action not in ('view', 'use') then return false; end if;
  return public.current_user_has_permission('management-offline-live-rooms', 'view')
    and public.current_user_has_explicit_permission('management-offline-live-room-schedule', p_action)
    and public.current_user_can_access_region(p_region_id);
end;
$$;

create or replace function public.list_offline_live_room_schedules(p_region_id uuid, p_date date)
returns table(
  id uuid, room_id uuid, creator_entity_id uuid, usage_type text,
  starts_at timestamptz, ends_at timestamptz, status text,
  creator_display_name text, creator_platforms jsonb
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_day_start timestamptz; v_next_day_start timestamptz;
begin
  if p_region_id is null or p_date is null
     or not public.current_user_can_access_offline_live_room_schedule('view', p_region_id) then
    raise exception 'Permission denied.';
  end if;
  v_day_start := p_date::timestamp at time zone 'Asia/Kuala_Lumpur';
  v_next_day_start := (p_date + 1)::timestamp at time zone 'Asia/Kuala_Lumpur';
  return query
  select s.id, s.room_id, s.creator_entity_id, s.usage_type, s.starts_at, s.ends_at, s.status,
    entity.display_name,
    coalesce(platforms.items, '[]'::jsonb)
  from public.offline_live_room_schedules s
  join public.creator_entities entity on entity.id = s.creator_entity_id
  left join lateral (
    select jsonb_agg(jsonb_build_object('platform', profile.platform, 'creator_name', profile.creator_name,
      'platform_user_id', profile.platform_user_id, 'platform_account', profile.platform_account)
      order by profile.platform, profile.id) as items
    from public.creator_profiles profile
    where profile.creator_entity_id = entity.id and profile.status = 'active' and profile.membership_status = 'active'
  ) platforms on true
  where s.region_id = p_region_id and s.status = 'active'
    and s.starts_at < v_next_day_start and s.ends_at > v_day_start
  order by s.starts_at, s.id;
end;
$$;

create or replace function public.search_offline_live_room_schedule_creators(
  p_region_id uuid, p_query text default null, p_limit integer default 20
)
returns table(creator_entity_id uuid, display_name text, region_id uuid, platforms jsonb)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_query text := nullif(btrim(coalesce(p_query, '')), ''); v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
begin
  if p_region_id is null or v_query is null
     or not public.current_user_can_access_offline_live_room_schedule('use', p_region_id) then
    raise exception 'Permission denied.';
  end if;
  return query
  select entity.id, entity.display_name, entity.region_id,
    coalesce(jsonb_agg(jsonb_build_object('platform', profile.platform, 'creator_name', profile.creator_name,
      'platform_user_id', profile.platform_user_id, 'platform_account', profile.platform_account)
      order by profile.platform, profile.id) filter (where profile.id is not null), '[]'::jsonb)
  from public.creator_entities entity
  left join public.creator_profiles profile on profile.creator_entity_id = entity.id
    and profile.status = 'active' and profile.membership_status = 'active'
  where entity.region_id = p_region_id and entity.status = 'active'
    and (entity.display_name ilike '%' || v_query || '%'
      or coalesce(profile.creator_name, '') ilike '%' || v_query || '%'
      or coalesce(profile.platform_account, '') ilike '%' || v_query || '%'
      or coalesce(profile.platform_user_id, '') ilike '%' || v_query || '%')
  group by entity.id, entity.display_name, entity.region_id
  order by entity.display_name, entity.id
  limit v_limit;
end;
$$;

create or replace function public.create_offline_live_room_schedule(
  p_room_id uuid, p_creator_entity_id uuid, p_usage_type text, p_starts_at timestamptz, p_ends_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_room public.offline_live_rooms; v_creator public.creator_entities; v_schedule_id uuid; v_employee_id uuid;
begin
  v_employee_id := public.current_user_employee_id();
  if v_employee_id is null then raise exception 'An active employee identity is required to manage offline live room schedules.'; end if;
  if p_room_id is null or p_creator_entity_id is null or p_usage_type not in ('fixed', 'temporary')
     or p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at or p_ends_at > p_starts_at + interval '24 hours' then
    raise exception 'Valid room, creator, usage type, and a schedule of no more than 24 hours are required.';
  end if;
  select * into v_room from public.offline_live_rooms where id = p_room_id and status = 'active';
  if v_room.id is null or not public.current_user_can_access_offline_live_room_schedule('use', v_room.region_id) then
    raise exception 'Room access denied.';
  end if;
  select * into v_creator from public.creator_entities where id = p_creator_entity_id and status = 'active';
  if v_creator.id is null or v_creator.region_id is distinct from v_room.region_id then raise exception 'Creator must be active in the room region.'; end if;
  if p_usage_type = 'fixed' and not exists (
    select 1 from public.offline_live_room_creators assignment
    where assignment.room_id = v_room.id and assignment.creator_entity_id = v_creator.id
      and assignment.status = 'active' and assignment.ended_at is null
  ) then raise exception 'Fixed schedule creator is not actively assigned to this room.'; end if;
  if exists (select 1 from public.offline_live_room_schedules s where s.room_id = v_room.id and s.status = 'active'
    and tstzrange(s.starts_at, s.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')) then raise exception 'Room schedule conflicts with an existing active schedule.'; end if;
  if exists (select 1 from public.offline_live_room_schedules s where s.creator_entity_id = v_creator.id and s.status = 'active'
    and tstzrange(s.starts_at, s.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')) then raise exception 'Creator schedule conflicts with an existing active schedule.'; end if;
  insert into public.offline_live_room_schedules(room_id, region_id, creator_entity_id, usage_type, starts_at, ends_at)
  values(v_room.id, v_room.region_id, v_creator.id, p_usage_type, p_starts_at, p_ends_at) returning id into v_schedule_id;
  return v_schedule_id;
end;
$$;

create or replace function public.update_offline_live_room_schedule(
  p_schedule_id uuid, p_starts_at timestamptz, p_ends_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_schedule public.offline_live_room_schedules; v_employee_id uuid;
begin
  v_employee_id := public.current_user_employee_id();
  if v_employee_id is null then raise exception 'An active employee identity is required to manage offline live room schedules.'; end if;
  if p_schedule_id is null or p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at or p_ends_at > p_starts_at + interval '24 hours' then
    raise exception 'A schedule of no more than 24 hours is required.';
  end if;
  select * into v_schedule from public.offline_live_room_schedules where id = p_schedule_id for update;
  if v_schedule.id is null or v_schedule.status <> 'active'
     or not public.current_user_can_access_offline_live_room_schedule('use', v_schedule.region_id) then raise exception 'Schedule access denied.'; end if;
  if v_schedule.usage_type = 'fixed' and not exists (
    select 1 from public.offline_live_room_creators assignment
    where assignment.room_id = v_schedule.room_id and assignment.creator_entity_id = v_schedule.creator_entity_id
      and assignment.status = 'active' and assignment.ended_at is null
  ) then raise exception 'Fixed schedule creator is not actively assigned to this room.'; end if;
  if exists (select 1 from public.offline_live_room_schedules s where s.room_id = v_schedule.room_id and s.status = 'active' and s.id <> v_schedule.id
    and tstzrange(s.starts_at, s.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')) then raise exception 'Room schedule conflicts with an existing active schedule.'; end if;
  if exists (select 1 from public.offline_live_room_schedules s where s.creator_entity_id = v_schedule.creator_entity_id and s.status = 'active' and s.id <> v_schedule.id
    and tstzrange(s.starts_at, s.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')) then raise exception 'Creator schedule conflicts with an existing active schedule.'; end if;
  update public.offline_live_room_schedules set starts_at = p_starts_at, ends_at = p_ends_at where id = v_schedule.id;
end;
$$;

create or replace function public.cancel_offline_live_room_schedule(p_schedule_id uuid, p_cancel_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_schedule public.offline_live_room_schedules; v_employee_id uuid;
begin
  v_employee_id := public.current_user_employee_id();
  if v_employee_id is null then raise exception 'An active employee identity is required to manage offline live room schedules.'; end if;
  if p_schedule_id is null or nullif(btrim(coalesce(p_cancel_reason, '')), '') is null then raise exception 'A schedule and cancellation reason are required.'; end if;
  select * into v_schedule from public.offline_live_room_schedules where id = p_schedule_id for update;
  if v_schedule.id is null or v_schedule.status <> 'active'
     or not public.current_user_can_access_offline_live_room_schedule('use', v_schedule.region_id) then raise exception 'Schedule access denied.'; end if;
  update public.offline_live_room_schedules set status = 'cancelled', cancel_reason = p_cancel_reason where id = v_schedule.id;
end;
$$;

revoke all on function public.current_user_can_access_offline_live_room_schedule(text, uuid) from public, anon;
revoke all on function public.list_offline_live_room_schedules(uuid, date) from public, anon;
revoke all on function public.search_offline_live_room_schedule_creators(uuid, text, integer) from public, anon;
revoke all on function public.create_offline_live_room_schedule(uuid, uuid, text, timestamptz, timestamptz) from public, anon;
revoke all on function public.update_offline_live_room_schedule(uuid, timestamptz, timestamptz) from public, anon;
revoke all on function public.cancel_offline_live_room_schedule(uuid, text) from public, anon;
grant execute on function public.current_user_can_access_offline_live_room_schedule(text, uuid) to authenticated;
grant execute on function public.list_offline_live_room_schedules(uuid, date) to authenticated;
grant execute on function public.search_offline_live_room_schedule_creators(uuid, text, integer) to authenticated;
grant execute on function public.create_offline_live_room_schedule(uuid, uuid, text, timestamptz, timestamptz) to authenticated;
grant execute on function public.update_offline_live_room_schedule(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.cancel_offline_live_room_schedule(uuid, text) to authenticated;

commit;
