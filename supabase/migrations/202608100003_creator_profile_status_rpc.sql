create or replace function public.prevent_creator_profile_status_change_without_super_admin()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status is distinct from old.status
     and not public.current_user_is_super_admin() then
    raise exception 'Only super_admin can change creator profile status.';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_creator_profile_status_change_without_super_admin
on public.creator_profiles;

create trigger prevent_creator_profile_status_change_without_super_admin
before update on public.creator_profiles
for each row
execute function public.prevent_creator_profile_status_change_without_super_admin();

revoke all on function public.prevent_creator_profile_status_change_without_super_admin() from public;

create or replace function public.set_creator_profile_status(
  p_creator_profile_id uuid,
  p_to_status text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_status text;
  normalized_reason text;
begin
  if not public.current_user_is_super_admin() then
    raise exception 'Only super_admin can change creator profile status.';
  end if;

  if p_to_status not in ('active', 'invalid') then
    raise exception 'Invalid creator profile status: %', p_to_status;
  end if;

  normalized_reason := nullif(btrim(coalesce(p_reason, '')), '');

  if p_to_status = 'invalid' and normalized_reason is null then
    raise exception 'Reason is required when marking a creator profile as invalid.';
  end if;

  select status
  into current_status
  from public.creator_profiles
  where id = p_creator_profile_id
  for update;

  if not found then
    raise exception 'Creator profile not found: %', p_creator_profile_id;
  end if;

  if current_status = p_to_status then
    return;
  end if;

  update public.creator_profiles
  set status = p_to_status
  where id = p_creator_profile_id;

  insert into public.creator_profile_status_history (
    creator_profile_id,
    from_status,
    to_status,
    reason,
    changed_by
  )
  values (
    p_creator_profile_id,
    current_status,
    p_to_status,
    normalized_reason,
    auth.uid()
  );
end;
$$;

revoke all on function public.set_creator_profile_status(uuid, text, text) from public;
grant execute on function public.set_creator_profile_status(uuid, text, text) to authenticated;
