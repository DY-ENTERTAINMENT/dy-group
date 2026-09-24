begin;

alter table public.creator_entities drop constraint if exists creator_entities_status_check;
alter table public.creator_entities add constraint creator_entities_status_check check (status in ('active','invalid','merged'));
alter table public.creator_entities add column if not exists merged_into_entity_id uuid references public.creator_entities(id) on delete restrict,
  add column if not exists merged_at timestamptz,
  add column if not exists merged_by uuid references public.profiles(id) on delete set null;
alter table public.creator_entities add constraint creator_entities_merged_metadata_check check ((status <> 'merged' and merged_into_entity_id is null and merged_at is null) or (status = 'merged' and merged_into_entity_id is not null and merged_at is not null));

create table public.creator_entity_association_history (
 id uuid primary key default gen_random_uuid(), source_entity_id uuid not null references public.creator_entities(id) on delete restrict,
 retained_entity_id uuid not null references public.creator_entities(id) on delete restrict,
 moved_profile_id uuid not null references public.creator_profiles(id) on delete restrict,
 source_platform public.creator_platform not null, source_manager_employee_id uuid, retained_manager_employee_id uuid,
 source_region_id uuid, retained_region_id uuid, performed_by uuid references public.profiles(id) on delete set null,
 reason text not null, created_at timestamptz not null default now(),
 check (source_entity_id <> retained_entity_id), check (length(btrim(reason)) > 0)
);
create index creator_entity_association_history_source_idx on public.creator_entity_association_history(source_entity_id, created_at desc);
alter table public.creator_entity_association_history enable row level security;
revoke all on public.creator_entity_association_history from public, anon, authenticated;
create function public.prevent_creator_entity_association_history_changes() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$ begin raise exception 'Creator entity association history is append-only.'; end; $$;
create trigger prevent_creator_entity_association_history_changes before update or delete on public.creator_entity_association_history for each row execute function public.prevent_creator_entity_association_history_changes();

create or replace function public.search_cross_platform_creator_association_candidates(p_current_profile_id uuid,p_query text)
returns table(id uuid,creator_entity_id uuid,platform public.creator_platform,creator_name text,platform_account text,platform_user_id text,platform_public_id text,manager_name text,region_name text)
language sql stable security definer set search_path=public,pg_temp as $$
 select cp.id,cp.creator_entity_id,cp.platform,cp.creator_name,cp.platform_account,cp.platform_user_id,cp.platform_public_id,coalesce(nullif(e.nickname,''),e.full_name),r.name
 from public.creator_profiles cp join public.creator_entities candidate_entity on candidate_entity.id=cp.creator_entity_id join public.creator_profiles current_profile on current_profile.id=p_current_profile_id join public.creator_entities current_entity on current_entity.id=current_profile.creator_entity_id left join public.employees e on e.id=cp.manager_employee_id left join public.regions r on r.id=cp.region_id
 where public.current_user_is_super_admin() and candidate_entity.status='active' and current_entity.status='active' and current_profile.status='active' and current_profile.membership_status='active' and cp.id<>current_profile.id and cp.creator_entity_id<>current_profile.creator_entity_id and cp.platform<>current_profile.platform and cp.status='active' and cp.membership_status='active'
 and (length(btrim(coalesce(p_query,'')))>=2) and concat_ws(' ',cp.creator_name,cp.platform_account,cp.platform_public_id,cp.platform_user_id) ilike '%'||btrim(p_query)||'%' order by cp.creator_name limit 20;
$$;

create or replace function public.preview_cross_platform_creator_association(p_retained_entity_id uuid,p_source_profile_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.creator_entities; s public.creator_entities; p public.creator_profiles; blockers text[] := '{}'; warnings text[] := '{}'; begin
 if auth.uid() is null or not public.current_user_is_super_admin() then raise exception 'Only Super Admin can preview creator association.'; end if;
 select * into r from public.creator_entities where id=p_retained_entity_id; select * into p from public.creator_profiles where id=p_source_profile_id; select * into s from public.creator_entities where id=p.creator_entity_id;
 if r.id is null or p.id is null or s.id is null then blockers:=array_append(blockers,'Creator entity or source profile not found.'); end if;
 if r.id=s.id then blockers:=array_append(blockers,'Profiles must belong to different entities.'); end if;
 if r.status<>'active' or s.status<>'active' or p.status<>'active' or p.membership_status<>'active' then blockers:=array_append(blockers,'Entities and source profile must be active.'); end if;
 if p.platform not in ('tiktok','douyin') or exists(select 1 from public.creator_profiles x where x.creator_entity_id=r.id and x.platform=p.platform and x.membership_status='active') then blockers:=array_append(blockers,'Retained entity already has this active platform.'); end if;
 if r.manager_employee_id is distinct from s.manager_employee_id then blockers:=array_append(blockers,'Primary managers differ.'); end if;
 if r.region_id is distinct from s.region_id then blockers:=array_append(blockers,'Regions differ.'); end if;
 if exists(select 1 from public.creator_profiles x where x.creator_entity_id=s.id and x.id<>p.id and x.membership_status='active') then blockers:=array_append(blockers,'Source entity has another active membership profile.'); end if;
 if exists(select 1 from public.offline_live_room_creators x where x.creator_entity_id=s.id and x.status='active' and x.ended_at is null) then blockers:=array_append(blockers,'Source creator currently has an active offline live-room assignment. Resolve the room assignment before association.'); end if;
 if exists(select 1 from public.creator_collaborator_assignments x where x.creator_entity_id=s.id and x.status='active') then blockers:=array_append(blockers,'Source entity has active collaborator assignments.'); end if;
 if exists(select 1 from public.creator_activities x where x.creator_entity_id=s.id) then warnings:=array_append(warnings,'来源主体的活动历史会保留在原主体。'); end if;
 if exists(select 1 from public.creator_milestone_notes x where x.creator_entity_id=s.id) then warnings:=array_append(warnings,'来源主体的里程碑历史会保留在原主体。'); end if;
 return jsonb_build_object('can_associate',cardinality(blockers)=0,'blockers',to_jsonb(blockers),'warnings',to_jsonb(warnings),'retained_entity',to_jsonb(r),'source_entity',to_jsonb(s),'source_profile',to_jsonb(p),'retained_profiles',coalesce((select jsonb_agg(to_jsonb(x) order by x.platform) from public.creator_profiles x where x.creator_entity_id=r.id and x.status='active' and x.membership_status='active'),'[]'::jsonb),'source_active_room_count',(select count(*) from public.offline_live_room_creators x where x.creator_entity_id=s.id and x.status='active'),'retained_active_room_count',(select count(*) from public.offline_live_room_creators x where x.creator_entity_id=r.id and x.status='active'),'source_active_collaborator_count',(select count(*) from public.creator_collaborator_assignments x where x.creator_entity_id=s.id and x.status='active'),'source_activity_count',(select count(*) from public.creator_activities x where x.creator_entity_id=s.id),'source_milestone_count',(select count(*) from public.creator_milestone_notes x where x.creator_entity_id=s.id),'source_extra_active_profile_count',(select count(*) from public.creator_profiles x where x.creator_entity_id=s.id and x.id<>p.id and x.membership_status='active'),'retained_manager_name',(select coalesce(nullif(e.nickname,''),e.full_name) from public.employees e where e.id=r.manager_employee_id),'source_manager_name',(select coalesce(nullif(e.nickname,''),e.full_name) from public.employees e where e.id=s.manager_employee_id),'retained_region_name',(select rg.name from public.regions rg where rg.id=r.region_id),'source_region_name',(select rg.name from public.regions rg where rg.id=s.region_id)); end; $$;

create or replace function public.associate_existing_cross_platform_creator_profiles(p_retained_entity_id uuid,p_source_profile_id uuid,p_reason text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.creator_entities; s public.creator_entities; p public.creator_profiles; h uuid; preview jsonb; begin
 if auth.uid() is null or not public.current_user_is_super_admin() then raise exception 'Only Super Admin can associate creator profiles.'; end if;
 if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'Association reason is required.'; end if;
 -- deterministic entity locks; profile is then locked and all conditions revalidated.
 perform 1 from public.creator_entities where id in (p_retained_entity_id,(select creator_entity_id from public.creator_profiles where id=p_source_profile_id)) order by id for update;
 select * into r from public.creator_entities where id=p_retained_entity_id; select * into p from public.creator_profiles where id=p_source_profile_id for update; select * into s from public.creator_entities where id=p.creator_entity_id;
 select public.preview_cross_platform_creator_association(r.id,p.id) into preview;
 if not coalesce((preview->>'can_associate')::boolean,false) then raise exception 'Association blocked: %', preview->'blockers'; end if;
 update public.creator_profiles set creator_entity_id=r.id where id=p.id;
 insert into public.creator_entity_association_history(source_entity_id,retained_entity_id,moved_profile_id,source_platform,source_manager_employee_id,retained_manager_employee_id,source_region_id,retained_region_id,performed_by,reason) values(s.id,r.id,p.id,p.platform,s.manager_employee_id,r.manager_employee_id,s.region_id,r.region_id,auth.uid(),btrim(p_reason)) returning id into h;
 update public.creator_entities set status='merged',merged_into_entity_id=r.id,merged_at=now(),merged_by=auth.uid() where id=s.id;
 return h; end; $$;
revoke all on function public.preview_cross_platform_creator_association(uuid,uuid),public.associate_existing_cross_platform_creator_profiles(uuid,uuid,text) from public,anon;
revoke all on function public.search_cross_platform_creator_association_candidates(uuid,text) from public,anon;
grant execute on function public.preview_cross_platform_creator_association(uuid,uuid),public.associate_existing_cross_platform_creator_profiles(uuid,uuid,text),public.search_cross_platform_creator_association_candidates(uuid,text) to authenticated;
commit;
