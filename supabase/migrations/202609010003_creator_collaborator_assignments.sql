-- Secondary collaborators are deliberately separate from primary attribution.
-- Existing revenue, rankings, creator totals, and scout statistics remain based on
-- creator_profiles' primary scout/manager columns.
create table public.creator_collaborator_assignments (
  id uuid primary key default gen_random_uuid(),
  creator_entity_id uuid references public.creator_entities(id) on delete cascade,
  creator_profile_id uuid references public.creator_profiles(id) on delete cascade,
  assignment_type text not null,
  employee_id uuid not null references public.employees(id) on delete restrict,
  assignment_role text not null default 'secondary',
  status text not null default 'active',
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  ended_at timestamptz,
  ended_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint creator_collaborator_assignments_target_check check ((creator_entity_id is null) <> (creator_profile_id is null)),
  constraint creator_collaborator_assignments_type_check check (assignment_type in ('scout', 'manager')),
  constraint creator_collaborator_assignments_role_check check (assignment_role = 'secondary'),
  constraint creator_collaborator_assignments_status_check check (status in ('active', 'inactive')),
  constraint creator_collaborator_assignments_end_check check ((status = 'active' and ended_at is null and ended_by is null) or status = 'inactive')
);

alter table public.creator_collaborator_assignments enable row level security;
revoke all on table public.creator_collaborator_assignments from anon, authenticated;

create index creator_collaborator_assignments_active_employee_entity_idx on public.creator_collaborator_assignments (employee_id, assignment_type, creator_entity_id) where status = 'active' and creator_entity_id is not null;
create index creator_collaborator_assignments_active_employee_profile_idx on public.creator_collaborator_assignments (employee_id, assignment_type, creator_profile_id) where status = 'active' and creator_profile_id is not null;
create unique index creator_collaborator_assignments_active_entity_employee_idx on public.creator_collaborator_assignments (creator_entity_id, assignment_type, employee_id) where status = 'active' and creator_entity_id is not null;
create unique index creator_collaborator_assignments_active_profile_employee_idx on public.creator_collaborator_assignments (creator_profile_id, assignment_type, employee_id) where status = 'active' and creator_profile_id is not null;
create unique index creator_collaborator_assignments_one_active_entity_type_idx on public.creator_collaborator_assignments (creator_entity_id, assignment_type) where status = 'active' and creator_entity_id is not null;
create unique index creator_collaborator_assignments_one_active_profile_type_idx on public.creator_collaborator_assignments (creator_profile_id, assignment_type) where status = 'active' and creator_profile_id is not null;

create trigger set_creator_collaborator_assignments_updated_at before update on public.creator_collaborator_assignments for each row execute function public.set_updated_at();

create or replace function public.is_onboarding_manager_employee(p_employee_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  with recursive applicable_permissions as (
    select pi.permission_key, pi.parent_key from public.permission_items pi where pi.permission_key = 'agent-creator-data' and pi.is_active = true
    union all
    select parent.permission_key, parent.parent_key from public.permission_items parent join applicable_permissions child on child.parent_key = parent.permission_key where parent.is_active = true
  )
  select exists (
    select 1 from public.employees e join public.profiles p on p.id = e.profile_id
    where e.id = p_employee_id and e.deleted_at is null and e.status = 'active'
      and nullif(btrim(coalesce(e.email, '')), '') is not null and p.status = 'approved'
      and not exists (select 1 from public.employee_permission_overrides epo join applicable_permissions ap on ap.permission_key = epo.permission_key where epo.employee_id = e.id and epo.effect = 'deny')
      and exists (select 1 from applicable_permissions ap where exists (select 1 from public.employee_permission_overrides epo where epo.employee_id = e.id and epo.permission_key = ap.permission_key and epo.effect = 'grant' and epo.can_view) or exists (select 1 where not exists (select 1 from public.employee_permission_overrides scoped_epo join applicable_permissions scoped_ap on scoped_ap.permission_key = scoped_epo.permission_key where scoped_epo.employee_id = e.id and scoped_epo.effect = 'grant') and (exists (select 1 from public.job_title_permission_templates jtpt where jtpt.job_title_id = e.job_title_id and jtpt.permission_key = ap.permission_key and jtpt.can_view) or exists (select 1 from public.employee_special_permissions esp join public.special_permission_template_items spti on spti.special_permission_template_id = esp.special_permission_template_id where esp.employee_id = e.id and esp.is_enabled = true and esp.can_view and spti.permission_key = ap.permission_key and spti.can_view))))
  );
$$;

create or replace function public.get_creator_collaborator_options(p_assignment_type text, p_region_id uuid)
returns table (employee_id uuid, display_name text, region_id uuid)
language sql stable security definer set search_path = public, pg_temp
as $$
  select e.id, coalesce(nullif(btrim(e.nickname), ''), e.full_name), e.region_id
  from public.employees e
  where p_assignment_type in ('scout', 'manager')
    and (public.current_user_has_permission('scout-onboarding', 'use') or public.current_user_has_permission('management-streamer-stats', 'use'))
    and e.region_id is not null and public.current_user_can_access_region(e.region_id)
    and (p_region_id is null or e.region_id = p_region_id)
    and case when p_assignment_type = 'scout' then public.is_onboarding_scout_employee(e.id) else public.is_onboarding_manager_employee(e.id) end
  order by coalesce(nullif(btrim(e.nickname), ''), e.full_name), e.id;
$$;

create or replace function public.create_creator_entity_with_platforms(
  p_display_name text, p_region_id uuid, p_scout_employee_id uuid, p_manager_employee_id uuid, p_platforms jsonb,
  p_secondary_scout_employee_id uuid, p_secondary_manager_employee_id uuid
)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_entity_id uuid;
begin
  select public.create_creator_entity_with_platforms(p_display_name, p_region_id, p_scout_employee_id, p_manager_employee_id, p_platforms) into v_entity_id;
  if p_secondary_scout_employee_id is not null then
    if p_secondary_scout_employee_id = p_scout_employee_id then raise exception 'Secondary scout cannot be the primary scout.'; end if;
    if not exists (select 1 from public.employees e where e.id = p_secondary_scout_employee_id and e.region_id = p_region_id) or not public.is_onboarding_scout_employee(p_secondary_scout_employee_id) then
      raise exception 'Invalid secondary scout employee for selected region.';
    end if;
    insert into public.creator_collaborator_assignments (creator_entity_id, assignment_type, employee_id) values (v_entity_id, 'scout', p_secondary_scout_employee_id);
  end if;
  if p_secondary_manager_employee_id is not null then
    if p_secondary_manager_employee_id = p_manager_employee_id then raise exception 'Secondary manager cannot be the primary manager.'; end if;
    if not exists (select 1 from public.employees e where e.id = p_secondary_manager_employee_id and e.region_id = p_region_id) or not public.is_onboarding_manager_employee(p_secondary_manager_employee_id) then
      raise exception 'Invalid secondary manager employee for selected region.';
    end if;
    insert into public.creator_collaborator_assignments (creator_entity_id, assignment_type, employee_id) values (v_entity_id, 'manager', p_secondary_manager_employee_id);
  end if;
  return v_entity_id;
end;
$$;

revoke all on function public.is_onboarding_manager_employee(uuid) from public;
revoke all on function public.get_creator_collaborator_options(text, uuid) from public;
revoke all on function public.create_creator_entity_with_platforms(text, uuid, uuid, uuid, jsonb, uuid, uuid) from public;
grant execute on function public.get_creator_collaborator_options(text, uuid) to authenticated;
grant execute on function public.create_creator_entity_with_platforms(text, uuid, uuid, uuid, jsonb, uuid, uuid) to authenticated;
