begin;

-- Private, request-scoped reference files. Existing requests remain valid with no rows.
alter table public.designer_requests add column if not exists reference_note text;

create table if not exists public.designer_request_reference_attachments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.designer_requests(id) on delete cascade,
  storage_path text not null unique,
  original_name text not null,
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes bigint not null check (
    (content_type in ('image/jpeg', 'image/png', 'image/webp') and size_bytes > 0 and size_bytes <= 10485760)
    or (content_type = 'application/pdf' and size_bytes > 0 and size_bytes <= 31457280)
  ),
  reference_scope text not null default 'shared' check (reference_scope in ('shared', 'items')),
  request_item_ids uuid[] not null default '{}',
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  check ((reference_scope = 'shared' and cardinality(request_item_ids) = 0) or (reference_scope = 'items' and cardinality(request_item_ids) > 0))
);
create index if not exists designer_request_reference_attachments_request_idx on public.designer_request_reference_attachments(request_id, created_at);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('designer-request-references', 'designer-request-references', false, 31457280, array['image/jpeg','image/png','image/webp','application/pdf']::text[])
on conflict (id) do update set public = false, file_size_limit = 31457280, allowed_mime_types = array['image/jpeg','image/png','image/webp','application/pdf']::text[];

alter table public.designer_request_reference_attachments enable row level security;
revoke all on table public.designer_request_reference_attachments from public, anon;
grant select on table public.designer_request_reference_attachments to authenticated;
create policy "Designer request participants read references" on public.designer_request_reference_attachments for select to authenticated using (public.can_access_designer_request(request_id));

create or replace function public.designer_reference_path_is_registered(p_path text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.designer_request_reference_attachments where storage_path = p_path)
$$;

create or replace function public.can_read_designer_reference_object(p_path text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(
    select 1 from public.designer_request_reference_attachments a
    where a.storage_path = p_path and public.can_access_designer_request(a.request_id)
  )
$$;

create or replace function public.can_delete_designer_reference_object(p_path text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(
    select 1 from public.designer_requests r
    where r.id::text = (storage.foldername(p_path))[2]
      and (storage.foldername(p_path))[1] = auth.uid()::text
      and r.agent_profile_id = auth.uid()
      and r.status = 'unclaimed'
      and (
        not public.designer_reference_path_is_registered(p_path)
        or exists(select 1 from public.designer_request_reference_attachments a where a.storage_path = p_path and a.request_id = r.id)
      )
  )
$$;

create policy "Request owners upload reference objects" on storage.objects for insert to authenticated with check (
  bucket_id = 'designer-request-references'
  and public.current_user_has_permission('agent-design-requests', 'use')
  and array_length(storage.foldername(name), 1) = 2
  and (storage.foldername(name))[1] = auth.uid()::text
  and lower(name) ~ '^[0-9a-f-]+/[0-9a-f-]+/[0-9a-f-]+\.(jpg|jpeg|png|webp|pdf)$'
  and ((lower(name) ~ '\.(jpg|jpeg)$' and lower(coalesce(metadata->>'mimetype','')) = 'image/jpeg') or (lower(name) ~ '\.png$' and lower(coalesce(metadata->>'mimetype','')) = 'image/png') or (lower(name) ~ '\.webp$' and lower(coalesce(metadata->>'mimetype','')) = 'image/webp') or (lower(name) ~ '\.pdf$' and lower(coalesce(metadata->>'mimetype','')) = 'application/pdf'))
  and exists(select 1 from public.designer_requests r where r.id::text = (storage.foldername(name))[2] and r.agent_profile_id = auth.uid())
);
create policy "Request participants read registered reference objects" on storage.objects for select to authenticated using (
  bucket_id = 'designer-request-references'
  and public.can_read_designer_reference_object(name)
);
-- Storage.remove() authorizes both SELECT and DELETE. This deliberately
-- covers only an owner's own unclaimed request path, including an object
-- that is not yet registered or has just been deregistered for removal.
create policy "Request owners read removable reference objects" on storage.objects for select to authenticated using (
  bucket_id = 'designer-request-references'
  and public.can_delete_designer_reference_object(name)
);
create policy "Request owners remove eligible reference objects" on storage.objects for delete to authenticated using (
  bucket_id = 'designer-request-references'
  and public.can_delete_designer_reference_object(name)
);

create or replace function public.create_designer_request_reference_attachment(p_request_id uuid, p_storage_path text, p_original_name text, p_content_type text, p_size_bytes bigint, p_reference_scope text default 'shared', p_request_item_ids uuid[] default '{}')
returns public.designer_request_reference_attachments language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.designer_requests; result public.designer_request_reference_attachments; object_mime text; object_size bigint; path_parts text[];
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  select * into r from public.designer_requests where id = p_request_id for update;
  if r.id is null or r.agent_profile_id <> auth.uid() or not public.current_user_has_permission('agent-design-requests', 'use') then raise exception 'Reference upload denied.'; end if;
  if p_content_type not in ('image/jpeg','image/png','image/webp','application/pdf') or p_size_bytes <= 0 or nullif(btrim(p_original_name),'') is null then raise exception 'Invalid reference file.'; end if;
  if (p_content_type in ('image/jpeg','image/png','image/webp') and p_size_bytes > 10485760) or (p_content_type = 'application/pdf' and p_size_bytes > 31457280) then raise exception 'Reference file exceeds the allowed size.'; end if;
  path_parts := string_to_array(coalesce(p_storage_path, ''), '/');
  if array_length(path_parts, 1) <> 3 or path_parts[1] <> auth.uid()::text or path_parts[2] <> r.id::text or path_parts[3] !~ '^[0-9a-f-]+\.(jpg|jpeg|png|webp|pdf)$' then raise exception 'Invalid reference file path.'; end if;
  if not ((lower(path_parts[3]) ~ '\.(jpg|jpeg)$' and p_content_type = 'image/jpeg') or (lower(path_parts[3]) ~ '\.png$' and p_content_type = 'image/png') or (lower(path_parts[3]) ~ '\.webp$' and p_content_type = 'image/webp') or (lower(path_parts[3]) ~ '\.pdf$' and p_content_type = 'application/pdf')) then raise exception 'Reference file extension does not match its content type.'; end if;
  select metadata->>'mimetype', nullif(metadata->>'size','')::bigint into object_mime, object_size from storage.objects where bucket_id = 'designer-request-references' and name = p_storage_path;
  if object_mime is distinct from p_content_type or object_size is distinct from p_size_bytes then raise exception 'Reference file metadata does not match.'; end if;
  if p_reference_scope not in ('shared','items') or (p_reference_scope = 'shared' and cardinality(coalesce(p_request_item_ids,'{}')) <> 0) or (p_reference_scope = 'items' and cardinality(coalesce(p_request_item_ids,'{}')) = 0) then raise exception 'Invalid reference scope.'; end if;
  if p_reference_scope = 'items' and exists(select 1 from unnest(p_request_item_ids) item_id where not exists(select 1 from public.designer_request_items i where i.id = item_id and i.request_id = r.id)) then raise exception 'Reference items must belong to this request.'; end if;
  insert into public.designer_request_reference_attachments(request_id,storage_path,original_name,content_type,size_bytes,reference_scope,request_item_ids,created_by) values(p_request_id,p_storage_path,left(nullif(btrim(p_original_name),''),255),p_content_type,p_size_bytes,p_reference_scope,coalesce(p_request_item_ids,'{}'),auth.uid()) returning * into result;
  update public.designer_requests set reference_material_status = 'provided' where id = r.id;
  return result;
end $$;

create or replace function public.delete_designer_request_reference_attachment(p_attachment_id uuid) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.designer_request_reference_attachments; r public.designer_requests;
begin
  select * into a from public.designer_request_reference_attachments where id = p_attachment_id for update;
  select * into r from public.designer_requests where id = a.request_id for update;
  if a.id is null or r.agent_profile_id <> auth.uid() or r.status <> 'unclaimed' then raise exception 'Reference cannot be removed.'; end if;
  delete from public.designer_request_reference_attachments where id = a.id;
  return a.storage_path;
end $$;

create or replace function public.update_designer_request_reference_note(p_request_id uuid, p_reference_note text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.designer_requests set reference_note = nullif(btrim(p_reference_note),'') where id = p_request_id and agent_profile_id = auth.uid();
  if not found then raise exception 'Reference note update denied.'; end if;
end $$;

revoke all on function public.designer_reference_path_is_registered(text), public.can_read_designer_reference_object(text), public.can_delete_designer_reference_object(text), public.create_designer_request_reference_attachment(uuid,text,text,text,bigint,text,uuid[]), public.delete_designer_request_reference_attachment(uuid), public.update_designer_request_reference_note(uuid,text) from public, anon;
grant execute on function public.can_read_designer_reference_object(text), public.can_delete_designer_reference_object(text), public.create_designer_request_reference_attachment(uuid,text,text,text,bigint,text,uuid[]), public.delete_designer_request_reference_attachment(uuid), public.update_designer_request_reference_note(uuid,text) to authenticated;
commit;
