begin;

create or replace function public.can_manage_offline_live_room_assignment(
  p_room_id uuid,
  p_creator_entity_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_id uuid := public.current_user_employee_id();
begin
  if auth.uid() is null or v_employee_id is null then
    return false;
  end if;

  if not public.current_user_has_permission('management-offline-live-rooms', 'use') then
    return false;
  end if;

  return exists (
    select 1
    from public.offline_live_rooms room
    join public.creator_entities entity
      on entity.id = p_creator_entity_id
     and entity.region_id = room.region_id
     and entity.status = 'active'
    where room.id = p_room_id
      and room.status = 'active'
      and public.current_user_can_access_region(room.region_id)
  );
end;
$$;

revoke all on function public.can_manage_offline_live_room_assignment(uuid, uuid) from public;
grant execute on function public.can_manage_offline_live_room_assignment(uuid, uuid) to authenticated;

create or replace function public.prevent_offline_live_room_assignment_relink()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.room_id is distinct from old.room_id
     or new.creator_entity_id is distinct from old.creator_entity_id then
    raise exception 'Offline live room assignments cannot be relinked. Deactivate the current assignment and create a new one.';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_offline_live_room_assignment_relink on public.offline_live_room_creators;
create trigger prevent_offline_live_room_assignment_relink
before update on public.offline_live_room_creators
for each row execute function public.prevent_offline_live_room_assignment_relink();

drop policy if exists "Managers can create offline live room creators" on public.offline_live_room_creators;
create policy "Managers can create offline live room creators"
on public.offline_live_room_creators for insert to authenticated
with check (
  public.can_manage_offline_live_room_assignment(room_id, creator_entity_id)
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
  (
    offline_live_room_creators.status = 'inactive'
    and public.current_user_has_permission('management-offline-live-rooms', 'use')
    and exists (
      select 1
      from public.offline_live_rooms room
      where room.id = offline_live_room_creators.room_id
        and public.current_user_can_access_region(room.region_id)
    )
  )
  or (
    offline_live_room_creators.status = 'active'
    and public.can_manage_offline_live_room_assignment(room_id, creator_entity_id)
  )
);

commit;
