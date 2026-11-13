-- Upload inspection for retry and cleanup; no permanent-deletion triggers.
BEGIN;

CREATE FUNCTION public.inspect_designer_review_upload(p_upload_task_id uuid, p_request_id uuid, p_stage_id uuid, p_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE u public.designer_stage_deliverable_upload_sessions; b public.designer_review_upload_bindings;
  s public.designer_request_stages; st public.designer_review_stage_state; r public.designer_requests;
BEGIN
  IF auth.uid() IS NULL OR p_upload_task_id IS NULL OR p_request_id IS NULL OR p_stage_id IS NULL OR p_item_id IS NULL
  THEN RAISE EXCEPTION 'Invalid upload inspection'; END IF;
  SELECT * INTO r FROM public.designer_requests WHERE id = p_request_id FOR SHARE;
  SELECT * INTO s FROM public.designer_request_stages WHERE id = p_stage_id FOR SHARE;
  SELECT * INTO st FROM public.designer_review_stage_state WHERE stage_id = p_stage_id FOR SHARE;
  IF r.id IS NULL OR r.deleted_at IS NOT NULL OR s.id IS NULL OR st.stage_id IS NULL
     OR s.request_id IS DISTINCT FROM r.id OR st.request_id IS DISTINCT FROM r.id
     OR s.request_item_id IS DISTINCT FROM p_item_id OR st.item_id IS DISTINCT FROM p_item_id
     OR s.stage_type <> 'design' OR s.assignee_profile_id IS DISTINCT FROM auth.uid()
     OR NOT EXISTS (SELECT 1 FROM public.designer_request_items i WHERE i.id = p_item_id AND i.request_id = r.id)
  THEN RAISE EXCEPTION 'Upload inspection denied'; END IF;
  SELECT * INTO u FROM public.designer_stage_deliverable_upload_sessions WHERE upload_task_id = p_upload_task_id FOR SHARE;
  IF u.upload_task_id IS NULL THEN RETURN jsonb_build_object('state','not_found'); END IF;
  SELECT * INTO b FROM public.designer_review_upload_bindings WHERE upload_task_id = p_upload_task_id FOR SHARE;
  IF b.upload_task_id IS NULL OR u.uploaded_by IS DISTINCT FROM auth.uid()
     OR u.request_id IS DISTINCT FROM r.id OR u.stage_id IS DISTINCT FROM s.id OR b.stage_id IS DISTINCT FROM s.id
  THEN RAISE EXCEPTION 'Upload inspection denied'; END IF;
  RETURN jsonb_build_object('state',u.status,'uploadTaskId',u.upload_task_id,'expectedRevision',b.expected_revision,
    'deliverableId',b.deliverable_id,'objectExists',EXISTS (SELECT 1 FROM storage.objects o
      WHERE o.bucket_id = 'designer-stage-deliverables' AND o.name = u.storage_path));
END;
$function$;
REVOKE ALL ON FUNCTION public.inspect_designer_review_upload(uuid,uuid,uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.inspect_designer_review_upload(uuid,uuid,uuid,uuid) TO authenticated;
COMMIT;
