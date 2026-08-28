begin;

insert into public.permission_items (permission_key, parent_key, name, sort_order, is_reserved)
values
  ('management-offline-live-rooms', 'management', '线下直播间管理', 98, false)
on conflict (permission_key) do update
set parent_key = excluded.parent_key,
    name = excluded.name,
    sort_order = excluded.sort_order,
    is_reserved = excluded.is_reserved;

create table if not exists public.offline_live_rooms (
  id uuid primary key default gen_random_uuid(),
  region_id uuid not null references public.regions(id) on delete restrict,
  room_number text not null,
  name text not null,
  status text not null default 'active',
  sort_order integer not null default 0,
  created_by_employee_id uuid references public.employees(id) on delete set null,
  updated_by_employee_id uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint offline_live_rooms_room_number_check
    check (nullif(btrim(room_number), '') is not null),
  constraint offline_live_rooms_name_check
    check (nullif(btrim(name), '') is not null),
  constraint offline_live_rooms_status_check
    check (status in ('active', 'inactive')),
  constraint offline_live_rooms_region_room_number_unique
    unique (region_id, room_number)
);

create table if not exists public.offline_live_room_creators (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.offline_live_rooms(id) on delete restrict,
  creator_entity_id uuid not null references public.creator_entities(id) on delete restrict,
  status text not null default 'active',
  assigned_at timestamptz not null default now(),
  ended_at timestamptz,
  created_by_employee_id uuid references public.employees(id) on delete set null,
  updated_by_employee_id uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint offline_live_room_creators_status_check
    check (status in ('active', 'inactive')),
  constraint offline_live_room_creators_ended_at_check
    check (
      (status = 'active' and ended_at is null)
      or (status = 'inactive' and ended_at is not null)
    )
);

create index if not exists offline_live_rooms_region_status_sort_idx
on public.offline_live_rooms(region_id, status, sort_order, room_number);

create index if not exists offline_live_room_creators_room_status_idx
on public.offline_live_room_creators(room_id, status, assigned_at);

create index if not exists offline_live_room_creators_entity_status_idx
on public.offline_live_room_creators(creator_entity_id, status);

create unique index if not exists offline_live_room_creators_one_active_entity_per_room_idx
on public.offline_live_room_creators(room_id, creator_entity_id)
where status = 'active' and ended_at is null;

create unique index if not exists offline_live_room_creators_one_active_room_per_entity_idx
on public.offline_live_room_creators(creator_entity_id)
where status = 'active' and ended_at is null;

create or replace function public.set_offline_live_room_audit_fields()
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
  new.room_number := btrim(new.room_number);
  new.name := btrim(new.name);
  new.updated_at := now();

  return new;
end;
$$;

create or replace function public.set_offline_live_room_creator_audit_fields()
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
  new.updated_at := now();

  if new.status = 'inactive' and new.ended_at is null then
    new.ended_at := now();
  end if;

  if new.status = 'active' then
    new.ended_at := null;
  end if;

  return new;
end;
$$;

create or replace function public.deactivate_offline_live_room_assignments()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'inactive' and old.status is distinct from new.status then
    update public.offline_live_room_creators
    set status = 'inactive',
        ended_at = coalesce(ended_at, now()),
        updated_by_employee_id = public.current_user_employee_id(),
        updated_at = now()
    where room_id = new.id
      and status = 'active';
  end if;

  return new;
end;
$$;

drop trigger if exists set_offline_live_room_audit_fields on public.offline_live_rooms;
create trigger set_offline_live_room_audit_fields
before insert or update on public.offline_live_rooms
for each row execute function public.set_offline_live_room_audit_fields();

drop trigger if exists deactivate_offline_live_room_assignments on public.offline_live_rooms;
create trigger deactivate_offline_live_room_assignments
after update of status on public.offline_live_rooms
for each row execute function public.deactivate_offline_live_room_assignments();

drop trigger if exists set_offline_live_room_creator_audit_fields on public.offline_live_room_creators;
create trigger set_offline_live_room_creator_audit_fields
before insert or update on public.offline_live_room_creators
for each row execute function public.set_offline_live_room_creator_audit_fields();

alter table public.offline_live_rooms enable row level security;
alter table public.offline_live_room_creators enable row level security;

drop policy if exists "Managers can read offline live rooms" on public.offline_live_rooms;
create policy "Managers can read offline live rooms"
on public.offline_live_rooms for select to authenticated
using (
  public.current_user_has_permission('management-offline-live-rooms', 'view')
  and public.current_user_can_access_region(region_id)
);

drop policy if exists "Managers can create offline live rooms" on public.offline_live_rooms;
create policy "Managers can create offline live rooms"
on public.offline_live_rooms for insert to authenticated
with check (
  public.current_user_has_permission('management-offline-live-rooms', 'use')
  and public.current_user_can_access_region(region_id)
);

drop policy if exists "Managers can update offline live rooms" on public.offline_live_rooms;
create policy "Managers can update offline live rooms"
on public.offline_live_rooms for update to authenticated
using (
  public.current_user_has_permission('management-offline-live-rooms', 'use')
  and public.current_user_can_access_region(region_id)
)
with check (
  public.current_user_has_permission('management-offline-live-rooms', 'use')
  and public.current_user_can_access_region(region_id)
);

drop policy if exists "Managers can read offline live room creators" on public.offline_live_room_creators;
create policy "Managers can read offline live room creators"
on public.offline_live_room_creators for select to authenticated
using (
  public.current_user_has_permission('management-offline-live-rooms', 'view')
  and exists (
    select 1
    from public.offline_live_rooms room
    where room.id = offline_live_room_creators.room_id
      and public.current_user_can_access_region(room.region_id)
  )
);

drop policy if exists "Managers can create offline live room creators" on public.offline_live_room_creators;
create policy "Managers can create offline live room creators"
on public.offline_live_room_creators for insert to authenticated
with check (
  public.current_user_has_permission('management-offline-live-rooms', 'use')
  and exists (
    select 1
    from public.offline_live_rooms room
    join public.creator_entities entity
      on entity.id = offline_live_room_creators.creator_entity_id
     and entity.region_id = room.region_id
    where room.id = offline_live_room_creators.room_id
      and room.status = 'active'
      and entity.status = 'active'
      and public.current_user_can_access_region(room.region_id)
  )
);

drop policy if exists "Managers can update offline live room creators" on public.offline_live_room_creators;
create policy "Managers can update offline live room creators"
on public.offline_live_room_creators for update to authenticated
using (
  public.current_user_has_permission('management-offline-live-rooms', 'use')
  and exists (
    select 1
    from public.offline_live_rooms room
    where room.id = offline_live_room_creators.room_id
      and public.current_user_can_access_region(room.region_id)
  )
)
with check (
  public.current_user_has_permission('management-offline-live-rooms', 'use')
  and exists (
    select 1
    from public.offline_live_rooms room
    join public.creator_entities entity
      on entity.id = offline_live_room_creators.creator_entity_id
     and entity.region_id = room.region_id
    where room.id = offline_live_room_creators.room_id
      and public.current_user_can_access_region(room.region_id)
      and (
        offline_live_room_creators.status = 'inactive'
        or (
          offline_live_room_creators.status = 'active'
          and room.status = 'active'
          and entity.status = 'active'
        )
      )
  )
);

commit;
