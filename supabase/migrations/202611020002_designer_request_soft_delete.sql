-- DESIGNER-DELETE-P1: review candidate only.  Do not deploy without the
-- approved migration process.  This migration performs no physical delete.
begin;

alter table public.designer_requests
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null;

create index if not exists designer_requests_active_created_idx
  on public.designer_requests (created_at desc, id desc)
  where deleted_at is null;

-- Keep the existing workflow scope, but remove soft-deleted requests from all
-- participant reads (stages/items/reference attachments inherit this helper).
create or replace function public.can_access_designer_request(p_request_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(
    select 1 from public.designer_requests r
    where r.id=p_request_id
      and r.deleted_at is null
      and (
        r.agent_profile_id=auth.uid()
        or exists(select 1 from public.designer_request_stages s where s.request_id=r.id and s.assignee_profile_id=auth.uid())
        or (r.status='unclaimed' and public.current_user_has_permission('designer-intake','view')
            and ((r.work_mode is null) or (r.work_mode is not null and r.region_id is not null and public.current_user_can_access_region(r.region_id))))
      )
  );
$$;

drop policy if exists "Design requests are visible by scoped workflow" on public.designer_requests;
create policy "Design requests are visible by scoped workflow" on public.designer_requests
for select to authenticated using (
  deleted_at is null and (
    agent_profile_id=auth.uid()
    or designer_profile_id=auth.uid()
    or (status='unclaimed' and public.current_user_has_permission('designer-intake','view')
        and ((work_mode is null) or (work_mode is not null and region_id is not null and public.current_user_can_access_region(region_id))))
  )
);

drop policy if exists "Legacy design request updates only" on public.designer_requests;
create policy "Legacy design request updates only" on public.designer_requests
for update to authenticated
using (
  work_mode is null
  and not exists(select 1 from public.designer_request_items i where i.request_id=designer_requests.id)
  and (agent_profile_id=auth.uid() or designer_profile_id=auth.uid())
  and deleted_at is null
  and deleted_by is null
)
with check (
  work_mode is null
  and not exists(select 1 from public.designer_request_items i where i.request_id=designer_requests.id)
  and (agent_profile_id=auth.uid() or designer_profile_id=auth.uid())
  and deleted_at is null
  and deleted_by is null
);

-- Management keeps its original Super Admin / explicit regional permission
-- semantics, but has no visibility of logically deleted requests.
create or replace function public.current_user_can_view_management_designer_request(p_request_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists (
    select 1 from public.designer_requests r
    where r.id=p_request_id and r.deleted_at is null and (
      public.current_user_is_super_admin()
      or (public.current_user_has_explicit_permission('management-designer','view')
          and r.region_id is not null and public.current_user_can_access_region(r.region_id))
    )
  );
$$;

-- Fail closed: this is intentionally stricter than cancellation.  A cancelled
-- request with any acceptance, submission, confirmation, feedback, legacy work
-- history, registered deliverable, submitted version, or upload session stays.
create or replace function public.soft_delete_designer_request(p_request_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.designer_requests;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;

  select * into r from public.designer_requests where id=p_request_id for update;
  if r.id is null then raise exception 'Request not found' using errcode='P0002'; end if;
  if r.deleted_at is not null then raise exception 'Request has already been deleted' using errcode='P0001'; end if;
  if r.status<>'cancelled' then raise exception 'Only cancelled requests can be deleted' using errcode='42501'; end if;
  if r.agent_profile_id<>auth.uid() and not public.current_user_is_super_admin() then
    raise exception 'Delete permission denied' using errcode='42501';
  end if;

  -- Legacy request-level history must also be empty.
  if r.designer_profile_id is not null or r.designer_employee_id is not null
     or r.accepted_at is not null or r.completed_at is not null
     or nullif(btrim(coalesce(r.revision_note,'')),'') is not null
     or coalesce(cardinality(r.design_urls),0)<>0 then
    raise exception 'Request has protected workflow history' using errcode='P0001';
  end if;

  if exists (
    select 1 from public.designer_request_stages s
    where s.request_id=r.id and (
      s.assignee_profile_id is not null or s.assignee_employee_id is not null
      or s.accepted_at is not null or s.submitted_at is not null or s.confirmed_at is not null
      or s.confirmed_by_profile_id is not null or s.confirmed_by_employee_id is not null
      or nullif(btrim(coalesce(s.feedback,'')),'') is not null or s.feedback_count<>0
      or s.status not in ('unclaimed','scheduled','cancelled')
    )
  ) then raise exception 'Request has protected stage history' using errcode='P0001'; end if;

  -- These three tables use the actual request_id contract from the approved
  -- deliverables schema.  Reference attachments are deliberately not checked.
  if exists(select 1 from public.designer_stage_deliverables d where d.request_id=r.id)
     or exists(select 1 from public.designer_stage_deliverable_submissions v where v.request_id=r.id)
     or exists(select 1 from public.designer_stage_deliverable_upload_sessions u where u.request_id=r.id) then
    raise exception 'Request has protected deliverable history' using errcode='P0001';
  end if;

  update public.designer_requests set deleted_at=now(), deleted_by=auth.uid() where id=r.id and deleted_at is null;
  if not found then raise exception 'Request delete conflict' using errcode='40001'; end if;
end;
$$;

-- Production definitions below retain their exact signatures, SECURITY DEFINER
-- attributes and behavior; each receives only the deleted-request guard.
create or replace function public.can_write_designer_stage_deliverable(p_stage_id uuid,p_request_id uuid,p_path text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select auth.uid() is not null and exists (
    select 1 from public.designer_request_stages s
    join public.designer_requests r on r.id=s.request_id
    where s.id=p_stage_id and s.request_id=p_request_id and r.deleted_at is null
      and s.assignee_profile_id=auth.uid() and s.stage_type='design'
      and s.status in ('in_progress','revision') and r.status not in ('completed','cancelled')
      and s.request_item_id is null
      and not exists(select 1 from public.designer_request_items i where i.request_id=s.request_id)
      and p_path ~ ('^'||auth.uid()::text||'/'||p_stage_id::text||'/'||'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'||'[.](jpg|jpeg|png|webp|pdf)$')
  );
$$;

create or replace function public.can_read_designer_stage_deliverable_submission(p_stage_id uuid,p_request_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select auth.uid() is not null and exists (
    select 1 from public.designer_request_stages s
    join public.designer_requests r on r.id=s.request_id
    where s.id=p_stage_id and r.id=p_request_id and r.deleted_at is null
      and (r.agent_profile_id=auth.uid() or s.assignee_profile_id=auth.uid() or public.current_user_is_super_admin())
  );
$$;

-- The Production function previously relied only on the helper's read check.
-- Lock the request first so soft delete and session creation serialize on the
-- same row; otherwise a session could be inserted after the delete RPC's
-- session-existence check.
create or replace function public.create_designer_stage_deliverable_upload_session(p_upload_task_id uuid,p_request_id uuid,p_stage_id uuid,p_storage_path text,p_original_name text,p_content_type text,p_size_bytes bigint,p_file_fingerprint text,p_last_modified bigint)
returns public.designer_stage_deliverable_upload_sessions language plpgsql security definer set search_path=public,pg_temp as $$
declare result public.designer_stage_deliverable_upload_sessions; r public.designer_requests;
begin
  if auth.uid() is null or p_upload_task_id is null or nullif(btrim(p_file_fingerprint),'') is null
     or p_last_modified is null or p_last_modified<0 or nullif(btrim(p_original_name),'') is null
     or not coalesce(public.can_write_designer_stage_deliverable(p_stage_id,p_request_id,p_storage_path),false)
     or p_content_type not in ('image/jpeg','image/png','image/webp','application/pdf')
     or p_size_bytes is null or p_size_bytes<=0 or p_size_bytes>52428800 then
    raise exception 'Upload session denied';
  end if;
  select * into r from public.designer_requests where id=p_request_id for update;
  if r.id is null or r.deleted_at is not null
     or not coalesce(public.can_write_designer_stage_deliverable(p_stage_id,p_request_id,p_storage_path),false) then
    raise exception 'Upload session denied';
  end if;
  insert into public.designer_stage_deliverable_upload_sessions(upload_task_id,uploaded_by,request_id,stage_id,storage_path,original_name,content_type,size_bytes,file_fingerprint,last_modified,status)
  values(p_upload_task_id,auth.uid(),p_request_id,p_stage_id,p_storage_path,left(btrim(p_original_name),255),p_content_type,p_size_bytes,p_file_fingerprint,p_last_modified,'pending') returning * into result;
  return result;
end $$;

create or replace function public.list_designer_stage_deliverables(p_stage_id uuid)
returns table(id uuid,request_id uuid,stage_id uuid,request_item_id uuid,storage_path text,original_name text,content_type text,size_bytes bigint,submission_id uuid,version_number integer,created_at timestamptz,submitted_at timestamptz)
language sql stable security definer set search_path=public,pg_temp as $$
  select d.id,d.request_id,d.stage_id,d.request_item_id,d.storage_path,d.original_name,d.content_type,d.size_bytes,d.submission_id,v.version_number,d.created_at,v.submitted_at
  from public.designer_stage_deliverables d
  join public.designer_requests r on r.id=d.request_id and r.deleted_at is null
  left join public.designer_stage_deliverable_submissions v on v.id=d.submission_id
  where d.stage_id=p_stage_id and (
    (d.submission_id is not null and public.can_read_designer_stage_deliverable_submission(d.stage_id,d.request_id))
    or (d.submission_id is null and d.delete_requested_at is null and d.uploaded_by=auth.uid()
        and exists(select 1 from public.designer_request_stages s where s.id=d.stage_id and s.assignee_profile_id=auth.uid()))
  )
  order by v.version_number desc nulls last,d.created_at asc;
$$;

create or replace function public.create_designer_request_reference_attachment(p_request_id uuid,p_storage_path text,p_original_name text,p_content_type text,p_size_bytes bigint,p_reference_scope text default 'shared'::text,p_request_item_ids uuid[] default '{}'::uuid[])
returns public.designer_request_reference_attachments language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.designer_requests; result public.designer_request_reference_attachments; object_mime text; object_size bigint; path_parts text[];
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  select * into r from public.designer_requests where id=p_request_id for update;
  if r.id is null or r.deleted_at is not null or r.agent_profile_id<>auth.uid() or not public.current_user_has_permission('agent-design-requests','use') then raise exception 'Reference upload denied.'; end if;
  if p_content_type not in ('image/jpeg','image/png','image/webp','application/pdf') or p_size_bytes<=0 or nullif(btrim(p_original_name),'') is null then raise exception 'Invalid reference file.'; end if;
  if (p_content_type in ('image/jpeg','image/png','image/webp') and p_size_bytes>10485760) or (p_content_type='application/pdf' and p_size_bytes>31457280) then raise exception 'Reference file exceeds the allowed size.'; end if;
  path_parts:=string_to_array(coalesce(p_storage_path,''),'/');
  if array_length(path_parts,1)<>3 or path_parts[1]<>auth.uid()::text or path_parts[2]<>r.id::text or path_parts[3]!~'^[0-9a-f-]+\.(jpg|jpeg|png|webp|pdf)$' then raise exception 'Invalid reference file path.'; end if;
  if not ((lower(path_parts[3])~'\.(jpg|jpeg)$' and p_content_type='image/jpeg') or (lower(path_parts[3])~'\.png$' and p_content_type='image/png') or (lower(path_parts[3])~'\.webp$' and p_content_type='image/webp') or (lower(path_parts[3])~'\.pdf$' and p_content_type='application/pdf')) then raise exception 'Reference file extension does not match its content type.'; end if;
  select metadata->>'mimetype',nullif(metadata->>'size','')::bigint into object_mime,object_size from storage.objects where bucket_id='designer-request-references' and name=p_storage_path;
  if object_mime is distinct from p_content_type or object_size is distinct from p_size_bytes then raise exception 'Reference file metadata does not match.'; end if;
  if p_reference_scope not in ('shared','items') or (p_reference_scope='shared' and cardinality(coalesce(p_request_item_ids,'{}'))<>0) or (p_reference_scope='items' and cardinality(coalesce(p_request_item_ids,'{}'))=0) then raise exception 'Invalid reference scope.'; end if;
  if p_reference_scope='items' and exists(select 1 from unnest(p_request_item_ids) item_id where not exists(select 1 from public.designer_request_items i where i.id=item_id and i.request_id=r.id)) then raise exception 'Reference items must belong to this request.'; end if;
  insert into public.designer_request_reference_attachments(request_id,storage_path,original_name,content_type,size_bytes,reference_scope,request_item_ids,created_by) values(p_request_id,p_storage_path,left(nullif(btrim(p_original_name),''),255),p_content_type,p_size_bytes,p_reference_scope,coalesce(p_request_item_ids,'{}'),auth.uid()) returning * into result;
  update public.designer_requests set reference_material_status='provided' where id=r.id;
  return result;
end $$;

-- Existing workflow RPCs already reject cancelled requests.  Do not replace
-- them: in particular, submit_designer_request_stage retains the Production
-- legacy_design_enforced gate.
drop policy if exists "Request owners upload reference objects" on storage.objects;
create policy "Request owners upload reference objects" on storage.objects for insert to authenticated with check (
  bucket_id='designer-request-references'
  and public.current_user_has_permission('agent-design-requests','use')
  and array_length(storage.foldername(name),1)=2
  and (storage.foldername(name))[1]=auth.uid()::text
  and lower(name) ~ '^[0-9a-f-]+/[0-9a-f-]+/[0-9a-f-]+[.](jpg|jpeg|png|webp|pdf)$'
  and ((lower(name) ~ '[.](jpg|jpeg)$' and lower(coalesce(metadata->>'mimetype',''))='image/jpeg') or (lower(name) ~ '[.]png$' and lower(coalesce(metadata->>'mimetype',''))='image/png') or (lower(name) ~ '[.]webp$' and lower(coalesce(metadata->>'mimetype',''))='image/webp') or (lower(name) ~ '[.]pdf$' and lower(coalesce(metadata->>'mimetype',''))='application/pdf'))
  and exists(select 1 from public.designer_requests r where r.id::text=(storage.foldername(name))[2] and r.agent_profile_id=auth.uid() and r.deleted_at is null)
);

drop policy if exists "Deliverable assignee reads own drafts" on public.designer_stage_deliverables;
create policy "Deliverable assignee reads own drafts" on public.designer_stage_deliverables
for select to authenticated using (
  submission_id is null and delete_requested_at is null and uploaded_by=auth.uid()
  and exists (
    select 1 from public.designer_request_stages s
    join public.designer_requests r on r.id=s.request_id
    where s.id=designer_stage_deliverables.stage_id
      and s.assignee_profile_id=auth.uid() and r.deleted_at is null
  )
);

drop policy if exists "Upload session owner reads own" on public.designer_stage_deliverable_upload_sessions;
create policy "Upload session owner reads own" on public.designer_stage_deliverable_upload_sessions
for select to authenticated using (
  uploaded_by=auth.uid()
  and exists(select 1 from public.designer_requests r where r.id=designer_stage_deliverable_upload_sessions.request_id and r.deleted_at is null)
);

drop policy if exists "Deliverable object select is narrow" on storage.objects;
create policy "Deliverable object select is narrow" on storage.objects for select to authenticated using (
  bucket_id='designer-stage-deliverables'
  and exists (
    select 1 from public.designer_stage_deliverables d
    where d.storage_path=storage.objects.name and (
      (d.submission_id is not null and public.can_read_designer_stage_deliverable_submission(d.stage_id,d.request_id))
      or (d.submission_id is null and d.uploaded_by=auth.uid() and exists (
        select 1 from public.designer_request_stages s
        join public.designer_requests r on r.id=s.request_id
        where s.id=d.stage_id and s.assignee_profile_id=auth.uid() and r.deleted_at is null
      ))
    )
  )
);

create or replace function public.update_designer_request_reference_note(p_request_id uuid,p_reference_note text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.designer_requests set reference_note=nullif(btrim(p_reference_note),'') where id=p_request_id and agent_profile_id=auth.uid() and deleted_at is null;
  if not found then raise exception 'Reference note update denied.'; end if;
end $$;

revoke all on function public.soft_delete_designer_request(uuid) from public, anon, authenticated;
grant execute on function public.soft_delete_designer_request(uuid) to authenticated;

commit;
