-- REVIEW CANDIDATE ONLY. NOT APPROVED FOR DEPLOYMENT.
-- IMG-2B: management reads only registered, submitted legacy design deliverables.
-- Preconditions: verify the current Production definitions of
-- current_user_can_view_management_designer_request(uuid) and Storage SELECT
-- policies before applying. This migration adds no upload, update, or delete access.

begin;

create or replace function public.list_management_designer_submitted_deliverables()
returns table (
  id uuid,
  request_id uuid,
  stage_id uuid,
  request_item_id uuid,
  storage_path text,
  original_name text,
  content_type text,
  size_bytes bigint,
  submission_id uuid,
  version_number integer,
  created_at timestamptz,
  submitted_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    d.id, d.request_id, d.stage_id, d.request_item_id,
    d.storage_path, d.original_name, d.content_type, d.size_bytes,
    d.submission_id, submission.version_number, d.created_at, submission.submitted_at
  from public.designer_stage_deliverables d
  join public.designer_stage_deliverable_submissions submission
    on submission.id = d.submission_id
   and submission.request_id = d.request_id
   and submission.stage_id = d.stage_id
  join public.designer_request_stages stage
    on stage.id = d.stage_id
   and stage.request_id = d.request_id
  where auth.uid() is not null
    and d.submission_id is not null
    and d.delete_requested_at is null
    and d.request_item_id is null
    and stage.request_item_id is null
    and stage.stage_type = 'design'
    and not exists (
      select 1 from public.designer_request_items item
      where item.request_id = d.request_id
    )
    and public.current_user_can_view_management_designer_request(d.request_id)
  order by d.request_id, submission.version_number desc, d.created_at asc;
$$;

create or replace function public.current_user_can_read_management_designer_deliverable_object(
  p_storage_path text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.designer_stage_deliverables d
    join public.designer_stage_deliverable_submissions submission
      on submission.id = d.submission_id
     and submission.request_id = d.request_id
     and submission.stage_id = d.stage_id
    join public.designer_request_stages stage
      on stage.id = d.stage_id
     and stage.request_id = d.request_id
    where d.storage_path = p_storage_path
      and d.submission_id is not null
      and d.delete_requested_at is null
      and d.request_item_id is null
      and stage.request_item_id is null
      and stage.stage_type = 'design'
      and not exists (
        select 1 from public.designer_request_items item
        where item.request_id = d.request_id
      )
      and public.current_user_can_view_management_designer_request(d.request_id)
  );
$$;

create policy "Designer management reads scoped submitted deliverable objects"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'designer-stage-deliverables'
  and public.current_user_can_read_management_designer_deliverable_object(storage.objects.name)
);

revoke all on function public.list_management_designer_submitted_deliverables()
  from public, anon;
revoke all on function public.current_user_can_read_management_designer_deliverable_object(text)
  from public, anon;

grant execute on function public.list_management_designer_submitted_deliverables()
  to authenticated;
grant execute on function public.current_user_can_read_management_designer_deliverable_object(text)
  to authenticated;

commit;
