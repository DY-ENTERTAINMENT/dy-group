begin;

-- Phase 1A is intentionally additive. It does not update, delete, migrate,
-- recalculate, or backfill any existing creator, room, assignment, revenue,
-- or KPI data.

insert into public.permission_items (permission_key, parent_key, name, sort_order, is_active, is_reserved)
values
  ('management-offline-live-room-revenue', 'management-offline-live-rooms', '查看线下直播间流水', 981, true, false),
  ('management-offline-live-room-live-duration', 'management-offline-live-rooms', '查看/填写线下直播间直播时长', 982, true, false)
on conflict (permission_key) do nothing;

create table if not exists public.offline_live_sessions (
  id uuid primary key default gen_random_uuid(),
  creator_entity_id uuid not null references public.creator_entities(id) on delete restrict,
  room_id uuid references public.offline_live_rooms(id) on delete restrict,
  region_id uuid not null references public.regions(id) on delete restrict,
  room_context_type text not null default 'assigned',
  broadcast_date date not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  duration_seconds integer generated always as (extract(epoch from (ended_at - started_at))::integer) stored,
  note text,
  status text not null default 'active',
  void_reason text,
  voided_by_employee_id uuid references public.employees(id) on delete set null,
  voided_at timestamptz,
  created_by_employee_id uuid references public.employees(id) on delete set null,
  updated_by_employee_id uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint offline_live_sessions_time_check check (ended_at > started_at),
  constraint offline_live_sessions_duration_check check (duration_seconds > 0),
  constraint offline_live_sessions_status_check check (status in ('active', 'void', 'cancelled')),
  constraint offline_live_sessions_room_context_type_check check (room_context_type in ('assigned', 'temporary')),
  constraint offline_live_sessions_void_audit_check check (
    (status = 'active' and void_reason is null and voided_by_employee_id is null and voided_at is null)
    or (status in ('void', 'cancelled') and nullif(btrim(coalesce(void_reason, '')), '') is not null and voided_at is not null)
  )
);

create index if not exists offline_live_sessions_region_started_idx
  on public.offline_live_sessions(region_id, started_at)
  where status = 'active';
create index if not exists offline_live_sessions_entity_started_idx
  on public.offline_live_sessions(creator_entity_id, started_at)
  where status = 'active';
create index if not exists offline_live_sessions_room_started_idx
  on public.offline_live_sessions(room_id, started_at)
  where status = 'active';

create table if not exists public.offline_live_creator_schedules (
  id uuid primary key default gen_random_uuid(),
  creator_entity_id uuid not null references public.creator_entities(id) on delete restrict,
  region_id uuid not null references public.regions(id) on delete restrict,
  name text not null default '常规直播计划',
  status text not null default 'active',
  created_by_employee_id uuid references public.employees(id) on delete set null,
  updated_by_employee_id uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint offline_live_creator_schedules_name_check check (nullif(btrim(name), '') is not null),
  constraint offline_live_creator_schedules_status_check check (status in ('active', 'inactive'))
);

create unique index if not exists offline_live_creator_schedules_one_active_entity_idx
  on public.offline_live_creator_schedules(creator_entity_id)
  where status = 'active';
create index if not exists offline_live_creator_schedules_region_idx
  on public.offline_live_creator_schedules(region_id, status, created_at desc);

create table if not exists public.offline_live_creator_schedule_slots (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.offline_live_creator_schedules(id) on delete restrict,
  iso_weekday smallint not null,
  started_at_time time not null,
  ended_at_time time not null,
  status text not null default 'active',
  sort_order integer not null default 0,
  created_by_employee_id uuid references public.employees(id) on delete set null,
  updated_by_employee_id uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint offline_live_creator_schedule_slots_weekday_check check (iso_weekday between 1 and 7),
  constraint offline_live_creator_schedule_slots_time_check check (ended_at_time <> started_at_time),
  constraint offline_live_creator_schedule_slots_status_check check (status in ('active', 'inactive'))
);

create index if not exists offline_live_creator_schedule_slots_schedule_idx
  on public.offline_live_creator_schedule_slots(schedule_id, status, iso_weekday, sort_order);

create or replace function public.set_offline_live_session_audit_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by_employee_id := public.current_user_employee_id();
  end if;
  new.updated_by_employee_id := public.current_user_employee_id();
  new.note := nullif(btrim(coalesce(new.note, '')), '');
  new.broadcast_date := (new.started_at at time zone 'Asia/Kuala_Lumpur')::date;
  new.updated_at := now();

  if new.status in ('void', 'cancelled') and old.status = 'active' then
    new.void_reason := nullif(btrim(coalesce(new.void_reason, '')), '');
    new.voided_by_employee_id := public.current_user_employee_id();
    new.voided_at := now();
  end if;
  return new;
end;
$$;

create or replace function public.prevent_offline_live_session_overlap()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status <> 'active' then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.creator_entity_id::text, 0));
  if exists (
    select 1
    from public.offline_live_sessions existing
    where existing.creator_entity_id = new.creator_entity_id
      and existing.status = 'active'
      and existing.id is distinct from new.id
      and tstzrange(existing.started_at, existing.ended_at, '[)') && tstzrange(new.started_at, new.ended_at, '[)')
  ) then
    raise exception 'Live session overlaps an existing active session for this creator.' using errcode = '23P01';
  end if;
  return new;
end;
$$;

create or replace function public.prevent_offline_live_session_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'Offline live sessions are retained for audit. Void or cancel the session instead.';
end;
$$;

create or replace function public.prevent_offline_live_session_invalid_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.creator_entity_id is distinct from old.creator_entity_id
     or new.room_id is distinct from old.room_id
     or new.region_id is distinct from old.region_id then
    raise exception 'Offline live sessions cannot be relinked.';
  end if;
  if old.status in ('void', 'cancelled') then
    raise exception 'Voided or cancelled live sessions are immutable.';
  end if;
  if new.status = 'active' and old.status <> 'active' then
    raise exception 'Voided or cancelled live sessions cannot be reactivated.';
  end if;
  return new;
end;
$$;

create or replace function public.set_offline_live_schedule_audit_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then new.created_by_employee_id := public.current_user_employee_id(); end if;
  new.updated_by_employee_id := public.current_user_employee_id();
  new.name := btrim(new.name);
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.set_offline_live_schedule_slot_audit_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then new.created_by_employee_id := public.current_user_employee_id(); end if;
  new.updated_by_employee_id := public.current_user_employee_id();
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_offline_live_session_audit_fields on public.offline_live_sessions;
create trigger set_offline_live_session_audit_fields before insert or update on public.offline_live_sessions
for each row execute function public.set_offline_live_session_audit_fields();
drop trigger if exists prevent_offline_live_session_overlap on public.offline_live_sessions;
create trigger prevent_offline_live_session_overlap before insert or update of started_at, ended_at, status on public.offline_live_sessions
for each row execute function public.prevent_offline_live_session_overlap();
drop trigger if exists prevent_offline_live_session_invalid_update on public.offline_live_sessions;
create trigger prevent_offline_live_session_invalid_update before update on public.offline_live_sessions
for each row execute function public.prevent_offline_live_session_invalid_update();
drop trigger if exists prevent_offline_live_session_delete on public.offline_live_sessions;
create trigger prevent_offline_live_session_delete before delete on public.offline_live_sessions
for each row execute function public.prevent_offline_live_session_delete();
drop trigger if exists set_offline_live_schedule_audit_fields on public.offline_live_creator_schedules;
create trigger set_offline_live_schedule_audit_fields before insert or update on public.offline_live_creator_schedules
for each row execute function public.set_offline_live_schedule_audit_fields();
drop trigger if exists set_offline_live_schedule_slot_audit_fields on public.offline_live_creator_schedule_slots;
create trigger set_offline_live_schedule_slot_audit_fields before insert or update on public.offline_live_creator_schedule_slots
for each row execute function public.set_offline_live_schedule_slot_audit_fields();

alter table public.offline_live_sessions enable row level security;
alter table public.offline_live_creator_schedules enable row level security;
alter table public.offline_live_creator_schedule_slots enable row level security;
revoke all on public.offline_live_sessions, public.offline_live_creator_schedules, public.offline_live_creator_schedule_slots from public, anon, authenticated;

create or replace function public.current_user_can_access_offline_live_room_sensitive_data(
  p_permission_key text,
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
     or p_permission_key not in ('management-offline-live-room-revenue', 'management-offline-live-room-live-duration')
     or p_action not in ('view', 'use') then
    return false;
  end if;
  return public.current_user_has_permission('management-offline-live-rooms', 'view')
    and public.current_user_has_explicit_permission(p_permission_key, p_action)
    and public.current_user_can_access_region(p_region_id);
end;
$$;

create or replace function public.list_offline_live_room_revenue(
  p_region_id uuid,
  p_period_start_dates date[]
)
returns table(
  room_id uuid,
  creator_entity_id uuid,
  creator_profile_id uuid,
  platform public.creator_platform,
  revenue_amount numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_region_id is null or coalesce(array_length(p_period_start_dates, 1), 0) = 0
     or not public.current_user_can_access_offline_live_room_sensitive_data('management-offline-live-room-revenue', 'view', p_region_id) then
    raise exception 'Permission denied.';
  end if;
  return query
  with canonical_records as (
    select ranked.*
    from (
      select record.*,
        row_number() over (
          partition by record.creator_profile_id, record.week_start_date
          order by coalesce(record.updated_at, record.submitted_at, record.created_at) desc
        ) as row_number
      from public.creator_weekly_revenue_records record
      where record.week_start_date = any(p_period_start_dates)
        and record.status in ('submitted', 'confirmed')
    ) ranked
    where ranked.row_number = 1
  )
  select room.id, assignment.creator_entity_id, profile.id, profile.platform,
    coalesce(sum(record.revenue_amount), 0)::numeric
  from public.offline_live_rooms room
  join public.offline_live_room_creators assignment
    on assignment.room_id = room.id and assignment.status = 'active' and assignment.ended_at is null
  join public.creator_profiles profile
    on profile.creator_entity_id = assignment.creator_entity_id
   and profile.status = 'active' and profile.membership_status = 'active'
  left join canonical_records record
    on record.creator_profile_id = profile.id
  where room.region_id = p_region_id and room.status = 'active'
  group by room.id, assignment.creator_entity_id, profile.id, profile.platform;
end;
$$;

create or replace function public.list_offline_live_sessions(
  p_region_id uuid,
  p_start_date date,
  p_end_date date,
  p_include_voided boolean default false
)
returns table(
  id uuid, creator_entity_id uuid, room_id uuid, room_context_type text, broadcast_date date,
  started_at timestamptz, ended_at timestamptz, duration_seconds integer,
  note text, status text, void_reason text, voided_at timestamptz,
  created_by_employee_id uuid, updated_by_employee_id uuid, created_at timestamptz, updated_at timestamptz,
  creator_display_name text, creator_platforms jsonb
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_start timestamptz; v_end timestamptz;
begin
  if p_region_id is null or p_start_date is null or p_end_date is null or p_end_date < p_start_date
     or not public.current_user_can_access_offline_live_room_sensitive_data('management-offline-live-room-live-duration', 'view', p_region_id) then
    raise exception 'Permission denied.';
  end if;
  v_start := p_start_date::timestamp at time zone 'Asia/Kuala_Lumpur';
  v_end := (p_end_date + 1)::timestamp at time zone 'Asia/Kuala_Lumpur';
  return query
  select session.id, session.creator_entity_id, session.room_id, session.room_context_type, session.broadcast_date,
    session.started_at, session.ended_at, session.duration_seconds,
    session.note, session.status, session.void_reason, session.voided_at,
    session.created_by_employee_id, session.updated_by_employee_id, session.created_at, session.updated_at,
    entity.display_name,
    coalesce(platforms.items, '[]'::jsonb)
  from public.offline_live_sessions session
  join public.creator_entities entity on entity.id = session.creator_entity_id
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'platform', profile.platform,
      'creator_name', profile.creator_name,
      'platform_user_id', profile.platform_user_id,
      'platform_account', profile.platform_account
    ) order by profile.platform, profile.id) as items
    from public.creator_profiles profile
    where profile.creator_entity_id = entity.id
      and profile.status = 'active' and profile.membership_status = 'active'
  ) platforms on true
  where session.region_id = p_region_id
    and (p_include_voided or session.status = 'active')
    and session.started_at < v_end and session.ended_at > v_start
  order by session.started_at, session.id;
end;
$$;

create or replace function public.search_offline_live_room_creator_entities(
  p_region_id uuid,
  p_query text default null,
  p_creator_entity_ids uuid[] default null,
  p_limit integer default 20
)
returns table(
  creator_entity_id uuid, display_name text, region_id uuid, platforms jsonb
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_query text := nullif(btrim(coalesce(p_query, '')), ''); v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
begin
  if auth.uid() is null or p_region_id is null
     or not public.current_user_can_access_offline_live_room_sensitive_data('management-offline-live-room-live-duration', 'use', p_region_id) then
    raise exception 'Permission denied.';
  end if;
  if v_query is null and coalesce(array_length(p_creator_entity_ids, 1), 0) = 0 then
    return;
  end if;
  return query
  select entity.id, entity.display_name, entity.region_id,
    coalesce(jsonb_agg(jsonb_build_object(
      'platform', profile.platform,
      'creator_name', profile.creator_name,
      'platform_user_id', profile.platform_user_id,
      'platform_account', profile.platform_account
    ) order by profile.platform, profile.id) filter (where profile.id is not null), '[]'::jsonb)
  from public.creator_entities entity
  left join public.creator_profiles profile
    on profile.creator_entity_id = entity.id
   and profile.status = 'active' and profile.membership_status = 'active'
  where entity.region_id = p_region_id and entity.status = 'active'
    and (
      entity.id = any(coalesce(p_creator_entity_ids, '{}'::uuid[]))
      or (v_query is not null and (
        entity.display_name ilike '%' || v_query || '%'
        or coalesce(profile.creator_name, '') ilike '%' || v_query || '%'
        or coalesce(profile.platform_user_id, '') ilike '%' || v_query || '%'
        or coalesce(profile.platform_account, '') ilike '%' || v_query || '%'
      ))
    )
  group by entity.id, entity.display_name, entity.region_id
  order by entity.display_name, entity.id
  limit v_limit;
end;
$$;

create or replace function public.create_offline_live_session(
  p_creator_entity_id uuid,
  p_room_id uuid,
  p_room_context_type text,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_entity public.creator_entities; v_room public.offline_live_rooms; v_session_id uuid;
begin
  if auth.uid() is null or p_creator_entity_id is null or p_room_id is null or p_room_context_type not in ('assigned', 'temporary') or p_started_at is null or p_ended_at is null or p_ended_at <= p_started_at then
    raise exception 'Valid creator, room, context type, and chronological start/end timestamps are required.';
  end if;
  select * into v_entity from public.creator_entities where id = p_creator_entity_id and status = 'active';
  if v_entity.id is null
     or not public.current_user_can_access_offline_live_room_sensitive_data('management-offline-live-room-live-duration', 'use', v_entity.region_id) then
    raise exception 'Creator access denied.';
  end if;
  select * into v_room from public.offline_live_rooms where id = p_room_id and status = 'active';
  if v_room.id is null or v_room.region_id <> v_entity.region_id then raise exception 'Room access denied.'; end if;
  if p_room_context_type = 'assigned' and not exists (
    select 1 from public.offline_live_room_creators assignment
    where assignment.creator_entity_id = v_entity.id and assignment.room_id = v_room.id
      and assignment.status = 'active' and assignment.ended_at is null
  ) then
    raise exception 'Creator does not have an active assignment to this offline live room.';
  end if;
  insert into public.offline_live_sessions(creator_entity_id, room_id, region_id, room_context_type, broadcast_date, started_at, ended_at, note)
  values(v_entity.id, v_room.id, v_entity.region_id, p_room_context_type, (p_started_at at time zone 'Asia/Kuala_Lumpur')::date, p_started_at, p_ended_at, p_note)
  returning id into v_session_id;
  return v_session_id;
end;
$$;

create or replace function public.update_offline_live_session(
  p_session_id uuid,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_session public.offline_live_sessions;
begin
  if auth.uid() is null or p_session_id is null or p_started_at is null or p_ended_at is null or p_ended_at <= p_started_at then
    raise exception 'Valid session and chronological start/end timestamps are required.';
  end if;
  select * into v_session from public.offline_live_sessions where id = p_session_id for update;
  if v_session.id is null or v_session.status <> 'active'
     or not public.current_user_can_access_offline_live_room_sensitive_data('management-offline-live-room-live-duration', 'use', v_session.region_id) then
    raise exception 'Live session access denied.';
  end if;
  update public.offline_live_sessions
  set started_at = p_started_at, ended_at = p_ended_at, note = p_note
  where id = v_session.id;
end;
$$;

create or replace function public.void_offline_live_session(
  p_session_id uuid,
  p_status text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_session public.offline_live_sessions;
begin
  if auth.uid() is null or p_session_id is null or p_status not in ('void', 'cancelled') or nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Valid session, void status, and reason are required.';
  end if;
  select * into v_session from public.offline_live_sessions where id = p_session_id for update;
  if v_session.id is null or v_session.status <> 'active'
     or not public.current_user_can_access_offline_live_room_sensitive_data('management-offline-live-room-live-duration', 'use', v_session.region_id) then
    raise exception 'Live session access denied.';
  end if;
  update public.offline_live_sessions set status = p_status, void_reason = p_reason where id = v_session.id;
end;
$$;

create or replace function public.list_offline_live_creator_schedules(p_region_id uuid)
returns table(
  id uuid, creator_entity_id uuid, name text, status text,
  created_by_employee_id uuid, updated_by_employee_id uuid, created_at timestamptz, updated_at timestamptz, slots jsonb
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_region_id is null
     or not public.current_user_can_access_offline_live_room_sensitive_data('management-offline-live-room-live-duration', 'view', p_region_id) then
    raise exception 'Permission denied.';
  end if;
  return query
  select schedule.id, schedule.creator_entity_id, schedule.name, schedule.status,
    schedule.created_by_employee_id, schedule.updated_by_employee_id, schedule.created_at, schedule.updated_at,
    coalesce(jsonb_agg(jsonb_build_object('id', slot.id, 'iso_weekday', slot.iso_weekday, 'started_at_time', slot.started_at_time, 'ended_at_time', slot.ended_at_time, 'status', slot.status, 'sort_order', slot.sort_order) order by slot.iso_weekday, slot.sort_order, slot.id) filter (where slot.id is not null), '[]'::jsonb)
  from public.offline_live_creator_schedules schedule
  left join public.offline_live_creator_schedule_slots slot on slot.schedule_id = schedule.id
  where schedule.region_id = p_region_id
  group by schedule.id
  order by schedule.creator_entity_id, schedule.created_at, schedule.id;
end;
$$;

create or replace function public.save_offline_live_creator_schedule(
  p_schedule_id uuid,
  p_creator_entity_id uuid,
  p_name text,
  p_status text,
  p_slots jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_schedule public.offline_live_creator_schedules; v_entity public.creator_entities; v_slot jsonb; v_slot_id uuid; v_result_id uuid;
begin
  if auth.uid() is null or p_creator_entity_id is null or nullif(btrim(coalesce(p_name, '')), '') is null
     or p_status not in ('active', 'inactive') or jsonb_typeof(p_slots) <> 'array' then
    raise exception 'Valid schedule data is required.';
  end if;
  select * into v_entity from public.creator_entities where id = p_creator_entity_id and status = 'active';
  if v_entity.id is null
     or not public.current_user_can_access_offline_live_room_sensitive_data('management-offline-live-room-live-duration', 'use', v_entity.region_id) then
    raise exception 'Creator access denied.';
  end if;
  if p_schedule_id is null then
    insert into public.offline_live_creator_schedules(creator_entity_id, region_id, name, status)
    values(v_entity.id, v_entity.region_id, p_name, p_status) returning id into v_result_id;
  else
    select * into v_schedule from public.offline_live_creator_schedules where id = p_schedule_id for update;
    if v_schedule.id is null or v_schedule.creator_entity_id <> v_entity.id or v_schedule.region_id <> v_entity.region_id then
      raise exception 'Schedule access denied.';
    end if;
    update public.offline_live_creator_schedules set name = p_name, status = p_status where id = v_schedule.id;
    v_result_id := v_schedule.id;
  end if;
  for v_slot in select value from jsonb_array_elements(p_slots) loop
    if (v_slot->>'iso_weekday')::smallint not between 1 and 7
       or (v_slot->>'started_at_time')::time is null or (v_slot->>'ended_at_time')::time is null
       or (v_slot->>'started_at_time')::time = (v_slot->>'ended_at_time')::time
       or coalesce(v_slot->>'status', 'active') not in ('active', 'inactive') then
      raise exception 'Invalid schedule slot.';
    end if;
    v_slot_id := nullif(v_slot->>'id', '')::uuid;
    if v_slot_id is null then
      insert into public.offline_live_creator_schedule_slots(schedule_id, iso_weekday, started_at_time, ended_at_time, status, sort_order)
      values(v_result_id, (v_slot->>'iso_weekday')::smallint, (v_slot->>'started_at_time')::time, (v_slot->>'ended_at_time')::time, coalesce(v_slot->>'status', 'active'), coalesce((v_slot->>'sort_order')::integer, 0));
    else
      update public.offline_live_creator_schedule_slots
      set iso_weekday = (v_slot->>'iso_weekday')::smallint,
          started_at_time = (v_slot->>'started_at_time')::time,
          ended_at_time = (v_slot->>'ended_at_time')::time,
          status = coalesce(v_slot->>'status', 'active'),
          sort_order = coalesce((v_slot->>'sort_order')::integer, 0)
      where id = v_slot_id and schedule_id = v_result_id;
      if not found then raise exception 'Schedule slot access denied.'; end if;
    end if;
  end loop;
  return v_result_id;
end;
$$;

revoke all on function public.current_user_can_access_offline_live_room_sensitive_data(text, text, uuid) from public, anon;
revoke all on function public.list_offline_live_room_revenue(uuid, date[]) from public, anon;
revoke all on function public.list_offline_live_sessions(uuid, date, date, boolean) from public, anon;
revoke all on function public.search_offline_live_room_creator_entities(uuid, text, uuid[], integer) from public, anon;
revoke all on function public.create_offline_live_session(uuid, uuid, text, timestamptz, timestamptz, text) from public, anon;
revoke all on function public.update_offline_live_session(uuid, timestamptz, timestamptz, text) from public, anon;
revoke all on function public.void_offline_live_session(uuid, text, text) from public, anon;
revoke all on function public.list_offline_live_creator_schedules(uuid) from public, anon;
revoke all on function public.save_offline_live_creator_schedule(uuid, uuid, text, text, jsonb) from public, anon;
grant execute on function public.current_user_can_access_offline_live_room_sensitive_data(text, text, uuid) to authenticated;
grant execute on function public.list_offline_live_room_revenue(uuid, date[]) to authenticated;
grant execute on function public.list_offline_live_sessions(uuid, date, date, boolean) to authenticated;
grant execute on function public.search_offline_live_room_creator_entities(uuid, text, uuid[], integer) to authenticated;
grant execute on function public.create_offline_live_session(uuid, uuid, text, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.update_offline_live_session(uuid, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.void_offline_live_session(uuid, text, text) to authenticated;
grant execute on function public.list_offline_live_creator_schedules(uuid) to authenticated;
grant execute on function public.save_offline_live_creator_schedule(uuid, uuid, text, text, jsonb) to authenticated;

commit;
