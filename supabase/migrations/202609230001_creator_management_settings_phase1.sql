begin;

-- Entity-level settings describe the real creator. Platform-specific revenue
-- settings stay on creator_profiles so TikTok and Douyin can diverge later.
alter table public.creator_entities
  add column if not exists is_priority boolean not null default false,
  add column if not exists operation_status text not null default 'normal',
  add column if not exists operation_status_reason text,
  add column if not exists operation_status_updated_at timestamptz not null default now(),
  add constraint creator_entities_operation_status_check
    check (operation_status in ('normal', 'paused', 'long_term_stopped', 'resigned', 'terminated', 'other'));

alter table public.creator_profiles
  add column if not exists revenue_cycle text not null default 'weekly',
  add column if not exists revenue_input_mode text not null default 'direct',
  add constraint creator_profiles_revenue_cycle_check
    check (revenue_cycle in ('weekly', 'monthly', 'none')),
  add constraint creator_profiles_revenue_input_mode_check
    check (revenue_input_mode in ('direct', 'cumulative'));

-- Deliberately no backfill: historical attribution remains null.
alter table public.creator_weekly_revenue_records
  add column if not exists manager_employee_id_attribution uuid references public.employees(id) on delete set null;

create or replace function public.sync_creator_weekly_revenue_manager_attribution()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    select manager_employee_id into new.manager_employee_id_attribution
    from public.creator_profiles where id = new.creator_profile_id;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_creator_weekly_revenue_manager_attribution on public.creator_weekly_revenue_records;
create trigger sync_creator_weekly_revenue_manager_attribution
before insert on public.creator_weekly_revenue_records
for each row execute function public.sync_creator_weekly_revenue_manager_attribution();

create or replace function public.get_creator_entity_management_settings(p_creator_entity_id uuid)
returns table (
  is_priority boolean, operation_status text, operation_status_reason text,
  operation_status_updated_at timestamptz, creator_profile_id uuid,
  revenue_cycle text, revenue_input_mode text
) language sql stable security definer set search_path = public, pg_temp as $$
  select e.is_priority, e.operation_status, e.operation_status_reason, e.operation_status_updated_at,
         p.id, p.revenue_cycle, p.revenue_input_mode
  from public.creator_entities e join public.creator_profiles p on p.creator_entity_id = e.id and p.membership_status = 'active' and p.status = 'active'
  where e.id = p_creator_entity_id
    and auth.uid() is not null
    and ((public.current_user_has_permission('agent-creator-data', 'view') and e.manager_employee_id = public.current_user_employee_id())
      or (public.current_user_has_permission('management-streamer-stats', 'view') and public.current_user_can_access_region(e.region_id)));
$$;

create or replace function public.save_creator_entity_management_settings(
  p_creator_entity_id uuid, p_is_priority boolean, p_operation_status text,
  p_operation_status_reason text, p_profile_settings jsonb
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_region_id uuid; v_manager_id uuid; v_reason text := nullif(btrim(coalesce(p_operation_status_reason, '')), '');
begin
  if auth.uid() is null then raise exception 'Authentication is required.'; end if;
  select region_id, manager_employee_id into v_region_id, v_manager_id from public.creator_entities where id = p_creator_entity_id for update;
  if v_region_id is null or not public.current_user_can_access_region(v_region_id) then raise exception 'Region access denied.'; end if;
  if not ((public.current_user_has_permission('agent-creator-data', 'use') and v_manager_id = public.current_user_employee_id()) or public.current_user_has_permission('management-streamer-stats', 'use')) then raise exception 'Permission denied.'; end if;
  if p_operation_status not in ('normal', 'paused', 'long_term_stopped', 'resigned', 'terminated', 'other') then raise exception 'Invalid operation status.'; end if;
  if p_operation_status = 'other' and v_reason is null then raise exception 'Reason is required for other operation status.'; end if;
  if p_profile_settings is null or jsonb_typeof(p_profile_settings) <> 'array' then raise exception 'Profile settings must be an array.'; end if;
  if exists (select 1 from jsonb_to_recordset(p_profile_settings) as s(id uuid, revenue_cycle text, revenue_input_mode text) where s.revenue_cycle not in ('weekly','monthly','none') or s.revenue_input_mode not in ('direct','cumulative')) then raise exception 'Invalid revenue settings.'; end if;
  if (select count(*) from jsonb_to_recordset(p_profile_settings) as s(id uuid, revenue_cycle text, revenue_input_mode text)) <> (select count(*) from public.creator_profiles where creator_entity_id = p_creator_entity_id and membership_status = 'active' and status = 'active') then raise exception 'All active platform profiles must be included.'; end if;
  update public.creator_entities set is_priority = coalesce(p_is_priority, false), operation_status = p_operation_status, operation_status_reason = v_reason, operation_status_updated_at = now(), updated_by = auth.uid() where id = p_creator_entity_id;
  update public.creator_profiles p set revenue_cycle = s.revenue_cycle, revenue_input_mode = s.revenue_input_mode
  from jsonb_to_recordset(p_profile_settings) as s(id uuid, revenue_cycle text, revenue_input_mode text)
  where p.id = s.id and p.creator_entity_id = p_creator_entity_id and p.membership_status = 'active' and p.status = 'active';
end;
$$;

revoke all on function public.sync_creator_weekly_revenue_manager_attribution() from public;
revoke all on function public.get_creator_entity_management_settings(uuid) from public, anon;
revoke all on function public.save_creator_entity_management_settings(uuid, boolean, text, text, jsonb) from public, anon;
grant execute on function public.get_creator_entity_management_settings(uuid) to authenticated;
grant execute on function public.save_creator_entity_management_settings(uuid, boolean, text, text, jsonb) to authenticated;
commit;
