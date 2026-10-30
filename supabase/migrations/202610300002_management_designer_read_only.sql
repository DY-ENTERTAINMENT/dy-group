begin;

-- Phase 2: read-only management access for existing designer requests.
-- This migration is intentionally additive: no workflow RPC, request state, or existing
-- participant RLS policy is replaced.

insert into public.permission_items (
  permission_key, parent_key, name, sort_order, is_active, is_reserved
)
values ('management-designer', null, '美工管理', 999, true, false)
on conflict (permission_key) do update
set parent_key = null,
    name = excluded.name,
    sort_order = excluded.sort_order,
    is_active = true,
    is_reserved = false,
    updated_at = now();

-- Deliberately separate from can_access_designer_request(): that existing helper is used
-- by workflow participants and must not gain management semantics.
create or replace function public.current_user_can_view_management_designer_request(
  p_request_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.designer_requests r
    where r.id = p_request_id
      and (
        public.current_user_is_super_admin()
        or (
          public.current_user_has_explicit_permission('management-designer', 'view')
          and r.region_id is not null
          and public.current_user_can_access_region(r.region_id)
        )
      )
  );
$$;

-- No arguments means the caller cannot ask this RPC to bypass its region scope.
-- Output is shaped to the existing DesignerManagementPage/DesignerRequest service.
-- Legacy requests (with no items) and multi-item requests are both represented.
create or replace function public.list_management_designer_requests()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'requests',
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'creator_profile_id', r.creator_profile_id,
          'request_type', r.request_type::text,
          'task_type', r.task_type,
          'other_design_type', r.other_design_type,
          'work_mode', r.work_mode::text,
          'status', r.status::text,
          'creator_name', r.creator_name,
          'platform_user_id', r.platform_user_id,
          'platform_account', r.platform_account,
          'event_start_at', r.event_start_at,
          'event_end_at', r.event_end_at,
          'design_content', r.design_content,
          'special_content', r.special_content,
          'style', r.style,
          'color', r.color,
          'specification', r.specification,
          'live_room', r.live_room,
          'reference_material_status', r.reference_material_status,
          'reference_note', r.reference_note,
          'reference_urls', '[]'::jsonb,
          'design_urls', '[]'::jsonb,
          'created_at', r.created_at,
          'applicant', jsonb_build_object('full_name', applicant.full_name, 'nickname', applicant.nickname),
          'creator', jsonb_build_object('manager', jsonb_build_object('full_name', manager.full_name, 'nickname', manager.nickname)),
          'region', jsonb_build_object('name', region.name),
          'stages', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', s.id, 'request_item_id', s.request_item_id,
              'stage_type', s.stage_type::text, 'status', s.status::text,
              'assignee_profile_id', s.assignee_profile_id, 'assignee_employee_id', s.assignee_employee_id,
              'accepted_at', s.accepted_at, 'submitted_at', s.submitted_at, 'confirmed_at', s.confirmed_at,
              'feedback', s.feedback, 'feedback_count', s.feedback_count,
              'assignee', jsonb_build_object('full_name', assignee.full_name, 'nickname', assignee.nickname)
            ) order by s.created_at, s.id)
            from public.designer_request_stages s
            left join public.employees assignee on assignee.id = s.assignee_employee_id
            where s.request_id = r.id
          ), '[]'::jsonb),
          'request_items', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', i.id, 'item_type', i.item_type, 'item_name', i.item_name,
              'content', i.content, 'special_content', i.special_content,
              'style', i.style, 'color', i.color, 'specification', i.specification,
              'sort_order', i.sort_order
            ) order by i.sort_order, i.created_at, i.id)
            from public.designer_request_items i
            where i.request_id = r.id
          ), '[]'::jsonb),
          'reference_attachments', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', a.id, 'storage_path', a.storage_path, 'original_name', a.original_name,
              'content_type', a.content_type, 'size_bytes', a.size_bytes,
              'reference_scope', a.reference_scope, 'request_item_ids', a.request_item_ids,
              'created_at', a.created_at
            ) order by a.created_at, a.id)
            from public.designer_request_reference_attachments a
            where a.request_id = r.id
          ), '[]'::jsonb)
        ) order by r.created_at desc, r.id desc
      ) filter (where public.current_user_can_view_management_designer_request(r.id)),
      '[]'::jsonb
    )
  )
  from public.designer_requests r
  left join public.employees applicant on applicant.id = r.agent_employee_id
  left join public.creator_profiles creator on creator.id = r.creator_profile_id
  left join public.employees manager on manager.id = creator.manager_employee_id
  left join public.regions region on region.id = r.region_id;
$$;

-- SECURITY DEFINER is necessary here because the attachment metadata table's existing
-- SELECT policy intentionally remains limited to workflow participants.  The exact,
-- registered storage_path is looked up before the request scope check; a guessed path
-- therefore cannot pass this function.
create or replace function public.current_user_can_read_management_designer_reference_object(
  p_storage_path text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.designer_request_reference_attachments a
    where a.storage_path = p_storage_path
      and public.current_user_can_view_management_designer_request(a.request_id)
  );
$$;

-- The registered attachment row is the authoritative object-to-request mapping.
-- This policy grants no insert, update, or delete capability and does not trust a guessed path.
create policy "Designer management reads scoped registered reference objects"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'designer-request-references'
  and public.current_user_can_read_management_designer_reference_object(storage.objects.name)
);

revoke all on function public.current_user_can_view_management_designer_request(uuid) from public, anon;
revoke all on function public.current_user_can_read_management_designer_reference_object(text) from public, anon;
revoke all on function public.list_management_designer_requests() from public, anon;
grant execute on function public.current_user_can_view_management_designer_request(uuid) to authenticated;
grant execute on function public.current_user_can_read_management_designer_reference_object(text) to authenticated;
grant execute on function public.list_management_designer_requests() to authenticated;

commit;
