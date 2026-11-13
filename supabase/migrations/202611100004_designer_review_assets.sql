-- Default-denied upload and deletion RPCs. Not safe to deploy independently.
BEGIN;
CREATE FUNCTION public.create_designer_review_upload_session(
  p_upload_task_id uuid, p_request_id uuid, p_stage_id uuid, p_item_id uuid,
  p_storage_path text, p_original_name text, p_content_type text,
  p_size_bytes bigint, p_file_fingerprint text, p_last_modified bigint,
  p_expected_revision bigint
) RETURNS public.designer_stage_deliverable_upload_sessions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  r public.designer_requests;
  s public.designer_request_stages;
  state public.designer_review_stage_state;
  u public.designer_stage_deliverable_upload_sessions;
  binding public.designer_review_upload_bindings;
BEGIN
  IF auth.uid() IS NULL OR p_upload_task_id IS NULL OR p_request_id IS NULL OR p_stage_id IS NULL OR p_item_id IS NULL
     OR p_expected_revision IS NULL OR p_expected_revision < 0
     OR nullif(btrim(coalesce(p_original_name,'')), '') IS NULL
     OR nullif(btrim(coalesce(p_file_fingerprint,'')), '') IS NULL
     OR p_last_modified IS NULL OR p_last_modified < 0
     OR p_size_bytes IS NULL OR p_size_bytes <= 0 OR p_size_bytes > 52428800
     OR p_content_type IS NULL OR p_content_type NOT IN ('image/jpeg','image/png','image/webp')
     OR p_storage_path IS NULL
     OR p_storage_path !~ ('^'||auth.uid()::text||'/'||p_stage_id::text||'/'||
       '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'||'[.](jpg|jpeg|png|webp)$')
     OR (p_content_type = 'image/jpeg' AND p_storage_path !~ '[.](jpg|jpeg)$')
     OR (p_content_type = 'image/png' AND p_storage_path !~ '[.]png$')
     OR (p_content_type = 'image/webp' AND p_storage_path !~ '[.]webp$')
  THEN RAISE EXCEPTION 'Invalid upload session'; END IF;

  SELECT * INTO r FROM public.designer_requests WHERE id = p_request_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;
  SELECT * INTO s FROM public.designer_request_stages WHERE id = p_stage_id FOR UPDATE;
  SELECT * INTO state FROM public.designer_review_stage_state WHERE stage_id = p_stage_id FOR UPDATE;
  IF s.id IS NULL OR state.stage_id IS NULL OR s.request_id IS DISTINCT FROM r.id
     OR state.request_id IS DISTINCT FROM r.id OR state.item_id IS DISTINCT FROM s.request_item_id
     OR s.stage_type <> 'design' OR s.assignee_profile_id IS DISTINCT FROM auth.uid()
     OR s.request_item_id IS DISTINCT FROM p_item_id OR NOT EXISTS (SELECT 1 FROM public.designer_request_items i
          WHERE i.id = s.request_item_id AND i.request_id = r.id)
     OR r.deleted_at IS NOT NULL
  THEN RAISE EXCEPTION 'Upload session denied'; END IF;

  SELECT * INTO u FROM public.designer_stage_deliverable_upload_sessions
    WHERE upload_task_id = p_upload_task_id FOR UPDATE;
  IF u.upload_task_id IS NOT NULL THEN
    SELECT * INTO binding FROM public.designer_review_upload_bindings
      WHERE upload_task_id = p_upload_task_id FOR UPDATE;
    IF binding.upload_task_id IS NULL OR binding.stage_id IS DISTINCT FROM s.id
       OR binding.expected_revision IS DISTINCT FROM p_expected_revision
       OR u.uploaded_by IS DISTINCT FROM auth.uid() OR u.request_id IS DISTINCT FROM r.id
       OR u.stage_id IS DISTINCT FROM s.id OR u.storage_path IS DISTINCT FROM p_storage_path
       OR u.original_name IS DISTINCT FROM left(btrim(p_original_name),255)
       OR u.content_type IS DISTINCT FROM p_content_type OR u.size_bytes IS DISTINCT FROM p_size_bytes
       OR u.file_fingerprint IS DISTINCT FROM p_file_fingerprint
       OR u.last_modified IS DISTINCT FROM p_last_modified
       OR (u.status <> 'consumed' AND (u.status NOT IN ('pending','uploading','uploaded') OR u.expires_at <= now()))
    THEN RAISE EXCEPTION 'Upload operation changed or requires cleanup'; END IF;
    RETURN u;
  END IF;

  IF NOT state.is_active OR r.status IN ('completed','cancelled') OR s.status NOT IN ('in_progress','revision')
     OR state.draft_revision IS DISTINCT FROM p_expected_revision
     OR state.pending_submission_id IS NOT NULL OR state.final_submission_id IS NOT NULL
  THEN RAISE EXCEPTION 'Review changed or upload denied'; END IF;
  INSERT INTO public.designer_stage_deliverable_upload_sessions
    (upload_task_id,uploaded_by,request_id,stage_id,storage_path,original_name,content_type,size_bytes,file_fingerprint,last_modified,status)
  VALUES (p_upload_task_id,auth.uid(),r.id,s.id,p_storage_path,left(btrim(p_original_name),255),
    p_content_type,p_size_bytes,p_file_fingerprint,p_last_modified,'pending') RETURNING * INTO u;
  INSERT INTO public.designer_review_upload_bindings(upload_task_id,stage_id,expected_revision)
    VALUES (u.upload_task_id,s.id,p_expected_revision);
  RETURN u;
END;
$function$;

CREATE FUNCTION public.register_designer_review_upload(
  p_upload_task_id uuid, p_expected_revision bigint
) RETURNS public.designer_stage_deliverables
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  u public.designer_stage_deliverable_upload_sessions;
  binding public.designer_review_upload_bindings;
  r public.designer_requests;
  s public.designer_request_stages;
  state public.designer_review_stage_state;
  result public.designer_stage_deliverables;
  obj storage.objects;
BEGIN
  IF auth.uid() IS NULL OR p_upload_task_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision < 0
  THEN RAISE EXCEPTION 'Invalid registration request'; END IF;
  -- Unlocked lookup only obtains identifiers. Re-read the session under lock.
  SELECT * INTO u FROM public.designer_stage_deliverable_upload_sessions WHERE upload_task_id = p_upload_task_id;
  IF u.upload_task_id IS NULL OR u.uploaded_by IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Upload denied'; END IF;
  SELECT * INTO r FROM public.designer_requests WHERE id = u.request_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;
  SELECT * INTO s FROM public.designer_request_stages WHERE id = u.stage_id FOR UPDATE;
  SELECT * INTO state FROM public.designer_review_stage_state WHERE stage_id = u.stage_id FOR UPDATE;
  SELECT * INTO u FROM public.designer_stage_deliverable_upload_sessions WHERE upload_task_id = p_upload_task_id FOR UPDATE;
  SELECT * INTO binding FROM public.designer_review_upload_bindings WHERE upload_task_id = p_upload_task_id FOR UPDATE;
  IF u.upload_task_id IS NULL OR s.id IS NULL OR state.stage_id IS NULL OR binding.upload_task_id IS NULL
     OR u.uploaded_by IS DISTINCT FROM auth.uid() OR s.assignee_profile_id IS DISTINCT FROM auth.uid()
     OR u.request_id IS DISTINCT FROM r.id OR u.stage_id IS DISTINCT FROM s.id
     OR s.request_id IS DISTINCT FROM r.id OR state.request_id IS DISTINCT FROM r.id
     OR state.item_id IS DISTINCT FROM s.request_item_id OR binding.stage_id IS DISTINCT FROM s.id
     OR binding.expected_revision IS DISTINCT FROM p_expected_revision
     OR s.stage_type <> 'design' OR r.deleted_at IS NOT NULL
     OR s.request_item_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.designer_request_items i
          WHERE i.id = s.request_item_id AND i.request_id = r.id)
  THEN RAISE EXCEPTION 'Upload registration denied'; END IF;

  IF u.status = 'consumed' THEN
    SELECT d.* INTO result FROM public.designer_stage_deliverables d
      JOIN public.designer_review_current_assets a ON a.deliverable_id = d.id AND a.stage_id = s.id
      WHERE d.id = binding.deliverable_id AND d.stage_id = s.id AND d.request_id = r.id
        AND d.request_item_id IS NOT DISTINCT FROM s.request_item_id
        AND d.uploaded_by = auth.uid() AND d.delete_requested_at IS NULL
        AND a.review_owned AND a.removed_at IS NULL;
    IF result.id IS NULL THEN RAISE EXCEPTION 'Registered image no longer exists or is not current'; END IF;
    RETURN result;
  END IF;

  IF NOT state.is_active OR r.status IN ('completed','cancelled') OR s.status NOT IN ('in_progress','revision')
     OR state.draft_revision IS DISTINCT FROM p_expected_revision
     OR state.pending_submission_id IS NOT NULL OR state.final_submission_id IS NOT NULL
     OR u.status NOT IN ('pending','uploading','uploaded') OR u.expires_at <= now()
  THEN RAISE EXCEPTION 'Review changed or upload requires cleanup'; END IF;
  SELECT * INTO obj FROM storage.objects
    WHERE bucket_id = 'designer-stage-deliverables' AND name = u.storage_path;
  IF obj.id IS NULL OR coalesce((obj.metadata->>'size')::bigint,-1) <> u.size_bytes
     OR coalesce(obj.metadata->>'mimetype','') <> u.content_type
  THEN RAISE EXCEPTION 'Uploaded object metadata mismatch'; END IF;

  INSERT INTO public.designer_stage_deliverables
    (request_id,stage_id,request_item_id,storage_path,original_name,content_type,size_bytes,uploaded_by)
  VALUES (r.id,s.id,s.request_item_id,u.storage_path,u.original_name,u.content_type,u.size_bytes,auth.uid())
  RETURNING * INTO result;
  INSERT INTO public.designer_review_current_assets(stage_id,deliverable_id,review_owned)
    VALUES (s.id,result.id,true);
  UPDATE public.designer_review_upload_bindings SET deliverable_id = result.id WHERE upload_task_id = u.upload_task_id;
  UPDATE public.designer_stage_deliverable_upload_sessions SET status = 'consumed', updated_at = now()
    WHERE upload_task_id = u.upload_task_id;
  UPDATE public.designer_review_stage_state SET draft_revision = draft_revision + 1, updated_at = now()
    WHERE stage_id = s.id;
  RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_designer_review_upload_session(uuid,uuid,uuid,uuid,text,text,text,bigint,text,bigint,bigint),
  public.register_designer_review_upload(uuid,bigint)
  FROM PUBLIC, anon, authenticated, service_role;

-- Existing create/register and cleanup APIs still need opt-in guards and a
-- reviewed lock-order/activation plan. A stale upload requires explicit cleanup.
-- No EXECUTE grants; do not deploy this file or use it against production.

-- Permanent-deletion RPCs are excluded from this release.
COMMIT;
