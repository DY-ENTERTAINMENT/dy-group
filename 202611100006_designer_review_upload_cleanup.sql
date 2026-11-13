-- New-protocol upload cleanup request. No EXECUTE grants or activation.
BEGIN;
CREATE FUNCTION public.request_designer_review_upload_cleanup(
  p_upload_task_id uuid, p_request_id uuid, p_stage_id uuid, p_item_id uuid
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  r public.designer_requests;
  s public.designer_request_stages;
  state public.designer_review_stage_state;
  u public.designer_stage_deliverable_upload_sessions;
  binding public.designer_review_upload_bindings;
BEGIN
  IF auth.uid() IS NULL OR p_upload_task_id IS NULL OR p_request_id IS NULL
     OR p_stage_id IS NULL OR p_item_id IS NULL THEN RAISE EXCEPTION 'Invalid cleanup request'; END IF;
  SELECT * INTO r FROM public.designer_requests WHERE id = p_request_id FOR UPDATE;
  SELECT * INTO s FROM public.designer_request_stages WHERE id = p_stage_id FOR UPDATE;
  SELECT * INTO state FROM public.designer_review_stage_state WHERE stage_id = p_stage_id FOR UPDATE;
  SELECT * INTO u FROM public.designer_stage_deliverable_upload_sessions WHERE upload_task_id = p_upload_task_id FOR UPDATE;
  SELECT * INTO binding FROM public.designer_review_upload_bindings WHERE upload_task_id = p_upload_task_id FOR UPDATE;
  IF r.id IS NULL OR r.deleted_at IS NOT NULL OR s.id IS NULL OR state.stage_id IS NULL
     OR u.upload_task_id IS NULL OR binding.upload_task_id IS NULL
     OR s.request_id IS DISTINCT FROM r.id OR state.request_id IS DISTINCT FROM r.id
     OR state.item_id IS DISTINCT FROM p_item_id OR s.request_item_id IS DISTINCT FROM p_item_id
     OR NOT EXISTS (SELECT 1 FROM public.designer_request_items i WHERE i.id = p_item_id AND i.request_id = r.id)
     OR s.stage_type <> 'design' OR s.assignee_profile_id IS DISTINCT FROM auth.uid()
     OR u.uploaded_by IS DISTINCT FROM auth.uid() OR u.stage_id IS DISTINCT FROM s.id
     OR u.request_id IS DISTINCT FROM r.id OR binding.stage_id IS DISTINCT FROM s.id
     OR binding.deliverable_id IS NOT NULL OR u.status = 'consumed'
     OR EXISTS (SELECT 1 FROM public.designer_stage_deliverables d WHERE d.storage_path = u.storage_path)
  THEN RAISE EXCEPTION 'Upload cleanup denied'; END IF;
  IF u.status IN ('cleanup_requested','cleanup_failed') THEN RETURN NULL; END IF;
  IF u.status NOT IN ('pending','uploading','uploaded','expired','cancelled') THEN RAISE EXCEPTION 'Upload cannot be marked for cleanup'; END IF;
  UPDATE public.designer_stage_deliverable_upload_sessions SET status='cleanup_requested', cleanup_requested_at=coalesce(cleanup_requested_at,now()), cleanup_error='Awaiting manual review; object retained', updated_at=now() WHERE upload_task_id=u.upload_task_id;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.request_designer_review_upload_cleanup(uuid,uuid,uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
