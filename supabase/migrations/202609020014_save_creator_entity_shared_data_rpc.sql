create or replace function public.save_creator_entity_shared_data(
  p_creator_entity_id uuid,
  p_display_name text,
  p_region_id uuid,
  p_scout_employee_id uuid,
  p_manager_employee_id uuid,
  p_registration_type text,
  p_guild_joined_date date,
  p_bank_account_name text,
  p_bank_name text,
  p_bank_account text,
  p_secondary_scout_employee_id uuid,
  p_secondary_manager_employee_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  if not public.current_user_has_permission('management-streamer-stats', 'use') then
    raise exception 'Permission denied.';
  end if;

  perform 1
  from public.creator_entities entity
  where entity.id = p_creator_entity_id
  for update;

  if not found then
    raise exception 'Creator entity not found.';
  end if;

  perform public.update_creator_entity_shared_profile_data(
    p_creator_entity_id,
    p_display_name,
    p_region_id,
    p_scout_employee_id,
    p_manager_employee_id,
    p_registration_type,
    p_guild_joined_date,
    p_bank_account_name,
    p_bank_name,
    p_bank_account
  );

  perform public.update_creator_entity_collaborators(
    p_creator_entity_id,
    p_secondary_scout_employee_id,
    p_secondary_manager_employee_id
  );
end;
$$;

revoke all on function public.update_creator_entity_shared_profile_data(uuid, text, uuid, uuid, uuid, text, date, text, text, text) from public;
revoke all on function public.update_creator_entity_shared_profile_data(uuid, text, uuid, uuid, uuid, text, date, text, text, text) from authenticated;
revoke all on function public.update_creator_entity_collaborators(uuid, uuid, uuid) from public;
revoke all on function public.update_creator_entity_collaborators(uuid, uuid, uuid) from authenticated;

revoke all on function public.save_creator_entity_shared_data(uuid, text, uuid, uuid, uuid, text, date, text, text, text, uuid, uuid) from public;
grant execute on function public.save_creator_entity_shared_data(uuid, text, uuid, uuid, uuid, text, date, text, text, text, uuid, uuid) to authenticated;
