-- REVIEW CANDIDATE: do not auto-deploy. Reconcile historical 202611020002 first.
begin;
-- Fail closed if the previously inspected baseline has changed.
do $$
begin
 if not exists(select 1 from supabase_migrations.schema_migrations where version='202611020002') then raise exception 'Historical deletion migration baseline not found'; end if;
 if (select count(*) from storage.buckets where id in ('designer-request-references','designer-stage-deliverables') and public is false) <> 2 then raise exception 'Designer buckets missing or public'; end if;
 if to_regclass('public.designer_deletion_approvals') is not null then raise exception 'Deletion approvals table already exists; review compatibility'; end if;
 if to_regprocedure('public.soft_delete_designer_request(uuid)') is null or to_regprocedure('public.can_delete_designer_reference_object(text)') is null then raise exception 'Designer baseline functions missing'; end if;
end $$;
alter table public.designer_requests add column if not exists deleted_at timestamptz, add column if not exists deleted_by uuid references public.profiles(id) on delete set null;
create table public.designer_deletion_approvals (
 id uuid primary key default gen_random_uuid(), request_id uuid not null references public.designer_requests(id),
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 reason text, requested_by uuid not null references public.profiles(id), requested_at timestamptz not null default now(),
 reviewed_by uuid references public.profiles(id), reviewed_at timestamptz,
 check ((status='pending' and reviewed_by is null and reviewed_at is null) or (status in ('approved','rejected') and reviewed_by is not null and reviewed_at is not null))
);
create unique index designer_deletion_one_pending on public.designer_deletion_approvals(request_id) where status='pending';
alter table public.designer_deletion_approvals enable row level security;
revoke all on public.designer_deletion_approvals from public, anon, authenticated;
create table public.designer_reference_operations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.designer_requests(id) on delete cascade,
  actor_id uuid not null,
  storage_path text not null,
  operation_kind text not null check (operation_kind in ('upload','delete')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create unique index designer_reference_operations_one_open_path
  on public.designer_reference_operations(storage_path) where completed_at is null;
create index designer_reference_operations_open_request
  on public.designer_reference_operations(request_id) where completed_at is null;
alter table public.designer_reference_operations enable row level security;
revoke all on public.designer_reference_operations from public, anon, authenticated;

create function public.begin_designer_reference_operation(p_request_id uuid,p_storage_path text,p_kind text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.designer_requests; op public.designer_reference_operations; actor uuid:=auth.uid(); parts text[];
begin
  if actor is null or p_kind is null or p_kind not in ('upload','delete') then raise exception '参考资料操作无效' using errcode='42501'; end if;
  parts:=string_to_array(coalesce(p_storage_path,''),'/');
  if array_length(parts,1)<>3 or parts[1]<>actor::text or parts[2]<>p_request_id::text
     or parts[3] !~ '^[0-9a-f-]+\.(jpg|jpeg|png|webp|pdf)$' then
    raise exception '参考资料路径无效';
  end if;
  select * into r from public.designer_requests where id=p_request_id for update;
  if not found or r.deleted_at is not null or r.agent_profile_id is distinct from actor
     or (p_kind='upload' and not public.current_user_has_permission('agent-design-requests','use'))
     or (p_kind='delete' and r.status<>'unclaimed') then
    raise exception '参考资料操作无权限或申请不可用' using errcode='42501';
  end if;
  select * into op from public.designer_reference_operations where storage_path=p_storage_path and completed_at is null for update;
  if found then
    if op.actor_id<>actor or op.request_id<>p_request_id or op.operation_kind<>p_kind then
      raise exception '此文件有未完成的操作';
    end if;
    return op.id;
  end if;
  insert into public.designer_reference_operations(request_id,actor_id,storage_path,operation_kind)
    values(p_request_id,actor,p_storage_path,p_kind) returning id into op.id;
  return op.id;
end $$;

create function public.complete_designer_reference_operation(p_operation_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare op public.designer_reference_operations; r public.designer_requests; actor uuid:=auth.uid();
begin
  select * into op from public.designer_reference_operations where id=p_operation_id;
  if not found or actor is null or op.actor_id<>actor then raise exception '参考资料操作不存在或无权限' using errcode='42501'; end if;
  select * into r from public.designer_requests where id=op.request_id for update;
  select * into op from public.designer_reference_operations where id=p_operation_id for update;
  if r.id is null or r.deleted_at is not null or r.agent_profile_id is distinct from actor then raise exception '申请不可用'; end if;
  if op.completed_at is not null then return; end if;
  if op.operation_kind='upload' then
    if not exists(select 1 from public.designer_request_reference_attachments a where a.request_id=op.request_id and a.storage_path=op.storage_path)
       or not exists(select 1 from storage.objects o where o.bucket_id='designer-request-references' and o.name=op.storage_path) then
      raise exception '上传尚未完成或登记';
    end if;
  elsif exists(select 1 from public.designer_request_reference_attachments a where a.request_id=op.request_id and a.storage_path=op.storage_path)
       or exists(select 1 from storage.objects o where o.bucket_id='designer-request-references' and o.name=op.storage_path) then
    raise exception '文件删除尚未完成';
  end if;
  update public.designer_reference_operations set completed_at=clock_timestamp() where id=op.id;
end $$;

-- Recovery inspection only. It does not clear an operation whose Storage
-- request might still be in flight.
create function public.list_pending_designer_reference_operations(p_request_id uuid)
returns table(operation_id uuid,storage_path text,operation_kind text,created_at timestamptz,object_exists boolean,registered boolean)
language sql stable security definer set search_path=public,pg_temp as $$
  select op.id,op.storage_path,op.operation_kind,op.created_at,
    exists(select 1 from storage.objects o where o.bucket_id='designer-request-references' and o.name=op.storage_path),
    exists(select 1 from public.designer_request_reference_attachments a where a.request_id=op.request_id and a.storage_path=op.storage_path)
  from public.designer_reference_operations op
  join public.designer_requests r on r.id=op.request_id
  where op.request_id=p_request_id and op.actor_id=auth.uid() and r.agent_profile_id=auth.uid()
    and r.deleted_at is null and op.completed_at is null order by op.created_at,op.id;
$$;
revoke all on function public.list_pending_designer_reference_operations(uuid) from public,anon;
grant execute on function public.list_pending_designer_reference_operations(uuid) to authenticated;
revoke all on function public.begin_designer_reference_operation(uuid,text,text),public.complete_designer_reference_operation(uuid) from public,anon;
grant execute on function public.begin_designer_reference_operation(uuid,text,text),public.complete_designer_reference_operation(uuid) to authenticated;

-- New caller retries safely after a lost response: existing registration is returned.
create function public.register_designer_reference_operation(p_operation_id uuid,p_original_name text,p_content_type text,p_size_bytes bigint,p_reference_scope text,p_request_item_ids uuid[])
returns public.designer_request_reference_attachments language plpgsql security definer set search_path=public,pg_temp as $$
declare op public.designer_reference_operations; r public.designer_requests; a public.designer_request_reference_attachments;
begin
  select * into op from public.designer_reference_operations where id=p_operation_id;
  if not found or auth.uid() is null or op.actor_id<>auth.uid() or op.operation_kind<>'upload' then raise exception '上传操作不可用'; end if;
  select * into r from public.designer_requests where id=op.request_id for update;
  select * into op from public.designer_reference_operations where id=p_operation_id for update;
  if r.id is null or r.deleted_at is not null or r.agent_profile_id is distinct from auth.uid() or op.completed_at is not null then raise exception '上传操作不可用'; end if;
  select * into a from public.designer_request_reference_attachments where request_id=op.request_id and storage_path=op.storage_path;
  if found then return a; end if;
  return public.create_designer_request_reference_attachment(op.request_id,op.storage_path,p_original_name,p_content_type,p_size_bytes,p_reference_scope,p_request_item_ids);
end $$;

create function public.deregister_designer_reference_operation(p_operation_id uuid,p_attachment_id uuid)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare op public.designer_reference_operations; r public.designer_requests; a public.designer_request_reference_attachments;
begin
  select * into op from public.designer_reference_operations where id=p_operation_id;
  if not found or auth.uid() is null or op.actor_id<>auth.uid() or op.operation_kind<>'delete' then raise exception '删除操作不可用'; end if;
  select * into r from public.designer_requests where id=op.request_id for update;
  select * into op from public.designer_reference_operations where id=p_operation_id for update;
  if r.id is null or r.deleted_at is not null or r.agent_profile_id is distinct from auth.uid() or r.status<>'unclaimed' or op.completed_at is not null then raise exception '删除操作不可用'; end if;
  select * into a from public.designer_request_reference_attachments where id=p_attachment_id;
  if not found then return op.storage_path; end if;
  if a.request_id is distinct from op.request_id or a.storage_path is distinct from op.storage_path then raise exception '参考资料不匹配'; end if;
  return public.delete_designer_request_reference_attachment(p_attachment_id);
end $$;
revoke all on function public.register_designer_reference_operation(uuid,text,text,bigint,text,uuid[]),public.deregister_designer_reference_operation(uuid,uuid) from public,anon;
grant execute on function public.register_designer_reference_operation(uuid,text,text,bigint,text,uuid[]),public.deregister_designer_reference_operation(uuid,uuid) to authenticated;


-- The management view scope remains regional; approval additionally requires use permission.
create function public.can_approve_designer_deletion(p_request_id uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select auth.uid() is not null and exists(select 1 from public.designer_requests r where r.id=p_request_id and (public.current_user_is_super_admin() or (public.current_user_has_explicit_permission('management-designer','use') and r.region_id is not null and public.current_user_can_access_region(r.region_id))));
$$;
create function public.request_designer_deletion(p_request_id uuid,p_reason text default null) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.designer_requests; open_operation boolean;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select * into r from public.designer_requests where id=p_request_id for update;
 if r.id is null or r.deleted_at is not null or not coalesce(public.current_user_is_super_admin() or (r.agent_profile_id=auth.uid() and public.current_user_has_permission('agent-design-requests','use')), false) then raise exception 'Request unavailable'; end if;
 if to_regclass('public.designer_reference_operations') is not null then
  execute 'select exists(select 1 from public.designer_reference_operations where request_id=$1 and completed_at is null)' into open_operation using r.id;
  if open_operation then raise exception 'Reference operation in progress'; end if;
 end if;
 if to_regclass('public.designer_stage_deliverable_upload_sessions') is not null then
  execute 'select exists(select 1 from public.designer_stage_deliverable_upload_sessions where request_id=$1 and status in (''pending'',''uploading'',''uploaded'',''registering'',''cleanup_requested'',''cleanup_failed''))' into open_operation using r.id;
  if open_operation then raise exception 'Deliverable upload or cleanup in progress'; end if;
 end if;
 if exists(select 1 from public.designer_stage_deliverables d where d.request_id=r.id and d.submission_id is null and d.delete_requested_at is not null) then raise exception 'Deliverable deletion in progress'; end if;
 insert into public.designer_deletion_approvals(request_id,requested_by,reason) values(r.id,auth.uid(),nullif(btrim(p_reason),''));
end $$;
create function public.review_designer_deletion(p_approval_id uuid,p_approve boolean) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.designer_deletion_approvals; r public.designer_requests;
begin
 if auth.uid() is null or p_approve is null then raise exception 'Permission denied'; end if;
 select * into a from public.designer_deletion_approvals where id=p_approval_id;
 select * into r from public.designer_requests where id=a.request_id for update;
 select * into a from public.designer_deletion_approvals where id=p_approval_id for update;
 if r.id is null or r.deleted_at is not null or a.status is distinct from 'pending' or not coalesce(public.can_approve_designer_deletion(r.id),false) then raise exception 'Approval unavailable'; end if;
 update public.designer_deletion_approvals set status=case when p_approve then 'approved' else 'rejected' end,reviewed_by=auth.uid(),reviewed_at=now() where id=a.id;
 if p_approve then update public.designer_requests set deleted_at=now(),deleted_by=auth.uid() where id=r.id; end if;
end $$;
create function public.list_designer_deletion_approvals(p_status text) returns table(approval_id uuid, request_id uuid, creator_name text, request_status text, stage text, created_at timestamptz, requested_at timestamptz, reason text, requested_by uuid, reviewed_by uuid, reviewed_at timestamptz, applicant_name text, requester_name text, reviewer_name text, can_review boolean) language sql stable security definer set search_path=public,pg_temp as $$
 select a.id,r.id,r.creator_name,r.status::text,coalesce((select s.stage_type::text||' / '||s.status::text from public.designer_request_stages s where s.request_id=r.id order by case when s.status::text not in ('completed','cancelled') then 0 else 1 end,s.created_at desc limit 1),r.status::text),r.created_at,a.requested_at,a.reason,a.requested_by,a.reviewed_by,a.reviewed_at,coalesce(app.nickname,app.full_name),coalesce(req.nickname,req.full_name,a.requested_by::text),coalesce(rev.nickname,rev.full_name,a.reviewed_by::text),public.can_approve_designer_deletion(r.id)
 from public.designer_deletion_approvals a join public.designer_requests r on r.id=a.request_id
 left join public.employees app on app.id=r.agent_employee_id
 left join public.employees req on req.profile_id=a.requested_by and req.deleted_at is null
 left join public.employees rev on rev.profile_id=a.reviewed_by and rev.deleted_at is null
 where a.status=p_status and p_status in ('pending','approved') and (public.current_user_is_super_admin() or (r.agent_profile_id=auth.uid() and public.current_user_has_permission('agent-design-requests','use')) or (public.current_user_has_explicit_permission('management-designer','view') and r.region_id is not null and public.current_user_can_access_region(r.region_id))) order by a.requested_at desc;
$$;
-- Parent and stage changes serialize against request/review RPCs. Direct delete is forbidden.
create function public.guard_designer_deletion_parent() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='DELETE' then raise exception 'Physical deletion disabled'; end if;
 if old.deleted_at is not null then raise exception 'Deleted request is read-only'; end if;
 if new.deleted_at is distinct from old.deleted_at or new.deleted_by is distinct from old.deleted_by then
   if new.deleted_at is null or new.deleted_by is distinct from auth.uid() or not exists(select 1 from public.designer_deletion_approvals a where a.request_id=old.id and a.status='approved' and a.reviewed_by=auth.uid() and a.reviewed_at=transaction_timestamp()) then raise exception 'Approval required'; end if;
 elsif exists(select 1 from public.designer_deletion_approvals a where a.request_id=old.id and a.status='pending') then raise exception 'Pending deletion approval'; end if;
 return new;
end $$;
create trigger designer_deletion_parent_guard before update or delete on public.designer_requests for each row execute function public.guard_designer_deletion_parent();
create function public.guard_designer_deletion_child() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare rid uuid; r public.designer_requests;
begin
 if tg_op='DELETE' then rid=old.request_id; else rid=new.request_id; end if;
 if tg_op='UPDATE' and new.request_id is distinct from old.request_id then raise exception 'Cannot move workflow record'; end if;
 select * into r from public.designer_requests where id=rid for update;
 if r.id is null or r.deleted_at is not null or exists(select 1 from public.designer_deletion_approvals a where a.request_id=rid and a.status='pending') then raise exception 'Request is locked'; end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
-- Tables with request_id are protected, including review, attachment and deliverable records.
do $$ declare t record; begin
 for t in select c.table_name from information_schema.columns c join information_schema.tables x on x.table_schema=c.table_schema and x.table_name=c.table_name and x.table_type='BASE TABLE' where c.table_schema='public' and c.column_name='request_id' and (c.table_name like 'designer_request_%' or c.table_name like 'designer_stage_%' or c.table_name like 'designer_review_%' or c.table_name like 'designer_legacy_%') and c.table_name <> 'designer_deletion_approvals' loop
 execute format('create trigger designer_deletion_child_guard before insert or update or delete on public.%I for each row execute function public.guard_designer_deletion_child()',t.table_name);
 end loop;
end $$;

-- Stage-linked tables do not have request_id; serialize through the parent.
create function public.guard_designer_deletion_stage_child() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare sid uuid; rid uuid; r public.designer_requests;
begin
 if tg_op='DELETE' then sid:=old.stage_id; else sid:=new.stage_id; end if;
 if tg_op='UPDATE' and new.stage_id is distinct from old.stage_id then raise exception 'Cannot move workflow record'; end if;
 select request_id into rid from public.designer_request_stages where id=sid;
 select * into r from public.designer_requests where id=rid for update;
 if r.id is null or r.deleted_at is not null or exists(select 1 from public.designer_deletion_approvals a where a.request_id=rid and a.status='pending') then raise exception 'Request is locked'; end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
do $$ declare t record; begin
 for t in select c.table_name from information_schema.columns c join information_schema.tables x on x.table_schema=c.table_schema and x.table_name=c.table_name and x.table_type='BASE TABLE' where c.table_schema='public' and c.column_name='stage_id' and (c.table_name like 'designer_review_%' or c.table_name like 'designer_legacy_%' or c.table_name like 'designer_stage_%') and not exists(select 1 from information_schema.columns r where r.table_schema=c.table_schema and r.table_name=c.table_name and r.column_name='request_id') loop
 execute format('create trigger designer_deletion_stage_child_guard before insert or update or delete on public.%I for each row execute function public.guard_designer_deletion_stage_child()',t.table_name);
 end loop;
end $$;
-- Reference operations are a separate family, not designer_request_*.
do $$ begin
 if to_regclass('public.designer_reference_operations') is not null then
 execute 'create trigger designer_deletion_child_guard before insert or update or delete on public.designer_reference_operations for each row execute function public.guard_designer_deletion_child()';
 end if;
end $$;
-- Storage policies narrow existing permissions; no file is removed by this migration.
create function public.designer_deletion_storage_writable(p_bucket text,p_path text) returns boolean language sql stable security definer set search_path=public,storage,pg_temp as $$
 select case when p_bucket='designer-request-references' then exists(select 1 from public.designer_requests r where r.id::text=(storage.foldername(p_path))[2] and r.deleted_at is null and not exists(select 1 from public.designer_deletion_approvals a where a.request_id=r.id and a.status='pending'))
 when p_bucket='designer-stage-deliverables' then exists(select 1 from public.designer_request_stages s join public.designer_requests r on r.id=s.request_id where s.id::text=(storage.foldername(p_path))[2] and r.deleted_at is null and not exists(select 1 from public.designer_deletion_approvals a where a.request_id=r.id and a.status='pending')) else true end;
$$;
revoke all on function public.designer_deletion_storage_writable(text,text) from public,anon;
grant execute on function public.designer_deletion_storage_writable(text,text) to authenticated;
create policy designer_deletion_storage_insert on storage.objects as restrictive for insert to authenticated with check(public.designer_deletion_storage_writable(bucket_id,name));
create policy designer_deletion_storage_update on storage.objects as restrictive for update to authenticated using(public.designer_deletion_storage_writable(bucket_id,name)) with check(public.designer_deletion_storage_writable(bucket_id,name));
create policy designer_deletion_storage_delete on storage.objects as restrictive for delete to authenticated using(public.designer_deletion_storage_writable(bucket_id,name));


-- Do not permit ordinary INSERT to set deletion markers, including legacy rows.
create policy designer_no_direct_deleted_insert on public.designer_requests as restrictive for insert to authenticated with check (deleted_at is null and deleted_by is null);
-- Current production locks the attachment first; use request then attachment so
-- deletion requests and attachment deregistration serialize in the same order.
create or replace function public.delete_designer_request_reference_attachment(p_attachment_id uuid)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare rid uuid; a public.designer_request_reference_attachments; r public.designer_requests;
begin
 if auth.uid() is null then raise exception 'Reference cannot be removed'; end if;
 select request_id into rid from public.designer_request_reference_attachments where id=p_attachment_id;
 select * into r from public.designer_requests where id=rid for update;
 select * into a from public.designer_request_reference_attachments where id=p_attachment_id for update;
 if r.id is null or a.id is null or a.request_id is distinct from r.id or r.agent_profile_id is distinct from auth.uid() or r.status <> 'unclaimed' or r.deleted_at is not null or exists(select 1 from public.designer_deletion_approvals x where x.request_id=r.id and x.status='pending') then raise exception 'Reference cannot be removed'; end if;
 delete from public.designer_request_reference_attachments where id=a.id;
 return a.storage_path;
end $$;


-- Existing clients can continue using their original reference endpoints.
-- The optional operation protocol used by the current local service is retained.
-- Storage writes and deletes remain restricted by designer_deletion_storage_*;
-- older in-flight requests cannot be tracked and must be drained at deployment.

-- Existing permissive RLS still applies; this policy can only narrow access.
create policy designer_active_requests_only on public.designer_requests as restrictive for select to authenticated using (deleted_at is null);
-- Management's SECURITY DEFINER list must filter deleted requests too.
create or replace function public.current_user_can_view_management_designer_request(p_request_id uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.designer_requests r where r.id=p_request_id and r.deleted_at is null and (public.current_user_is_super_admin() or (public.current_user_has_explicit_permission('management-designer','view') and r.region_id is not null and public.current_user_can_access_region(r.region_id))));
$$;

-- Deleted detail access is scoped independently from the normal active list.
create function public.can_read_deleted_designer_request(p_request_id uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select auth.uid() is not null and exists(select 1 from public.designer_requests r where r.id=p_request_id and r.deleted_at is not null and (public.current_user_is_super_admin() or (r.agent_profile_id=auth.uid() and public.current_user_has_permission('agent-design-requests','use')) or (public.current_user_has_explicit_permission('management-designer','view') and r.region_id is not null and public.current_user_can_access_region(r.region_id))));
$$;
create function public.get_deleted_designer_request_detail(p_approval_id uuid) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare rid uuid; result jsonb;
begin
 select a.request_id into rid from public.designer_deletion_approvals a where a.id=p_approval_id and a.status='approved';
 if rid is null or not coalesce(public.can_read_deleted_designer_request(rid),false) then raise exception 'Permission denied'; end if;
 select jsonb_build_object('request',jsonb_build_object('design_content',r.design_content,'special_content',r.special_content,'style',r.style,'color',r.color,'specification',r.specification,'reference_urls',r.reference_urls,'design_urls',r.design_urls),
 'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'item_name',i.item_name,'item_type',i.item_type,'content',i.content,'style',i.style,'color',i.color,'specification',i.specification) order by i.sort_order) from public.designer_request_items i where i.request_id=rid),'[]'::jsonb),
 'stages',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'stage_type',s.stage_type,'status',s.status,'accepted_at',s.accepted_at,'submitted_at',s.submitted_at,'confirmed_at',s.confirmed_at,'feedback',s.feedback) order by s.created_at) from public.designer_request_stages s where s.request_id=rid),'[]'::jsonb),
 'attachments',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'original_name',a.original_name,'storage_path',a.storage_path)) from public.designer_request_reference_attachments a where a.request_id=rid),'[]'::jsonb),
 'deliverables',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'original_name',d.original_name,'storage_path',d.storage_path,'submitted_at',v.submitted_at)) from public.designer_stage_deliverables d left join public.designer_stage_deliverable_submissions v on v.id=d.submission_id where d.request_id=rid),'[]'::jsonb)) into result from public.designer_requests r where r.id=rid;
 return result;
end $$;
-- A private object can be signed only when it is a registered historical file
-- on a deleted request and the caller has the same scoped detail permission.
create function public.can_read_deleted_designer_object(p_bucket text,p_path text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select case when p_bucket='designer-request-references' then exists(select 1 from public.designer_request_reference_attachments a where a.storage_path=p_path and public.can_read_deleted_designer_request(a.request_id))
 when p_bucket='designer-stage-deliverables' then exists(select 1 from public.designer_stage_deliverables d where d.storage_path=p_path and public.can_read_deleted_designer_request(d.request_id)) else false end;
$$;
revoke all on function public.can_read_deleted_designer_request(uuid), public.get_deleted_designer_request_detail(uuid), public.can_read_deleted_designer_object(text,text) from public,anon;
grant execute on function public.can_read_deleted_designer_request(uuid), public.get_deleted_designer_request_detail(uuid), public.can_read_deleted_designer_object(text,text) to authenticated;
create policy designer_deleted_history_read on storage.objects for select to authenticated using(public.can_read_deleted_designer_object(bucket_id,name));


-- Preserve existing scoped access and allow Super Admin to read active requests.
create policy designer_super_admin_active_select on public.designer_requests for select to authenticated using (deleted_at is null and public.current_user_is_super_admin());
-- The former storage helper lacked both soft-delete and pending checks.
create or replace function public.can_delete_designer_reference_object(p_path text)
returns boolean language sql stable security definer set search_path=public,storage,pg_temp as $$
 select auth.uid() is not null and exists(select 1 from public.designer_requests r
 where r.id::text=(storage.foldername(p_path))[2] and (storage.foldername(p_path))[1]=auth.uid()::text
 and r.agent_profile_id=auth.uid() and r.status='unclaimed' and r.deleted_at is null
 and not exists(select 1 from public.designer_deletion_approvals a where a.request_id=r.id and a.status='pending')
 and (not public.designer_reference_path_is_registered(p_path) or exists(select 1 from public.designer_request_reference_attachments a where a.storage_path=p_path and a.request_id=r.id)));
$$;
-- Retire the historical SECURITY DEFINER body even for previously granted callers.
create or replace function public.soft_delete_designer_request(p_request_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin raise exception 'Direct deletion is disabled; submit a deletion request for approval' using errcode='42501'; end;
$$;

-- Legacy direct deletion must never bypass approval.
do $$ begin if to_regprocedure('public.soft_delete_designer_request(uuid)') is not null then execute 'revoke execute on function public.soft_delete_designer_request(uuid) from public, anon, authenticated'; end if; end $$;
revoke all on function public.request_designer_deletion(uuid,text), public.review_designer_deletion(uuid,boolean), public.list_designer_deletion_approvals(text), public.can_approve_designer_deletion(uuid) from public, anon;
grant execute on function public.request_designer_deletion(uuid,text), public.review_designer_deletion(uuid,boolean), public.list_designer_deletion_approvals(text), public.can_approve_designer_deletion(uuid) to authenticated;
commit;
