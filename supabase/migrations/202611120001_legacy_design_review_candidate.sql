-- Candidate only: validate against the deployed RPC definitions before applying.
-- No historical rows are changed. Existing non-Legacy stages are unaffected.
-- Keep all schema changes atomic if any precondition fails.
begin;
create table public.designer_legacy_review_boundary (singleton boolean primary key default true check(singleton), installed_at timestamptz not null);
insert into public.designer_legacy_review_boundary values (true, clock_timestamp());
alter table public.designer_legacy_review_boundary enable row level security;
revoke all on public.designer_legacy_review_boundary from public, anon, authenticated;
create table public.designer_legacy_return_feedback (
 id uuid primary key default gen_random_uuid(),
 stage_id uuid not null references public.designer_request_stages(id),
 submission_id uuid not null references public.designer_stage_deliverable_submissions(id),
 feedback text not null check (length(btrim(feedback)) > 0),
 returned_at timestamptz not null default now(),
 returned_by uuid not null references public.profiles(id),
 unique (submission_id)
);
alter table public.designer_legacy_return_feedback enable row level security;
revoke all on public.designer_legacy_return_feedback from public, anon, authenticated;
create function public.can_read_legacy_return_feedback(p_stage_id uuid, p_submission_id uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.designer_stage_deliverable_submissions v where v.id=p_submission_id and v.stage_id=p_stage_id and public.can_read_designer_stage_deliverable_submission(v.stage_id,v.request_id));
$$;
revoke all on function public.can_read_legacy_return_feedback(uuid,uuid) from public,anon;
grant execute on function public.can_read_legacy_return_feedback(uuid,uuid) to authenticated;
create policy "Legacy feedback participants read" on public.designer_legacy_return_feedback for select to authenticated
 using (public.can_read_legacy_return_feedback(stage_id, submission_id));
grant select on public.designer_legacy_return_feedback to authenticated;

create function public.guard_legacy_design_transition() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.designer_stage_deliverable_submissions;
begin
 if new.stage_type <> 'design' or new.request_item_id is not null or exists(select 1 from public.designer_request_items where request_id=new.request_id) then return new; end if;
 if old.status in ('in_progress','revision') and new.status='awaiting_agent_confirmation' then
   select * into v from public.designer_stage_deliverable_submissions where stage_id=new.id order by version_number desc limit 1;
   if v.id is null or v.request_id<>new.request_id or (old.submitted_at is not null and v.submitted_at<=old.submitted_at)
      or not exists(select 1 from public.designer_stage_deliverables d where d.submission_id=v.id and d.stage_id=new.id and d.request_id=new.request_id and d.content_type in ('image/jpeg','image/png','image/webp') and d.delete_requested_at is null) then
      raise exception '请先上传本轮设计图片并使用成果提交';
   end if;
 end if;
 if old.status='awaiting_agent_confirmation' and new.status='revision' then
   if nullif(btrim(new.feedback),'') is null then raise exception '请填写退回意见'; end if;
   select * into v from public.designer_stage_deliverable_submissions where stage_id=new.id and request_id=new.request_id order by version_number desc limit 1;
   -- A pre-existing unversioned submission remains usable without invented history.
   if v.id is not null and v.submitted_at=old.submitted_at then
     insert into public.designer_legacy_return_feedback(stage_id,submission_id,feedback,returned_by) values(new.id,v.id,btrim(new.feedback),auth.uid());
   end if;
 end if;
 return new;
end $$;
revoke all on function public.guard_legacy_design_transition() from public,anon,authenticated;
create trigger guard_legacy_design_transition before update of status on public.designer_request_stages for each row execute function public.guard_legacy_design_transition();

-- Direct table UPDATE remains available for ordinary request fields under RLS.
-- Sensitive workflow fields are changed only by existing SECURITY DEFINER RPCs.
-- This affects direct authenticated updates to legacy no-item requests only.
-- The trigger owner must see every item despite RLS; otherwise stop installation.
do $item_visibility$
begin
 if not exists (
   select 1 from pg_class c join pg_roles r on r.rolname = current_user
   where c.oid = 'public.designer_request_items'::regclass
     and (r.rolsuper or r.rolbypassrls or (c.relowner = r.oid and not c.relforcerowsecurity))
 ) then raise exception 'Migration role cannot bypass RLS for designer_request_items'; end if;
end $item_visibility$;
create function public.guard_legacy_request_direct_update() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if old.work_mode is null
    and not exists(select 1 from public.designer_request_items where request_id=old.id)
    and (to_jsonb(new) - array['task_type','request_type','other_design_type','event_start_at','event_end_at','design_content','special_content','style','color','specification','live_room','reference_material_status','reference_note','reference_urls','updated_at'])
        is distinct from
        (to_jsonb(old) - array['task_type','request_type','other_design_type','event_start_at','event_end_at','design_content','special_content','style','color','specification','live_room','reference_material_status','reference_note','reference_urls','updated_at']) then
   raise exception '请使用美工流程进行此操作';
 end if;
 return new;
end $$;
revoke all on function public.guard_legacy_request_direct_update() from public,anon,authenticated;
-- WHEN runs as the caller, before entering the SECURITY DEFINER trigger.
-- Existing SECURITY DEFINER RPCs therefore retain their original behavior.
create trigger guard_legacy_request_direct_update before update on public.designer_requests
for each row when (current_user = 'authenticated')
execute function public.guard_legacy_request_direct_update();

-- Verify dependent live interfaces, not only the three wrapped RPCs.
do $dependencies$
declare x record; actual text;
begin
 for x in select * from (values
  ('public.submit_designer_stage_deliverables(uuid)','1ae767f39f4c02619300d95f36eb7787'),
  ('public.create_designer_stage_deliverable_upload_session(uuid,uuid,uuid,text,text,text,bigint,text,bigint)','d5acf4ba5858ca4561c8459bf02bce40'),
  ('public.register_designer_stage_deliverable_draft(uuid)','8a3e3e33a619370d65f47ce1621ff4ce'),
  ('public.list_designer_stage_deliverables(uuid)','8b3dbaff6b4281d5d464ed01209adb49')
 ) as f(signature,expected_md5) loop
  if to_regprocedure(x.signature) is null then raise exception 'Missing required function: %',x.signature; end if;
  actual:=md5(replace(pg_get_functiondef(to_regprocedure(x.signature)),chr(13),''));
  if actual is distinct from x.expected_md5 then raise exception 'Frozen definition changed: %',x.signature; end if;
 end loop;
end $dependencies$;

-- Freeze-check the published implementations before deriving private copies.
-- CREATE OR REPLACE below preserves the original function OIDs and ACLs.
-- The copy is a new object with no client EXECUTE grant; existing dependencies
-- continue to point at the guarded original OID, never at this copy.
do $freeze$
declare x record; definition text; copied text;
begin
 for x in select * from (values
  ('submit_designer_request_stage','uuid, text','legacy_checked_base_submit','8dfad742f21f4ae1f7d186b02c846eff'),
  ('return_designer_request_stage','uuid, text','legacy_checked_base_return','da53df13290d426408c5f5a363fb3a3f'),
  ('confirm_designer_request_stage','uuid','legacy_checked_base_confirm','203f13c9954f70112c826c0b952b1031')
 ) as f(source_name,args,copy_name,expected_md5) loop
   if to_regprocedure(format('public.%I(%s)',x.source_name,x.args)) is null then raise exception 'Missing required function: %',x.source_name; end if;
   definition:=pg_get_functiondef(to_regprocedure(format('public.%I(%s)',x.source_name,x.args)));
   if md5(replace(definition,chr(13),'')) is distinct from x.expected_md5 then raise exception 'Frozen definition changed: %',x.source_name; end if;
   if to_regprocedure(format('public.%I(%s)',x.copy_name,x.args)) is not null then raise exception 'Private copy already exists: %',x.copy_name; end if;
   copied:=replace(definition,'FUNCTION public.'||x.source_name||'(', 'FUNCTION public.'||x.copy_name||'(');
   if copied=definition then raise exception 'Could not derive private function: %',x.source_name; end if;
   execute copied;
   execute format('revoke all on function public.%I(%s) from public, anon, authenticated',x.copy_name,x.args);
 end loop;
end $freeze$;

create function public.is_legacy_design_stage(p_stage_id uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.designer_request_stages s where s.id=p_stage_id and s.stage_type='design' and s.request_item_id is null and not exists(select 1 from public.designer_request_items i where i.request_id=s.request_id));
$$;
revoke all on function public.is_legacy_design_stage(uuid) from public,anon,authenticated;

create or replace function public.submit_designer_request_stage(p_stage_id uuid,p_feedback text default null) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if public.is_legacy_design_stage(p_stage_id) then raise exception '请使用设计成果提交'; end if;
 perform public.legacy_checked_base_submit(p_stage_id,p_feedback);
end $$;
create or replace function public.return_designer_request_stage(p_stage_id uuid,p_feedback text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if public.is_legacy_design_stage(p_stage_id) then raise exception '请刷新页面并审核当前版本'; end if;
 perform public.legacy_checked_base_return(p_stage_id,p_feedback);
end $$;
create or replace function public.confirm_designer_request_stage(p_stage_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if public.is_legacy_design_stage(p_stage_id) then raise exception '请刷新页面并审核当前版本'; end if;
 perform public.legacy_checked_base_confirm(p_stage_id);
end $$;
-- Existing RPC ACLs are preserved by CREATE OR REPLACE.

create function public.review_legacy_design_submission(p_stage_id uuid,p_submission_id uuid,p_accept boolean,p_feedback text default null,p_expected_submitted_at timestamptz default null) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.designer_request_stages; r public.designer_requests; v uuid;
begin
 if auth.uid() is null or p_accept is null or p_expected_submitted_at is null then raise exception 'Review denied'; end if;
 select * into s from public.designer_request_stages where id=p_stage_id;
 if s.id is null then raise exception 'Review denied'; end if;
 select * into r from public.designer_requests where id=s.request_id for update;
 select * into s from public.designer_request_stages where id=p_stage_id for update;
 if r.id is null or s.request_id is distinct from r.id or r.agent_profile_id is distinct from auth.uid() or r.status in ('completed','cancelled') or s.status <> 'awaiting_agent_confirmation' or not public.is_legacy_design_stage(s.id) then raise exception 'Review denied'; end if;
 select id into v from public.designer_stage_deliverable_submissions where stage_id=s.id and request_id=r.id order by version_number desc limit 1;
 if s.submitted_at is distinct from p_expected_submitted_at then raise exception '版本已变更，请刷新后重新审核'; end if;
 if p_submission_id is null then
   if v is not null or s.submitted_at is null or s.submitted_at >= (select installed_at from public.designer_legacy_review_boundary where singleton) then raise exception '历史审核不适用'; end if;
 else
   if v is distinct from p_submission_id or not exists(select 1 from public.designer_stage_deliverable_submissions x where x.id=v and x.submitted_at=s.submitted_at) then raise exception '版本已变更，请刷新后重新审核'; end if;
 end if;
 if p_accept then perform public.legacy_checked_base_confirm(s.id);
 else
   if nullif(btrim(p_feedback),'') is null then raise exception '请填写退回意见'; end if;
   perform public.legacy_checked_base_return(s.id,p_feedback);
 end if;
end $$;
revoke all on function public.review_legacy_design_submission(uuid,uuid,boolean,text,timestamptz) from public,anon;
grant execute on function public.review_legacy_design_submission(uuid,uuid,boolean,text,timestamptz) to authenticated;
commit;
