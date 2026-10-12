-- Phase 2: explicitly promote one legacy, single-platform profile to an entity.
-- The original creator_profiles row (and therefore its historical revenue FK) is retained.
create or replace function public.upgrade_legacy_creator_profile_to_entity(p_creator_profile_id uuid)
returns table (creator_entity_id uuid, creator_profile_id uuid, created boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_profile public.creator_profiles; v_entity_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication is required.'; end if;
  if not public.current_user_has_permission('management-streamer-stats', 'use') then raise exception 'Permission denied.'; end if;
  select * into v_profile from public.creator_profiles where id = p_creator_profile_id for update;
  if not found then raise exception 'Creator profile not found.'; end if;
  if v_profile.status <> 'active' or v_profile.membership_status <> 'active' then raise exception 'Only active creator profiles can be upgraded.'; end if;
  if v_profile.region_id is null or not public.current_user_can_access_region(v_profile.region_id) then raise exception 'Region access denied.'; end if;
  if v_profile.creator_entity_id is not null then return query select v_profile.creator_entity_id, v_profile.id, false; return; end if;
  insert into public.creator_entities (display_name,region_id,scout_employee_id,scout_profile_id,manager_employee_id,registration_type,guild_joined_date,status,created_by,updated_by) values (v_profile.creator_name,v_profile.region_id,v_profile.scout_employee_id,v_profile.scout_profile_id,v_profile.manager_employee_id,'existing_creator',v_profile.joined_date,'active',auth.uid(),auth.uid()) returning id into v_entity_id;
  update public.creator_profiles as profile set creator_entity_id = v_entity_id where profile.id = v_profile.id and profile.creator_entity_id is null;
  if not found then raise exception 'Creator profile was linked concurrently; retry the operation.'; end if;
  return query select v_entity_id, v_profile.id, true;
end;
$$;
revoke all on function public.upgrade_legacy_creator_profile_to_entity(uuid) from public, anon;
grant execute on function public.upgrade_legacy_creator_profile_to_entity(uuid) to authenticated;
