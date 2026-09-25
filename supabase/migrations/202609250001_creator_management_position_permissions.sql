begin;

insert into public.permission_items (permission_key, parent_key, name, sort_order, is_active, is_reserved)
values
  ('agent-creator-management-settings', 'agent', '编辑主播管理设置', 25, true, false),
  ('agent-creator-revenue-settings', 'agent', '修改主播流水设置', 26, true, false),
  ('agent-creator-platform-account-link', 'agent', '关联现有平台账号', 27, true, false)
on conflict (permission_key) do update set parent_key = excluded.parent_key, name = excluded.name, sort_order = excluded.sort_order, is_active = true, is_reserved = false;

-- Sensitive children intentionally do not inherit `agent`. Super Admin keeps the
-- existing bypass implemented by current_user_has_permission.
create or replace function public.current_user_has_explicit_permission(p_permission_key text, p_action text)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare viewer_profile public.profiles; viewer_employee public.employees;
begin
  if p_action not in ('view', 'use') then raise exception 'Unsupported permission action: %', p_action using errcode = '22023'; end if;
  select * into viewer_profile from public.profiles where id = auth.uid() limit 1;
  if viewer_profile.id is null then return false; end if;
  if viewer_profile.role = 'super_admin' then return true; end if;
  if viewer_profile.status <> 'approved' then return false; end if;
  select * into viewer_employee from public.employees where profile_id = viewer_profile.id and deleted_at is null limit 1;
  if viewer_employee.id is null then return false; end if;
  return exists (
    select 1 from public.job_title_permission_templates p where p.job_title_id = viewer_employee.job_title_id and p.permission_key = p_permission_key and case when p_action='view' then p.can_view else p.can_view and p.can_use end
    union all
    select 1 from public.employee_special_permissions esp join public.special_permission_template_items item on item.special_permission_template_id=esp.special_permission_template_id where esp.employee_id=viewer_employee.id and esp.is_enabled and item.permission_key=p_permission_key and case when p_action='view' then esp.can_view and item.can_view else esp.can_view and esp.can_use and item.can_view and item.can_use end
    union all
    select 1 from public.employee_permission_overrides p where p.employee_id=viewer_employee.id and p.permission_key=p_permission_key and case when p_action='view' then p.can_view else p.can_view and p.can_use end
  );
end; $$;

create or replace function public.current_user_can_manage_creator_entity(p_creator_entity_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.current_user_is_super_admin() or exists (
    select 1 from public.creator_entities e
    where e.id = p_creator_entity_id and e.status = 'active' and public.current_user_can_access_region(e.region_id)
      and (
        public.current_user_has_permission('management-streamer-stats', 'view')
        or (public.current_user_has_permission('agent-creator-data', 'view') and (
          e.manager_employee_id = public.current_user_employee_id()
          or exists (select 1 from public.creator_collaborator_assignments c where c.creator_entity_id=e.id and c.assignment_type='manager' and c.assignment_role='secondary' and c.employee_id=public.current_user_employee_id() and c.status='active')
        ))
      )
  );
$$;

create or replace function public.save_creator_entity_management_controls(p_creator_entity_id uuid, p_is_priority boolean, p_operation_status text, p_operation_status_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_reason text := nullif(btrim(coalesce(p_operation_status_reason,'')), '');
begin
  if auth.uid() is null or not public.current_user_has_explicit_permission('agent-creator-management-settings','use') then raise exception 'Permission denied.'; end if;
  if not public.current_user_can_manage_creator_entity(p_creator_entity_id) then raise exception 'Creator access denied.'; end if;
  if p_operation_status not in ('normal','paused','long_term_stopped','resigned','terminated','other') then raise exception 'Invalid operation status.'; end if;
  if p_operation_status='other' and v_reason is null then raise exception 'Reason is required for other operation status.'; end if;
  update public.creator_entities set is_priority=coalesce(p_is_priority,false), operation_status=p_operation_status, operation_status_reason=v_reason, operation_status_updated_at=now(), updated_by=auth.uid() where id=p_creator_entity_id;
end; $$;

create or replace function public.save_creator_entity_revenue_settings(p_creator_entity_id uuid, p_profile_settings jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.current_user_has_explicit_permission('agent-creator-revenue-settings','use') then raise exception 'Permission denied.'; end if;
  if not public.current_user_can_manage_creator_entity(p_creator_entity_id) then raise exception 'Creator access denied.'; end if;
  if p_profile_settings is null or jsonb_typeof(p_profile_settings)<>'array' then raise exception 'Profile settings must be an array.'; end if;
  if exists (select 1 from jsonb_to_recordset(p_profile_settings) s(id uuid,revenue_cycle text,revenue_input_mode text) where s.revenue_cycle not in ('weekly','monthly','none') or s.revenue_input_mode not in ('direct','cumulative')) then raise exception 'Invalid revenue settings.'; end if;
  if (select count(*) from jsonb_to_recordset(p_profile_settings) s(id uuid,revenue_cycle text,revenue_input_mode text)) <> (select count(*) from public.creator_profiles where creator_entity_id=p_creator_entity_id and status='active' and membership_status='active') then raise exception 'All active platform profiles must be included.'; end if;
  update public.creator_profiles p set revenue_cycle=s.revenue_cycle, revenue_input_mode=s.revenue_input_mode from jsonb_to_recordset(p_profile_settings) s(id uuid,revenue_cycle text,revenue_input_mode text) where p.id=s.id and p.creator_entity_id=p_creator_entity_id and p.status='active' and p.membership_status='active';
end; $$;

create or replace function public.search_cross_platform_creator_association_candidates(p_current_profile_id uuid,p_query text)
returns table(id uuid,creator_entity_id uuid,platform public.creator_platform,creator_name text,platform_account text,platform_user_id text,platform_public_id text,manager_name text,region_name text)
language sql stable security definer set search_path=public,pg_temp as $$
 select cp.id,cp.creator_entity_id,cp.platform,cp.creator_name,cp.platform_account,cp.platform_user_id,cp.platform_public_id,coalesce(nullif(e.nickname,''),e.full_name),r.name
 from public.creator_profiles cp join public.creator_profiles current_profile on current_profile.id=p_current_profile_id join public.creator_entities candidate_entity on candidate_entity.id=cp.creator_entity_id left join public.employees e on e.id=cp.manager_employee_id left join public.regions r on r.id=cp.region_id
 where public.current_user_has_explicit_permission('agent-creator-platform-account-link','use') and public.current_user_can_manage_creator_entity(current_profile.creator_entity_id) and public.current_user_can_manage_creator_entity(cp.creator_entity_id)
 and candidate_entity.status='active' and current_profile.status='active' and current_profile.membership_status='active' and cp.id<>current_profile.id and cp.creator_entity_id<>current_profile.creator_entity_id and cp.platform<>current_profile.platform and cp.status='active' and cp.membership_status='active' and length(btrim(coalesce(p_query,'')))>=2 and concat_ws(' ',cp.creator_name,cp.platform_account,cp.platform_public_id,cp.platform_user_id) ilike '%'||btrim(p_query)||'%' order by cp.creator_name limit 20;
$$;

create or replace function public.preview_cross_platform_creator_association(p_retained_entity_id uuid,p_source_profile_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.creator_entities; s public.creator_entities; p public.creator_profiles; blockers text[] := '{}'; warnings text[] := '{}'; begin
 if auth.uid() is null or not public.current_user_has_explicit_permission('agent-creator-platform-account-link','use') then raise exception 'Permission denied.'; end if;
 select * into r from public.creator_entities where id=p_retained_entity_id; select * into p from public.creator_profiles where id=p_source_profile_id; select * into s from public.creator_entities where id=p.creator_entity_id;
 if r.id is null or p.id is null or s.id is null then raise exception 'Creator entity or source profile not found.'; end if;
 if not public.current_user_can_manage_creator_entity(r.id) or not public.current_user_can_manage_creator_entity(s.id) then raise exception 'Creator access denied.'; end if;
 if r.id=s.id then blockers:=array_append(blockers,'Profiles must belong to different entities.'); end if; if r.status<>'active' or s.status<>'active' or p.status<>'active' or p.membership_status<>'active' then blockers:=array_append(blockers,'Entities and source profile must be active.'); end if; if p.platform not in ('tiktok','douyin') or exists(select 1 from public.creator_profiles x where x.creator_entity_id=r.id and x.platform=p.platform and x.membership_status='active') then blockers:=array_append(blockers,'Retained entity already has this active platform.'); end if; if r.manager_employee_id is distinct from s.manager_employee_id then blockers:=array_append(blockers,'Primary managers differ.'); end if; if r.region_id is distinct from s.region_id then blockers:=array_append(blockers,'Regions differ.'); end if; if exists(select 1 from public.creator_profiles x where x.creator_entity_id=s.id and x.id<>p.id and x.membership_status='active') then blockers:=array_append(blockers,'Source entity has another active membership profile.'); end if; if exists(select 1 from public.offline_live_room_creators x where x.creator_entity_id=s.id and x.status='active' and x.ended_at is null) then blockers:=array_append(blockers,'Source creator currently has an active offline live-room assignment. Resolve the room assignment before association.'); end if; if exists(select 1 from public.creator_collaborator_assignments x where x.creator_entity_id=s.id and x.status='active') then blockers:=array_append(blockers,'Source entity has active collaborator assignments.'); end if;
 return jsonb_build_object('can_associate',cardinality(blockers)=0,'blockers',to_jsonb(blockers),'warnings',to_jsonb(warnings),'retained_entity',to_jsonb(r),'source_entity',to_jsonb(s),'source_profile',to_jsonb(p),'retained_profiles',coalesce((select jsonb_agg(to_jsonb(x) order by x.platform) from public.creator_profiles x where x.creator_entity_id=r.id and x.status='active' and x.membership_status='active'),'[]'::jsonb),'source_active_room_count',(select count(*) from public.offline_live_room_creators x where x.creator_entity_id=s.id and x.status='active'),'retained_active_room_count',(select count(*) from public.offline_live_room_creators x where x.creator_entity_id=r.id and x.status='active'),'source_active_collaborator_count',(select count(*) from public.creator_collaborator_assignments x where x.creator_entity_id=s.id and x.status='active'),'source_activity_count',(select count(*) from public.creator_activities x where x.creator_entity_id=s.id),'source_milestone_count',(select count(*) from public.creator_milestone_notes x where x.creator_entity_id=s.id),'source_extra_active_profile_count',(select count(*) from public.creator_profiles x where x.creator_entity_id=s.id and x.id<>p.id and x.membership_status='active'),'retained_manager_name',(select coalesce(nullif(e.nickname,''),e.full_name) from public.employees e where e.id=r.manager_employee_id),'source_manager_name',(select coalesce(nullif(e.nickname,''),e.full_name) from public.employees e where e.id=s.manager_employee_id),'retained_region_name',(select rg.name from public.regions rg where rg.id=r.region_id),'source_region_name',(select rg.name from public.regions rg where rg.id=s.region_id)); end; $$;

create or replace function public.associate_existing_cross_platform_creator_profiles(p_retained_entity_id uuid,p_source_profile_id uuid,p_reason text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.creator_entities; s public.creator_entities; p public.creator_profiles; h uuid; preview jsonb; begin
 if auth.uid() is null or not public.current_user_has_explicit_permission('agent-creator-platform-account-link','use') then raise exception 'Permission denied.'; end if; if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'Association reason is required.'; end if;
 perform 1 from public.creator_entities where id in (p_retained_entity_id,(select creator_entity_id from public.creator_profiles where id=p_source_profile_id)) order by id for update; select * into r from public.creator_entities where id=p_retained_entity_id; select * into p from public.creator_profiles where id=p_source_profile_id for update; select * into s from public.creator_entities where id=p.creator_entity_id;
 if r.id is null or p.id is null or s.id is null or not public.current_user_can_manage_creator_entity(r.id) or not public.current_user_can_manage_creator_entity(s.id) then raise exception 'Creator access denied.'; end if;
 select public.preview_cross_platform_creator_association(r.id,p.id) into preview; if not coalesce((preview->>'can_associate')::boolean,false) then raise exception 'Association blocked: %', preview->'blockers'; end if;
 update public.creator_profiles set creator_entity_id=r.id where id=p.id; insert into public.creator_entity_association_history(source_entity_id,retained_entity_id,moved_profile_id,source_platform,source_manager_employee_id,retained_manager_employee_id,source_region_id,retained_region_id,performed_by,reason) values(s.id,r.id,p.id,p.platform,s.manager_employee_id,r.manager_employee_id,s.region_id,r.region_id,auth.uid(),btrim(p_reason)) returning id into h; update public.creator_entities set status='merged',merged_into_entity_id=r.id,merged_at=now(),merged_by=auth.uid() where id=s.id; return h;
end; $$;

revoke all on function public.current_user_has_explicit_permission(text,text), public.current_user_can_manage_creator_entity(uuid) from public, anon;
revoke all on function public.save_creator_entity_management_controls(uuid,boolean,text,text), public.save_creator_entity_revenue_settings(uuid,jsonb) from public, anon;
revoke all on function public.search_cross_platform_creator_association_candidates(uuid,text), public.preview_cross_platform_creator_association(uuid,uuid), public.associate_existing_cross_platform_creator_profiles(uuid,uuid,text) from public, anon;
grant execute on function public.current_user_has_explicit_permission(text,text), public.current_user_can_manage_creator_entity(uuid), public.save_creator_entity_management_controls(uuid,boolean,text,text), public.save_creator_entity_revenue_settings(uuid,jsonb), public.search_cross_platform_creator_association_candidates(uuid,text), public.preview_cross_platform_creator_association(uuid,uuid), public.associate_existing_cross_platform_creator_profiles(uuid,uuid,text) to authenticated;
commit;
