-- Read endpoint only. No client EXECUTE grant or protocol activation.
-- Depends on 202611100001; do not deploy independently.
BEGIN;

CREATE FUNCTION public.read_designer_review_current(p_request_id uuid, p_stage_id uuid, p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  r public.designer_requests;
  s public.designer_request_stages;
  state public.designer_review_stage_state;
  images jsonb;
  submitted_note text;
BEGIN
  IF auth.uid() IS NULL OR p_request_id IS NULL OR p_stage_id IS NULL OR p_item_id IS NULL THEN
    RAISE EXCEPTION 'Invalid review request';
  END IF;
  SELECT * INTO r FROM public.designer_requests WHERE id = p_request_id FOR SHARE;
  SELECT * INTO s FROM public.designer_request_stages WHERE id = p_stage_id FOR SHARE;
  SELECT * INTO state FROM public.designer_review_stage_state WHERE stage_id = p_stage_id FOR SHARE;
  IF r.id IS NULL OR r.deleted_at IS NOT NULL OR s.id IS NULL OR state.stage_id IS NULL
     OR s.request_id IS DISTINCT FROM r.id OR state.request_id IS DISTINCT FROM r.id
     OR s.stage_type <> 'design' OR s.request_item_id IS DISTINCT FROM p_item_id
     OR state.item_id IS DISTINCT FROM p_item_id
     OR NOT EXISTS (SELECT 1 FROM public.designer_request_items i WHERE i.id = p_item_id AND i.request_id = r.id)
     OR (r.agent_profile_id IS DISTINCT FROM auth.uid() AND s.assignee_profile_id IS DISTINCT FROM auth.uid())
  THEN RAISE EXCEPTION 'Review unavailable or access denied'; END IF;

  -- Agents see the last submitted snapshot; designers see their current draft.
  IF r.agent_profile_id = auth.uid() AND s.assignee_profile_id IS DISTINCT FROM auth.uid() THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id,'originalName',d.original_name,
      'contentType',d.content_type,'sizeBytes',d.size_bytes,'storagePath',d.storage_path)
      ORDER BY d.created_at,d.id),'[]'::jsonb) INTO images
    FROM public.designer_review_submission_assets membership
    JOIN public.designer_review_current_assets a ON a.stage_id=membership.stage_id AND a.deliverable_id=membership.deliverable_id
    JOIN public.designer_stage_deliverables d ON d.id=a.deliverable_id
    WHERE membership.stage_id=s.id AND membership.submission_id=(SELECT e.submission_id
      FROM public.designer_review_events e WHERE e.stage_id=s.id AND e.event_type='submit'
      ORDER BY e.created_at DESC,e.id DESC LIMIT 1)
      AND a.removed_at IS NULL
      AND d.request_id=r.id AND d.stage_id=s.id AND d.request_item_id=p_item_id AND d.delete_requested_at IS NULL;
  ELSE
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id,'originalName',d.original_name,
      'contentType',d.content_type,'sizeBytes',d.size_bytes,'storagePath',d.storage_path)
      ORDER BY d.created_at,d.id),'[]'::jsonb) INTO images
    FROM public.designer_review_current_assets a JOIN public.designer_stage_deliverables d ON d.id=a.deliverable_id
    WHERE a.stage_id=s.id AND a.removed_at IS NULL
      AND d.request_id=r.id AND d.stage_id=s.id AND d.request_item_id=p_item_id AND d.delete_requested_at IS NULL;
  END IF;
  SELECT e.note INTO submitted_note FROM public.designer_review_events e
  WHERE e.stage_id = s.id AND e.event_type = 'submit'
  ORDER BY e.created_at DESC, e.id DESC LIMIT 1;
  RETURN jsonb_build_object('key', jsonb_build_object('requestId', r.id, 'stageId', s.id, 'itemId', s.request_item_id),
    'status', s.status, 'draftRevision', state.draft_revision,
    'pendingSubmissionId', state.pending_submission_id, 'finalSubmissionId', state.final_submission_id,
    'images', images, 'submittedNote', submitted_note, 'latestFeedback', s.feedback,
    'feedbackCount', s.feedback_count);
END;
$function$;
REVOKE ALL ON FUNCTION public.read_designer_review_current(uuid,uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
