begin;

drop policy "Active employees can upload started outgoing evidence" on storage.objects;

create policy "Active employees can upload started outgoing evidence"
on storage.objects for insert to authenticated with check (
  bucket_id = 'outgoing-evidence'
  and public.current_user_is_active_employee()
  and array_length(storage.foldername(name), 1) = 3
  and (storage.foldername(name))[1] = auth.uid()::text
  and (storage.foldername(name))[3] = 'evidence'
  and lower(name) ~ '[.](jpg|jpeg|png|webp)$'
  and exists (
    select 1
    from public.outgoing_requests request_row
    join public.outgoing_events event_row on event_row.request_id = request_row.id
    where request_row.id::text = (storage.foldername(name))[2]
      and request_row.profile_id = auth.uid()
      and event_row.started_at is not null
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
    or lower(path_parts[4]) !~ '^[0-9a-f-]+[.](jpg|jpeg|png|webp)$' then
    raise exception 'Outgoing evidence path is invalid.';
  end if;

  if not exists (
    select 1
    from storage.objects object_row
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

commit;
