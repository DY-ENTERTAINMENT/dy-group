-- Fail-closed protection for new-protocol objects. This does not authorize
-- deletion of registered images; a separately reviewed policy is still needed.
BEGIN;
CREATE FUNCTION public.designer_review_storage_delete_guard(p_bucket text, p_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
  SELECT CASE
    WHEN p_bucket IS DISTINCT FROM 'designer-stage-deliverables' THEN true
    WHEN auth.uid() IS NULL OR p_path IS NULL THEN false
    WHEN EXISTS (
      SELECT 1 FROM public.designer_stage_deliverables d
      JOIN public.designer_review_stage_state st ON st.stage_id = d.stage_id
      WHERE d.storage_path = p_path
    ) THEN false
    WHEN EXISTS (
      SELECT 1 FROM public.designer_stage_deliverable_upload_sessions u
      JOIN public.designer_review_upload_bindings b ON b.upload_task_id = u.upload_task_id
      WHERE u.storage_path = p_path
    ) THEN false
    ELSE true
  END;
$function$;
REVOKE ALL ON FUNCTION public.designer_review_storage_delete_guard(text,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.designer_review_storage_delete_guard(text,text) TO authenticated;
CREATE POLICY "Review asset delete restrictive guard" ON storage.objects
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.designer_review_storage_delete_guard(bucket_id, name));

CREATE FUNCTION public.designer_review_storage_insert_guard(p_bucket text, p_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
  SELECT CASE
    WHEN p_bucket IS DISTINCT FROM 'designer-stage-deliverables' THEN true
    WHEN auth.uid() IS NULL OR p_path IS NULL THEN false
    WHEN NOT EXISTS (
      SELECT 1 FROM public.designer_stage_deliverable_upload_sessions u
      JOIN public.designer_review_stage_state st ON st.stage_id = u.stage_id
      WHERE u.storage_path = p_path
    ) THEN true
    ELSE EXISTS (
      SELECT 1 FROM public.designer_stage_deliverable_upload_sessions u
      JOIN public.designer_review_upload_bindings b ON b.upload_task_id = u.upload_task_id AND b.stage_id = u.stage_id
      JOIN public.designer_review_stage_state st ON st.stage_id = u.stage_id
      JOIN public.designer_request_stages s ON s.id = st.stage_id AND s.request_id = st.request_id
      JOIN public.designer_requests r ON r.id = s.request_id
      JOIN public.designer_request_items i ON i.id = s.request_item_id AND i.request_id = r.id
      WHERE u.storage_path = p_path AND u.uploaded_by = auth.uid() AND s.assignee_profile_id = auth.uid()
        AND s.stage_type = 'design' AND s.status IN ('in_progress','revision')
        AND s.request_item_id = st.item_id AND u.request_id = r.id
        AND r.deleted_at IS NULL AND r.status NOT IN ('completed','cancelled')
        AND st.is_active AND st.pending_submission_id IS NULL AND st.final_submission_id IS NULL
        AND st.draft_revision = b.expected_revision
        AND u.status IN ('pending','uploading') AND u.expires_at > now()
    )
  END;
$function$;
REVOKE ALL ON FUNCTION public.designer_review_storage_insert_guard(text,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.designer_review_storage_insert_guard(text,text) TO authenticated;
CREATE POLICY "Review asset insert restrictive guard" ON storage.objects
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.designer_review_storage_insert_guard(bucket_id, name));

CREATE FUNCTION public.designer_review_storage_select_guard(p_bucket text, p_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $function$
 SELECT p_bucket IS DISTINCT FROM 'designer-stage-deliverables' OR NOT EXISTS (
  SELECT 1 FROM public.designer_review_current_assets a JOIN public.designer_stage_deliverables d ON d.id=a.deliverable_id
  WHERE d.storage_path=p_path AND a.removed_at IS NOT NULL
 ) OR EXISTS (
  SELECT 1 FROM public.designer_stage_deliverables d LEFT JOIN public.designer_review_current_assets a ON a.deliverable_id=d.id
  WHERE d.storage_path=p_path AND (a.deliverable_id IS NULL OR a.removed_at IS NULL)
 );
$function$;
REVOKE ALL ON FUNCTION public.designer_review_storage_select_guard(text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.designer_review_storage_select_guard(text,text) TO authenticated;
CREATE POLICY "Review removed asset select restrictive guard" ON storage.objects
 AS RESTRICTIVE FOR SELECT TO authenticated USING (public.designer_review_storage_select_guard(bucket_id,name));
COMMIT;
