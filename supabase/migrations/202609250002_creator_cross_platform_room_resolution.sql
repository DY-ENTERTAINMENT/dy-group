begin;

alter table public.creator_entity_association_history
  add column if not exists source_room_id uuid references public.offline_live_rooms(id) on delete restrict,
  add column if not exists retained_room_id uuid references public.offline_live_rooms(id) on delete restrict,
  add column if not exists final_room_id uuid references public.offline_live_rooms(id) on delete restrict,
  add column if not exists room_resolution text;

alter table public.creator_entity_association_history
  drop constraint if exists creator_entity_association_history_room_resolution_check;
alter table public.creator_entity_association_history
  add constraint creator_entity_association_history_room_resolution_check
  check (room_resolution is null or room_resolution in ('auto', 'keep_source', 'keep_retained'));

create or replace function public.preview_cross_platform_creator_association(p_retained_entity_id uuid,p_source_profile_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 r public.creator_entities; s public.creator_entities; p public.creator_profiles;
 source_assignment public.offline_live_room_creators; retained_assignment public.offline_live_room_creators;
 source_room public.offline_live_rooms; retained_room public.offline_live_rooms;
 blockers text[] := '{}'; warnings text[] := '{}'; room_state text := 'none'; recommended_resolution text := 'auto';
begin
 if auth.uid() is null or not public.current_user_has_explicit_permission('agent-creator-platform-account-link','use') then raise exception 'Permission denied.'; end if;
 select * into r from public.creator_entities where id=p_retained_entity_id;
 select * into p from public.creator_profiles where id=p_source_profile_id;
 select * into s from public.creator_entities where id=p.creator_entity_id;
 if r.id is null or p.id is null or s.id is null then blockers:=array_append(blockers,'Creator entity or source profile not found.'); end if;
 if r.id is not null and s.id is not null and (not public.current_user_can_manage_creator_entity(r.id) or not public.current_user_can_manage_creator_entity(s.id)) then raise exception 'Creator access denied.'; end if;
 if r.id=s.id then blockers:=array_append(blockers,'Profiles must belong to different entities.'); end if;
 if r.status<>'active' or s.status<>'active' or p.status<>'active' or p.membership_status<>'active' then blockers:=array_append(blockers,'Entities and source profile must be active.'); end if;
 if p.platform not in ('tiktok','douyin') or exists(select 1 from public.creator_profiles x where x.creator_entity_id=r.id and x.platform=p.platform and x.membership_status='active') then blockers:=array_append(blockers,'Retained entity already has this active platform.'); end if;
 if r.manager_employee_id is distinct from s.manager_employee_id then blockers:=array_append(blockers,'Primary managers differ.'); end if;
 if r.region_id is distinct from s.region_id then blockers:=array_append(blockers,'Regions differ.'); end if;
 if exists(select 1 from public.creator_profiles x where x.creator_entity_id=s.id and x.id<>p.id and x.membership_status='active') then blockers:=array_append(blockers,'Source entity has another active membership profile.'); end if;
 if exists(select 1 from public.creator_collaborator_assignments x where x.creator_entity_id=s.id and x.status='active') then blockers:=array_append(blockers,'Source entity has active collaborator assignments.'); end if;
 select * into source_assignment from public.offline_live_room_creators x where x.creator_entity_id=s.id and x.status='active' and x.ended_at is null order by x.assigned_at desc limit 1;
 select * into retained_assignment from public.offline_live_room_creators x where x.creator_entity_id=r.id and x.status='active' and x.ended_at is null order by x.assigned_at desc limit 1;
 if source_assignment.id is not null then select * into source_room from public.offline_live_rooms where id=source_assignment.room_id; end if;
 if retained_assignment.id is not null then select * into retained_room from public.offline_live_rooms where id=retained_assignment.room_id; end if;
 if source_assignment.id is not null and retained_assignment.id is null then room_state:='source_only';
 elsif source_assignment.id is null and retained_assignment.id is not null then room_state:='retained_only';
 elsif source_assignment.id is not null and retained_assignment.id is not null and source_assignment.room_id=retained_assignment.room_id then room_state:='same_room';
 elsif source_assignment.id is not null and retained_assignment.id is not null then room_state:='different_rooms'; recommended_resolution:='auto'; end if;
 if exists(select 1 from public.creator_activities x where x.creator_entity_id=s.id) then warnings:=array_append(warnings,'来源主体的活动历史会保留在原主体。'); end if;
 if exists(select 1 from public.creator_milestone_notes x where x.creator_entity_id=s.id) then warnings:=array_append(warnings,'来源主体的里程碑历史会保留在原主体。'); end if;
 return jsonb_build_object('can_associate',cardinality(blockers)=0,'blockers',to_jsonb(blockers),'warnings',to_jsonb(warnings),'retained_entity',to_jsonb(r),'source_entity',to_jsonb(s),'source_profile',to_jsonb(p),'retained_profiles',coalesce((select jsonb_agg(to_jsonb(x) order by x.platform) from public.creator_profiles x where x.creator_entity_id=r.id and x.status='active' and x.membership_status='active'),'[]'::jsonb),'source_active_room_count',(select count(*) from public.offline_live_room_creators x where x.creator_entity_id=s.id and x.status='active' and x.ended_at is null),'retained_active_room_count',(select count(*) from public.offline_live_room_creators x where x.creator_entity_id=r.id and x.status='active' and x.ended_at is null),'source_active_collaborator_count',(select count(*) from public.creator_collaborator_assignments x where x.creator_entity_id=s.id and x.status='active'),'source_activity_count',(select count(*) from public.creator_activities x where x.creator_entity_id=s.id),'source_milestone_count',(select count(*) from public.creator_milestone_notes x where x.creator_entity_id=s.id),'source_extra_active_profile_count',(select count(*) from public.creator_profiles x where x.creator_entity_id=s.id and x.id<>p.id and x.membership_status='active'),'retained_manager_name',(select coalesce(nullif(e.nickname,''),e.full_name) from public.employees e where e.id=r.manager_employee_id),'source_manager_name',(select coalesce(nullif(e.nickname,''),e.full_name) from public.employees e where e.id=s.manager_employee_id),'retained_region_name',(select rg.name from public.regions rg where rg.id=r.region_id),'source_region_name',(select rg.name from public.regions rg where rg.id=s.region_id),'room_state',room_state,'source_room',case when source_room.id is null then null else jsonb_build_object('id',source_room.id,'name',source_room.name,'room_number',source_room.room_number) end,'retained_room',case when retained_room.id is null then null else jsonb_build_object('id',retained_room.id,'name',retained_room.name,'room_number',retained_room.room_number) end,'room_resolution_required',room_state='different_rooms','recommended_room_resolution',recommended_resolution);
end; $$;

create function public.associate_existing_cross_platform_creator_profiles(p_retained_entity_id uuid,p_source_profile_id uuid,p_reason text,p_room_resolution text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.creator_entities; s public.creator_entities; p public.creator_profiles; h uuid; preview jsonb; source_assignment public.offline_live_room_creators; retained_assignment public.offline_live_room_creators; v_now timestamptz:=now(); final_room_id uuid; source_room_id uuid; retained_room_id uuid;
begin
 if auth.uid() is null or not public.current_user_has_explicit_permission('agent-creator-platform-account-link','use') then raise exception 'Permission denied.'; end if;
 if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'Association reason is required.'; end if;
 if p_room_resolution not in ('auto','keep_source','keep_retained') then raise exception 'Invalid room resolution.'; end if;
 perform 1 from public.creator_entities where id in (p_retained_entity_id,(select creator_entity_id from public.creator_profiles where id=p_source_profile_id)) order by id for update;
 select * into r from public.creator_entities where id=p_retained_entity_id; select * into p from public.creator_profiles where id=p_source_profile_id for update; select * into s from public.creator_entities where id=p.creator_entity_id;
 if r.id is null or p.id is null or s.id is null or not public.current_user_can_manage_creator_entity(r.id) or not public.current_user_can_manage_creator_entity(s.id) then raise exception 'Creator access denied.'; end if;
 select * into source_assignment from public.offline_live_room_creators where creator_entity_id=s.id and status='active' and ended_at is null order by assigned_at desc limit 1 for update;
 select * into retained_assignment from public.offline_live_room_creators where creator_entity_id=r.id and status='active' and ended_at is null order by assigned_at desc limit 1 for update;
 source_room_id:=source_assignment.room_id; retained_room_id:=retained_assignment.room_id;
 select public.preview_cross_platform_creator_association(r.id,p.id) into preview;
 if not coalesce((preview->>'can_associate')::boolean,false) then raise exception 'Association blocked: %', preview->'blockers'; end if;
 if source_assignment.id is not null and retained_assignment.id is not null and source_room_id<>retained_room_id and p_room_resolution='auto' then raise exception 'Room resolution is required.'; end if;
 if source_assignment.id is null and retained_assignment.id is null then final_room_id:=null;
 elsif source_assignment.id is not null and retained_assignment.id is null then final_room_id:=source_room_id;
 elsif source_assignment.id is null and retained_assignment.id is not null then final_room_id:=retained_room_id;
 elsif source_room_id=retained_room_id then final_room_id:=retained_room_id;
 elsif p_room_resolution='keep_source' then final_room_id:=source_room_id;
 else final_room_id:=retained_room_id; end if;
 if source_assignment.id is not null then update public.offline_live_room_creators set status='inactive',ended_at=v_now where id=source_assignment.id; end if;
 if retained_assignment.id is not null and final_room_id is distinct from retained_room_id then update public.offline_live_room_creators set status='inactive',ended_at=v_now where id=retained_assignment.id; end if;
 if final_room_id is not null and (retained_assignment.id is null or final_room_id is distinct from retained_room_id) then insert into public.offline_live_room_creators(room_id,creator_entity_id,status,assigned_at) values(final_room_id,r.id,'active',v_now); end if;
 update public.creator_profiles set creator_entity_id=r.id where id=p.id;
 insert into public.creator_entity_association_history(source_entity_id,retained_entity_id,moved_profile_id,source_platform,source_manager_employee_id,retained_manager_employee_id,source_region_id,retained_region_id,performed_by,reason,source_room_id,retained_room_id,final_room_id,room_resolution) values(s.id,r.id,p.id,p.platform,s.manager_employee_id,r.manager_employee_id,s.region_id,r.region_id,auth.uid(),btrim(p_reason),source_room_id,retained_room_id,final_room_id,p_room_resolution) returning id into h;
 update public.creator_entities set status='merged',merged_into_entity_id=r.id,merged_at=v_now,merged_by=auth.uid() where id=s.id;
 return h;
end; $$;

revoke all on function public.associate_existing_cross_platform_creator_profiles(uuid,uuid,text,text) from public, anon;
grant execute on function public.associate_existing_cross_platform_creator_profiles(uuid,uuid,text,text) to authenticated;
commit;
