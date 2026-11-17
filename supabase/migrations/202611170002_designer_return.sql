-- REVIEW REQUIRED. Do not execute without explicit Production approval.
begin;
alter table public.designer_request_stages add column if not exists claim_pending_start boolean not null default false;
create table public.designer_request_returns (
 id uuid primary key default gen_random_uuid(), request_id uuid not null references public.designer_requests(id),
 returned_by uuid not null references public.profiles(id), returned_at timestamptz not null default now(),
 reason text not null check (length(btrim(reason)) between 1 and 2000), stage_snapshot jsonb not null, resubmitted_at timestamptz,
 resubmitted_by uuid references public.profiles(id)
);
create unique index designer_request_one_active_return on public.designer_request_returns(request_id) where resubmitted_at is null;
alter table public.designer_request_returns enable row level security;
revoke all on public.designer_request_returns from public,anon,authenticated;
grant select on public.designer_request_returns to authenticated;
create policy designer_request_return_read on public.designer_request_returns for select to authenticated using (public.can_access_designer_request(request_id) or public.current_user_is_super_admin());
revoke execute on function public.request_designer_deletion(uuid,text), public.review_designer_deletion(uuid,boolean) from public,anon,authenticated;

-- This helper is used while the parent row is locked. Conservative even for
-- drafts and expired sessions: no workflow evidence is discarded or hidden.
create function public.designer_request_return_safe(p_request_id uuid) returns boolean language sql security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.designer_requests r where r.id=p_request_id and r.deleted_at is null
  and r.status='unclaimed' and r.designer_profile_id is null and r.designer_employee_id is null
  and r.accepted_at is null and r.completed_at is null and coalesce(cardinality(r.design_urls),0)=0
  and nullif(btrim(coalesce(r.revision_note,'')),'') is null)
 and not exists(select 1 from public.designer_deletion_approvals a where a.request_id=p_request_id and a.status='pending')
 and not exists(select 1 from public.designer_reference_operations o where o.request_id=p_request_id and o.completed_at is null)
 and not exists(select 1 from public.designer_request_stages s where s.request_id=p_request_id and
   (s.submitted_at is not null or s.confirmed_at is not null or s.confirmed_by_profile_id is not null or s.confirmed_by_employee_id is not null
    or s.feedback_count<>0 or nullif(btrim(coalesce(s.feedback,'')),'') is not null
    or (s.assignee_profile_id is null and (s.assignee_employee_id is not null or s.accepted_at is not null or s.status not in ('unclaimed','scheduled')))
    or (s.assignee_profile_id is not null and (not s.claim_pending_start or s.status<>'scheduled' or s.accepted_at is null))))
 and not exists(select 1 from public.designer_stage_deliverables d where d.request_id=p_request_id)
 and not exists(select 1 from public.designer_stage_deliverable_submissions d where d.request_id=p_request_id)
 and not exists(select 1 from public.designer_stage_deliverable_upload_sessions d where d.request_id=p_request_id)
 and not exists(select 1 from public.designer_review_stage_state d where d.request_id=p_request_id and (d.draft_revision<>0 or d.pending_submission_id is not null or d.final_submission_id is not null))
 and not exists(select 1 from public.designer_review_events e join public.designer_request_stages s on s.id=e.stage_id where s.request_id=p_request_id)
 and not exists(select 1 from public.designer_review_removed_inventory d where d.request_id=p_request_id)
 and not exists(select 1 from public.designer_review_current_assets d join public.designer_request_stages s on s.id=d.stage_id where s.request_id=p_request_id)
 and not exists(select 1 from public.designer_review_submission_assets d join public.designer_request_stages s on s.id=d.stage_id where s.request_id=p_request_id)
 and not exists(select 1 from public.designer_review_upload_bindings d join public.designer_request_stages s on s.id=d.stage_id where s.request_id=p_request_id)
 and not exists(select 1 from public.designer_review_activation_events d where d.request_id=p_request_id)
 and not exists(select 1 from public.designer_legacy_return_feedback e join public.designer_request_stages s on s.id=e.stage_id where s.request_id=p_request_id);
$$;
revoke all on function public.designer_request_return_safe(uuid) from public,anon,authenticated;

create function public.designer_request_is_returned(p_request_id uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$ select exists(select 1 from public.designer_request_returns x where x.request_id=p_request_id and x.resubmitted_at is null) $$;
revoke all on function public.designer_request_is_returned(uuid) from public,anon;
grant execute on function public.designer_request_is_returned(uuid) to authenticated;

-- Rebind the known request/stage serialization guards explicitly. This keeps
-- their Production definitions and does not depend on pre-existing bindings.
do $$
declare t text;
begin
 foreach t in array array['designer_request_stages','designer_request_items',
   'designer_stage_deliverables','designer_stage_deliverable_submissions',
   'designer_stage_deliverable_upload_sessions','designer_review_stage_state',
   'designer_review_activation_events',
   'designer_request_reference_attachments','designer_reference_operations'] loop
   execute format('drop trigger if exists designer_deletion_child_guard on public.%I',t);
   execute format('create trigger designer_deletion_child_guard before insert or update or delete on public.%I for each row execute function public.guard_designer_deletion_child()',t);
 end loop;
 foreach t in array array['designer_review_current_assets','designer_review_submission_assets',
   'designer_review_upload_bindings','designer_review_events','designer_legacy_return_feedback'] loop
   execute format('drop trigger if exists designer_deletion_stage_child_guard on public.%I',t);
   execute format('create trigger designer_deletion_stage_child_guard before insert or update or delete on public.%I for each row execute function public.guard_designer_deletion_stage_child()',t);
 end loop;
end $$;

-- Every result mutation takes the same request lock as return, resubmission and
-- deletion. Recheck the stage after taking it, including on UPDATE and DELETE.
create function public.guard_designer_return_result() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare sid uuid; rid uuid; r public.designer_requests; s public.designer_request_stages;
begin
 if tg_op='DELETE' then sid:=old.stage_id; else sid:=new.stage_id; end if;
 if tg_op='UPDATE' and new.stage_id is distinct from old.stage_id then raise exception 'Cannot move result between stages'; end if;
 select request_id into rid from public.designer_request_stages where id=sid;
 select * into r from public.designer_requests where id=rid for update;
 select * into s from public.designer_request_stages where id=sid;
 if r.id is null or s.id is null or s.request_id is distinct from r.id or r.deleted_at is not null
    or s.claim_pending_start or public.designer_request_is_returned(r.id)
    or exists(select 1 from public.designer_deletion_approvals a where a.request_id=r.id and a.status='pending') then
   raise exception '申请已退回、待开始、已删除或存在待处理旧审批，成果操作不可用';
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
revoke all on function public.guard_designer_return_result() from public,anon,authenticated;
do $$
declare t text;
begin
 foreach t in array array['designer_stage_deliverables','designer_stage_deliverable_submissions',
   'designer_stage_deliverable_upload_sessions','designer_review_stage_state',
   'designer_review_current_assets','designer_review_submission_assets','designer_review_upload_bindings',
   'designer_review_events','designer_review_activation_events',
   'designer_legacy_return_feedback'] loop
   execute format('create trigger designer_return_result_guard before insert or update or delete on public.%I for each row execute function public.guard_designer_return_result()',t);
 end loop;
end $$;

create or replace function public.can_access_designer_request(p_request_id uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.designer_requests r where r.id=p_request_id and r.deleted_at is null and
 (r.agent_profile_id=auth.uid() or exists(select 1 from public.designer_request_stages s where s.request_id=r.id and s.assignee_profile_id=auth.uid()) or
 (not exists(select 1 from public.designer_request_returns x where x.request_id=r.id and x.resubmitted_at is null) and r.status='unclaimed' and public.current_user_has_permission('designer-intake','view') and (r.work_mode is null or (r.region_id is not null and public.current_user_can_access_region(r.region_id))))));
$$;

-- Restrictive Storage policies complement the existing permissive upload
-- policies. Lock the request before re-reading the stage so a concurrent
-- return or soft-delete serializes with the object write.
create function public.designer_return_storage_write_allowed(p_bucket text,p_path text)
returns boolean language plpgsql volatile security definer set search_path=public,storage,pg_temp as $$
declare rid uuid; r public.designer_requests; s public.designer_request_stages;
begin
 if p_bucket is distinct from 'designer-stage-deliverables' then return true; end if;
 if auth.uid() is null or p_path is null then return false; end if;
 select st.request_id into rid from public.designer_request_stages st
   where st.id::text=(storage.foldername(p_path))[2];
 if rid is null then return false; end if;
 select * into r from public.designer_requests where id=rid for update;
 select * into s from public.designer_request_stages
   where request_id=rid and id::text=(storage.foldername(p_path))[2];
 return r.id is not null and r.deleted_at is null and s.id is not null
   and not s.claim_pending_start and not public.designer_request_is_returned(r.id)
   and not exists(select 1 from public.designer_deletion_approvals a where a.request_id=r.id and a.status='pending');
end $$;
revoke all on function public.designer_return_storage_write_allowed(text,text) from public,anon;
grant execute on function public.designer_return_storage_write_allowed(text,text) to authenticated;
create policy designer_return_storage_insert on storage.objects as restrictive for insert to authenticated
 with check (public.designer_return_storage_write_allowed(bucket_id,name));
create policy designer_return_storage_update on storage.objects as restrictive for update to authenticated
 using (public.designer_return_storage_write_allowed(bucket_id,name))
 with check (public.designer_return_storage_write_allowed(bucket_id,name));
-- Narrow the existing request SELECT policy as well as the helper used by stages.
drop policy if exists "Design requests are visible by scoped workflow" on public.designer_requests;
create policy "Design requests are visible by scoped workflow" on public.designer_requests for select to authenticated using (
 deleted_at is null and (agent_profile_id=auth.uid() or designer_profile_id=auth.uid() or
 (status='unclaimed' and not public.designer_request_is_returned(designer_requests.id) and public.current_user_has_permission('designer-intake','view') and (work_mode is null or (region_id is not null and public.current_user_can_access_region(region_id))))));

create or replace function public.claim_designer_request_stage(p_stage_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.designer_request_stages; r public.designer_requests; eid uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select * into s from public.designer_request_stages where id=p_stage_id;
 select * into r from public.designer_requests where id=s.request_id for update;
 select * into s from public.designer_request_stages where id=p_stage_id for update;
 if exists(select 1 from public.designer_deletion_approvals where request_id=r.id and status='pending') then raise exception '存在待处理的旧删除审批，申请暂时锁定'; end if;
 if r.id is null or r.deleted_at is not null or r.status in ('completed','cancelled') or s.status<>'unclaimed' or exists(select 1 from public.designer_request_returns x where x.request_id=r.id and x.resubmitted_at is null) or not public.current_user_has_permission('designer-intake','use') or not public.can_access_designer_request(s.request_id) then raise exception 'Stage unavailable'; end if;
 select id into eid from public.employees where profile_id=auth.uid() and deleted_at is null limit 1;
 if eid is null then raise exception 'Active employee required'; end if;
 update public.designer_request_stages set status=(case when s.stage_type='setup' then 'scheduled' else 'scheduled' end)::public.designer_stage_status,claim_pending_start=(s.stage_type in ('design','production')),assignee_profile_id=auth.uid(),assignee_employee_id=eid,accepted_at=now() where id=s.id;
end $$;
-- Prevent legacy direct updates and the older single-item RPC from changing a
-- returned request outside the atomic resubmission transaction.
create policy designer_no_direct_update_returned on public.designer_requests as restrictive for update to authenticated using (not public.designer_request_is_returned(id)) with check (not public.designer_request_is_returned(id));
alter function public.update_designer_request(uuid,text,public.design_request_type,text,timestamptz,timestamptz,text,text,text,text,text,text,text) rename to update_designer_request_before_return;
revoke all on function public.update_designer_request_before_return(uuid,text,public.design_request_type,text,timestamptz,timestamptz,text,text,text,text,text,text,text) from public,anon,authenticated;
create function public.update_designer_request(p_request_id uuid,p_task_type text,p_request_type public.design_request_type,p_other_design_type text,p_event_start_at timestamptz default null,p_event_end_at timestamptz default null,p_design_content text default null,p_special_content text default null,p_style text default null,p_color text default null,p_specification text default null,p_live_room text default null,p_reference_material_status text default 'not_required') returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform 1 from public.designer_requests where id=p_request_id for update;
 if public.designer_request_is_returned(p_request_id) then raise exception '已退回申请须通过重新提交操作修改'; end if;
 perform public.update_designer_request_before_return(p_request_id,p_task_type,p_request_type,p_other_design_type,p_event_start_at,p_event_end_at,p_design_content,p_special_content,p_style,p_color,p_specification,p_live_room,p_reference_material_status);
end $$;
revoke all on function public.update_designer_request(uuid,text,public.design_request_type,text,timestamptz,timestamptz,text,text,text,text,text,text,text) from public,anon;
grant execute on function public.update_designer_request(uuid,text,public.design_request_type,text,timestamptz,timestamptz,text,text,text,text,text,text,text) to authenticated;

create function public.start_claimed_designer_stage(p_stage_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.designer_request_stages; r public.designer_requests;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select * into s from public.designer_request_stages where id=p_stage_id;
 select * into r from public.designer_requests where id=s.request_id for update;
 select * into s from public.designer_request_stages where id=p_stage_id for update;
 if exists(select 1 from public.designer_deletion_approvals where request_id=r.id and status='pending') then raise exception '存在待处理的旧删除审批，申请暂时锁定'; end if;
 if r.id is null or r.deleted_at is not null or r.status in ('completed','cancelled') or s.assignee_profile_id is distinct from auth.uid() or s.stage_type not in ('design','production') or s.status<>'scheduled' or not s.claim_pending_start or exists(select 1 from public.designer_request_returns x where x.request_id=r.id and x.resubmitted_at is null) then raise exception 'Stage unavailable'; end if;
 update public.designer_request_stages set status='in_progress',claim_pending_start=false where id=s.id;
end $$;

create function public.return_designer_request_to_agent(p_request_id uuid,p_reason text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.designer_requests; snapshot jsonb;
begin
 if auth.uid() is null or not coalesce(public.current_user_has_permission('designer-intake','use'),false) or length(btrim(coalesce(p_reason,''))) not between 1 and 2000 then raise exception '退回原因必填（最多 2000 字）'; end if;
 select * into r from public.designer_requests where id=p_request_id for update;
 if exists(select 1 from public.designer_deletion_approvals where request_id=r.id and status='pending') then raise exception '存在待处理的旧删除审批，申请暂时锁定'; end if;
 if not coalesce(public.designer_request_return_safe(r.id),false) or exists(select 1 from public.designer_request_returns x where x.request_id=r.id and x.resubmitted_at is null) or not exists(select 1 from public.designer_request_stages s where s.request_id=r.id and s.assignee_profile_id=auth.uid() and s.claim_pending_start) or exists(select 1 from public.designer_request_stages s where s.request_id=r.id and s.assignee_profile_id is not null and s.assignee_profile_id<>auth.uid()) then raise exception '整单已开始、存在成果或其他负责人，不能退回'; end if;
 select jsonb_agg(jsonb_build_object('stage_id',id,'assignee_profile_id',assignee_profile_id,'assignee_employee_id',assignee_employee_id,'accepted_at',accepted_at,'status',status) order by id) into snapshot from public.designer_request_stages where request_id=r.id;
 update public.designer_request_stages set status='unclaimed',assignee_profile_id=null,assignee_employee_id=null,accepted_at=null,claim_pending_start=false where request_id=r.id and claim_pending_start;
 insert into public.designer_request_returns(request_id,returned_by,reason,stage_snapshot) values(r.id,auth.uid(),btrim(p_reason),coalesce(snapshot,'[]'::jsonb));
end $$;

-- Keep updated_at unchanged on soft deletion; other request updates retain the
-- existing timestamp behavior.
create function public.set_designer_request_updated_at() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if new.deleted_at is distinct from old.deleted_at or new.deleted_by is distinct from old.deleted_by then new.updated_at:=old.updated_at;
 else new.updated_at:=now(); end if;
 return new;
end $$;
drop trigger if exists set_designer_requests_updated_at on public.designer_requests;
create trigger set_designer_requests_updated_at before update on public.designer_requests for each row execute function public.set_designer_request_updated_at();

-- The parent guard enforces deletion safety even for direct table updates.
create or replace function public.guard_designer_deletion_parent() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='DELETE' then raise exception 'Physical deletion disabled'; end if;
 if old.deleted_at is not null then raise exception 'Deleted request is read-only'; end if;
 if exists(select 1 from public.designer_deletion_approvals a where a.request_id=old.id and a.status='pending') then raise exception '存在待处理的旧删除审批，申请暂时锁定'; end if;
 if new.deleted_at is distinct from old.deleted_at or new.deleted_by is distinct from old.deleted_by then
   if auth.uid() is null or new.deleted_at is null or new.deleted_by is distinct from auth.uid() or not coalesce(public.current_user_is_super_admin() or (old.agent_profile_id=auth.uid() and public.current_user_has_permission('agent-design-requests','use')),false) or not public.designer_request_return_safe(old.id) or not exists(select 1 from public.designer_request_returns x where x.request_id=old.id and x.resubmitted_at is null) or exists(select 1 from public.designer_request_stages s where s.request_id=old.id and s.assignee_profile_id is not null) then raise exception '软删除不符合安全条件'; end if;
   if (to_jsonb(new)-'deleted_at'-'deleted_by'-'updated_at') is distinct from (to_jsonb(old)-'deleted_at'-'deleted_by'-'updated_at') then raise exception '删除时不能修改其他字段'; end if;
 end if;
 return new;
end $$;
-- Replace the binding explicitly instead of assuming the historical trigger.
drop trigger if exists designer_deletion_parent_guard on public.designer_requests;
create trigger designer_deletion_parent_guard before update or delete on public.designer_requests for each row execute function public.guard_designer_deletion_parent();
create or replace function public.soft_delete_designer_request(p_request_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.designer_requests;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select * into r from public.designer_requests where id=p_request_id for update;
 if r.id is null or not coalesce(public.current_user_is_super_admin() or (r.agent_profile_id=auth.uid() and public.current_user_has_permission('agent-design-requests','use')),false) then raise exception '删除无权限'; end if;
 if exists(select 1 from public.designer_deletion_approvals a where a.request_id=r.id and a.status='pending') then raise exception '存在待处理的旧删除审批，申请暂时锁定'; end if;
 if r.deleted_at is not null or not coalesce(public.designer_request_return_safe(r.id),false) or not exists(select 1 from public.designer_request_returns x where x.request_id=r.id and x.resubmitted_at is null) or exists(select 1 from public.designer_request_stages x where x.request_id=r.id and (x.assignee_profile_id is not null or x.claim_pending_start)) then raise exception '申请不符合软删除条件'; end if;
 update public.designer_requests set deleted_at=now(),deleted_by=auth.uid() where id=r.id;
end $$;

create function public.resubmit_returned_designer_request(p_request_id uuid,p_items jsonb,p_task_type text,p_event_start timestamptz,p_event_end timestamptz,p_live_room text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.designer_requests; item jsonb; n integer;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select * into r from public.designer_requests where id=p_request_id for update;
 if exists(select 1 from public.designer_deletion_approvals where request_id=r.id and status='pending') then raise exception '存在待处理的旧删除审批，申请暂时锁定'; end if;
 if r.id is null or r.agent_profile_id is distinct from auth.uid() or not public.current_user_has_permission('agent-design-requests','use') or not public.designer_request_return_safe(r.id) or not exists(select 1 from public.designer_request_returns x where x.request_id=r.id and x.resubmitted_at is null) or exists(select 1 from public.designer_request_stages s where s.request_id=r.id and s.assignee_profile_id is not null) then raise exception '申请无法重新提交'; end if;
 if p_task_type is null or p_task_type not in ('daily','activity') or (p_event_start is not null and p_event_end is not null and p_event_end<p_event_start) or jsonb_typeof(p_items) is distinct from 'array' then raise exception '申请资料无效'; end if;
 select count(*) into n from public.designer_request_items where request_id=r.id;
 if (n=0 and (jsonb_array_length(p_items)<>1 or (p_items->0->>'id') is distinct from 'legacy')) or (n>0 and (jsonb_array_length(p_items)<>n or (select count(distinct value->>'id') from jsonb_array_elements(p_items))<>n or exists(select 1 from jsonb_array_elements(p_items) v where not exists(select 1 from public.designer_request_items i where i.request_id=r.id and i.id::text=v->>'id')))) then raise exception '项目清单已变更，请刷新'; end if;
 for item in select value from jsonb_array_elements(p_items) loop
  update public.designer_request_items set content=nullif(btrim(item->>'content'),''),special_content=nullif(btrim(item->>'special_content'),''),style=nullif(btrim(item->>'style'),''),color=nullif(btrim(item->>'color'),''),specification=nullif(btrim(item->>'specification'),'') where request_id=r.id and id::text=item->>'id';
 end loop;
 update public.designer_requests set task_type=p_task_type,event_start_at=p_event_start,event_end_at=p_event_end,live_room=nullif(btrim(p_live_room),''),
  design_content=case when n<=1 then nullif(btrim(p_items->0->>'content'),'') else design_content end,
  special_content=case when n<=1 then nullif(btrim(p_items->0->>'special_content'),'') else special_content end,
  style=case when n<=1 then nullif(btrim(p_items->0->>'style'),'') else style end,
  color=case when n<=1 then nullif(btrim(p_items->0->>'color'),'') else color end,
  specification=case when n<=1 then nullif(btrim(p_items->0->>'specification'),'') else specification end where id=r.id;
 update public.designer_request_returns set resubmitted_at=now(),resubmitted_by=auth.uid() where request_id=r.id and resubmitted_at is null;
end $$;
revoke all on function public.start_claimed_designer_stage(uuid),public.return_designer_request_to_agent(uuid,text),public.resubmit_returned_designer_request(uuid,jsonb,text,timestamptz,timestamptz,text),public.soft_delete_designer_request(uuid) from public,anon;
grant execute on function public.start_claimed_designer_stage(uuid),public.return_designer_request_to_agent(uuid,text),public.resubmit_returned_designer_request(uuid,jsonb,text,timestamptz,timestamptz,text),public.soft_delete_designer_request(uuid) to authenticated;
commit;
