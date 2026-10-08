begin;

-- Outgoing evidence is an additive, post-start attachment record.  It never
-- participates in approval, attendance, or the outgoing lifecycle itself.
create table public.outgoing_request_evidence (
  id uuid primary key default gen_random_uuid(),
  outgoing_request_id uuid not null references public.outgoing_requests(id) on delete restrict,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  photo_path text not null unique,
  created_at timestamptz not null default now()
);

create index outgoing_request_evidence_request_created_idx
  on public.outgoing_request_evidence(outgoing_request_id, created_at);
create index outgoing_request_evidence_profile_created_idx
  on public.outgoing_request_evidence(profile_id, created_at);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'outgoing-evidence',
  'outgoing-evidence',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[];

alter table public.outgoing_request_evidence enable row level security;
revoke all on table public.outgoing_request_evidence from public, anon, authenticated;

create or replace function public.outgoing_evidence_path_is_registered(p_photo_path text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.outgoing_request_evidence evidence
    where evidence.photo_path = p_photo_path
  )
$$;

create policy "Active employees can upload started outgoing evidence"
on storage.objects for insert to authenticated with check (
  bucket_id = 'outgoing-evidence'
  and public.current_user_is_active_employee()
  and array_length(storage.foldername(name), 1) = 3
  and (storage.foldername(name))[1] = auth.uid()::text
  and (storage.foldername(name))[3] = 'evidence'
  and lower(name) ~ '\\.(jpg|jpeg|png|webp)$'
  and exists (
    select 1
    from public.outgoing_requests request_row
    join public.outgoing_events event_row on event_row.request_id = request_row.id
    where request_row.id::text = (storage.foldername(name))[2]
      and request_row.profile_id = auth.uid()
      and event_row.started_at is not null
  )
);

create policy "Employees can read own registered outgoing evidence"
on storage.objects for select to authenticated using (
  bucket_id = 'outgoing-evidence'
  and public.current_user_is_active_employee()
  and (storage.foldername(name))[1] = auth.uid()::text
  and public.outgoing_evidence_path_is_registered(name)
);

create policy "Outgoing managers can read scoped registered evidence"
on storage.objects for select to authenticated using (
  bucket_id = 'outgoing-evidence'
  and public.current_user_has_permission('outgoing-management', 'view')
  and public.current_user_has_explicit_permission('outgoing-photos', 'view')
  and public.outgoing_evidence_path_is_registered(name)
  and exists (
    select 1
    from public.outgoing_requests request_row
    join public.outgoing_events event_row on event_row.request_id = request_row.id
    where request_row.id::text = (storage.foldername(name))[2]
      and event_row.started_at is not null
      and public.current_user_can_access_region(request_row.region_id)
  )
);

create or replace function public.create_outgoing_request_evidence(
  p_request_id uuid,
  p_photo_path text
)
returns public.outgoing_request_evidence
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  request_row public.outgoing_requests;
  evidence_row public.outgoing_request_evidence;
  path_parts text[];
begin
  if auth.uid() is null or not public.current_user_is_active_employee() then
    raise exception 'No active employee session.';
  end if;

  select * into request_row
  from public.outgoing_requests
  where id = p_request_id
  for update;

  if request_row.id is null or request_row.profile_id <> auth.uid() then
    raise exception 'Outgoing request not found.';
  end if;
  if not exists (
    select 1 from public.outgoing_events event_row
    where event_row.request_id = request_row.id
      and event_row.started_at is not null
  ) then
    raise exception 'Outgoing evidence is available only after outgoing has started.';
  end if;

  path_parts := string_to_array(coalesce(p_photo_path, ''), '/');
  if array_length(path_parts, 1) <> 4
    or path_parts[1] <> auth.uid()::text
    or path_parts[2] <> request_row.id::text
    or path_parts[3] <> 'evidence'
    or nullif(btrim(path_parts[4]), '') is null
    or lower(path_parts[4]) !~ '^[0-9a-f-]+\\.(jpg|jpeg|png|webp)$' then
    raise exception 'Outgoing evidence path is invalid.';
  end if;

  if not exists (
    select 1 from storage.objects object_row
    where object_row.bucket_id = 'outgoing-evidence'
      and object_row.name = p_photo_path
  ) then
    raise exception 'Outgoing evidence photo was not uploaded.';
  end if;
  if exists (select 1 from public.outgoing_request_evidence where photo_path = p_photo_path) then
    raise exception 'Outgoing evidence photo is already registered.';
  end if;

  insert into public.outgoing_request_evidence(outgoing_request_id, profile_id, photo_path)
  values (request_row.id, auth.uid(), p_photo_path)
  returning * into evidence_row;
  return evidence_row;
end;
$$;

create or replace function public.list_my_outgoing_request_evidence(p_request_id uuid)
returns setof public.outgoing_request_evidence
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select evidence.*
  from public.outgoing_request_evidence evidence
  join public.outgoing_requests request_row on request_row.id = evidence.outgoing_request_id
  where evidence.outgoing_request_id = p_request_id
    and evidence.profile_id = auth.uid()
    and request_row.profile_id = auth.uid()
    and public.current_user_is_active_employee()
  order by evidence.created_at asc
$$;

create or replace function public.list_managed_outgoing_request_evidence(p_request_id uuid)
returns setof public.outgoing_request_evidence
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select evidence.*
  from public.outgoing_request_evidence evidence
  join public.outgoing_requests request_row on request_row.id = evidence.outgoing_request_id
  where evidence.outgoing_request_id = p_request_id
    and public.current_user_has_permission('outgoing-management', 'view')
    and public.current_user_can_access_region(request_row.region_id)
  order by evidence.created_at asc
$$;

revoke all on function public.outgoing_evidence_path_is_registered(text) from public, anon;
revoke all on function public.create_outgoing_request_evidence(uuid, text) from public, anon;
revoke all on function public.list_my_outgoing_request_evidence(uuid) from public, anon;
revoke all on function public.list_managed_outgoing_request_evidence(uuid) from public, anon;
grant execute on function public.outgoing_evidence_path_is_registered(text) to authenticated;
grant execute on function public.create_outgoing_request_evidence(uuid, text) to authenticated;
grant execute on function public.list_my_outgoing_request_evidence(uuid) to authenticated;
grant execute on function public.list_managed_outgoing_request_evidence(uuid) to authenticated;

commit;
