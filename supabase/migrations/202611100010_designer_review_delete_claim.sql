-- Logical removal only. No physical Storage deletion.
BEGIN;
CREATE FUNCTION public.remove_designer_review_image(
 p_request_id uuid, p_stage_id uuid, p_item_id uuid, p_deliverable_id uuid,
 p_expected_revision bigint, p_operation_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE r public.designer_requests; s public.designer_request_stages;
 st public.designer_review_stage_state; a public.designer_review_current_assets;
 d public.designer_stage_deliverables;
BEGIN
 IF auth.uid() IS NULL OR p_request_id IS NULL OR p_stage_id IS NULL OR p_item_id IS NULL
 OR p_deliverable_id IS NULL OR p_operation_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision < 0
 THEN RAISE EXCEPTION 'Invalid removal request'; END IF;
 -- Locks match submission: Request, Stage, then review state.
 SELECT * INTO r FROM public.designer_requests WHERE id=p_request_id FOR UPDATE;
 SELECT * INTO s FROM public.designer_request_stages WHERE id=p_stage_id FOR UPDATE;
 SELECT * INTO st FROM public.designer_review_stage_state WHERE stage_id=p_stage_id FOR UPDATE;
 IF r.id IS NULL OR r.deleted_at IS NOT NULL OR s.id IS NULL OR st.stage_id IS NULL
 OR s.request_id IS DISTINCT FROM r.id OR st.request_id IS DISTINCT FROM r.id
 OR s.request_item_id IS DISTINCT FROM p_item_id OR st.item_id IS DISTINCT FROM p_item_id
 OR s.stage_type <> 'design' OR s.assignee_profile_id IS DISTINCT FROM auth.uid()
 OR NOT EXISTS (SELECT 1 FROM public.designer_request_items i WHERE i.id=p_item_id AND i.request_id=r.id)
 THEN RAISE EXCEPTION 'Removal denied'; END IF;
 SELECT * INTO a FROM public.designer_review_current_assets WHERE stage_id=s.id AND deliverable_id=p_deliverable_id FOR UPDATE;
 SELECT * INTO d FROM public.designer_stage_deliverables WHERE id=p_deliverable_id FOR UPDATE;
 IF a.deliverable_id IS NULL OR d.id IS NULL OR NOT a.review_owned
 OR d.request_id IS DISTINCT FROM r.id OR d.stage_id IS DISTINCT FROM s.id
 OR d.request_item_id IS DISTINCT FROM p_item_id OR d.delete_requested_at IS NOT NULL
 THEN RAISE EXCEPTION 'Image is protected or unavailable'; END IF;
 IF a.removed_at IS NOT NULL THEN
   IF a.removed_by=auth.uid() AND a.removal_operation_id=p_operation_id
   AND a.removal_expected_revision=p_expected_revision THEN RETURN; END IF;
   RAISE EXCEPTION 'Image already removed';
 END IF;
 IF EXISTS (SELECT 1 FROM public.designer_review_current_assets x WHERE x.removed_by=auth.uid() AND x.removal_operation_id=p_operation_id)
 THEN RAISE EXCEPTION 'Removal operation already used'; END IF;
 IF NOT st.is_active OR r.status IN ('completed','cancelled') OR s.status NOT IN ('in_progress','revision')
 OR st.pending_submission_id IS NOT NULL OR st.final_submission_id IS NOT NULL
 OR st.draft_revision IS DISTINCT FROM p_expected_revision
 OR EXISTS (SELECT 1 FROM public.designer_review_stage_state f WHERE f.final_submission_id IS NOT NULL AND f.final_submission_id=d.submission_id)
 THEN RAISE EXCEPTION 'Review changed or image is protected'; END IF;
 UPDATE public.designer_review_current_assets SET removed_at=now(), removed_by=auth.uid(),
 removal_operation_id=p_operation_id, removal_expected_revision=p_expected_revision
 WHERE stage_id=s.id AND deliverable_id=d.id;
 UPDATE public.designer_review_stage_state SET draft_revision=draft_revision+1, updated_at=now() WHERE stage_id=s.id;
END;
$function$;
REVOKE ALL ON FUNCTION public.remove_designer_review_image(uuid,uuid,uuid,uuid,bigint,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.remove_designer_review_image(uuid,uuid,uuid,uuid,bigint,uuid) TO authenticated;
CREATE UNIQUE INDEX designer_review_removal_operation_unique ON public.designer_review_current_assets(removed_by,removal_operation_id) WHERE removal_operation_id IS NOT NULL;
-- Read-only, administrator-run inventory. References are conservative.
CREATE VIEW public.designer_review_removed_inventory AS
 SELECT d.id AS image_id, d.request_id, d.request_item_id AS item_id, d.stage_id,
 'designer-stage-deliverables'::text AS storage_bucket, d.storage_path, a.removed_at,
 EXISTS (SELECT 1 FROM public.designer_review_current_assets active
 JOIN public.designer_stage_deliverables od ON od.id=active.deliverable_id
 WHERE od.storage_path=d.storage_path AND active.removed_at IS NULL)
 OR EXISTS (SELECT 1 FROM public.designer_stage_deliverables od WHERE od.storage_path=d.storage_path AND od.id<>d.id)
 OR d.submission_id IS NOT NULL
 OR EXISTS (SELECT 1 FROM public.designer_review_stage_state st WHERE st.final_submission_id IS NOT NULL AND st.final_submission_id=d.submission_id) AS has_active_reference
 FROM public.designer_review_current_assets a JOIN public.designer_stage_deliverables d ON d.id=a.deliverable_id
 WHERE a.removed_at IS NOT NULL;
REVOKE ALL ON public.designer_review_removed_inventory FROM PUBLIC, anon, authenticated, service_role;
DO $preflight$
BEGIN
 IF to_regprocedure('public.list_designer_stage_deliverables(uuid)') IS NULL OR md5(replace(pg_get_functiondef(to_regprocedure('public.list_designer_stage_deliverables(uuid)')), chr(13), '')) IS DISTINCT FROM 'e3fc5773d342a91bbcdf32612dd47b72' THEN RAISE EXCEPTION 'Production definition changed: list_designer_stage_deliverables'; END IF;
END $preflight$;
CREATE OR REPLACE FUNCTION public.list_designer_stage_deliverables(p_stage_id uuid)
 RETURNS TABLE(id uuid, request_id uuid, stage_id uuid, request_item_id uuid, storage_path text, original_name text, content_type text, size_bytes bigint, submission_id uuid, version_number integer, created_at timestamp with time zone, submitted_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select d.id,d.request_id,d.stage_id,d.request_item_id,d.storage_path,d.original_name,d.content_type,d.size_bytes,d.submission_id,v.version_number,d.created_at,v.submitted_at
  from public.designer_stage_deliverables d
  join public.designer_requests r on r.id=d.request_id and r.deleted_at is null
  left join public.designer_stage_deliverable_submissions v on v.id=d.submission_id
  where d.stage_id=p_stage_id and not exists (select 1 from public.designer_review_current_assets a where a.deliverable_id=d.id and a.removed_at is not null) and (
    (d.submission_id is not null and public.can_read_designer_stage_deliverable_submission(d.stage_id,d.request_id))
    or (d.submission_id is null and d.delete_requested_at is null and d.uploaded_by=auth.uid()
        and exists(select 1 from public.designer_request_stages s where s.id=d.stage_id and s.assignee_profile_id=auth.uid()))
  )
  order by v.version_number desc nulls last,d.created_at asc;
$function$;
COMMIT;
