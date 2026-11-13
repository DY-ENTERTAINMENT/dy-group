-- Default-denied new protocol transitions; not independently deployable or enabled.
BEGIN;
CREATE FUNCTION public.submit_designer_review_current_set(
  p_stage_id uuid,
  p_expected_revision bigint,
  p_note text,
  p_operation_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  s public.designer_request_stages;
  r public.designer_requests;
  state public.designer_review_stage_state;
  existing public.designer_review_events;
  sid uuid;
  next_version integer;
  affected integer;
  expected_count integer;
  normalized_note text := NULLIF(btrim(coalesce(p_note, '')), '');
BEGIN
  IF auth.uid() IS NULL OR p_stage_id IS NULL OR p_operation_id IS NULL
     OR p_expected_revision IS NULL OR p_expected_revision < 0
     OR length(coalesce(p_note, '')) > 2000
  THEN
    RAISE EXCEPTION 'Invalid review submission';
  END IF;

  -- Follow the Request -> Stage lock order of the real production RPC.
  SELECT * INTO s FROM public.designer_request_stages WHERE id = p_stage_id;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Stage not found'; END IF;
  SELECT * INTO r FROM public.designer_requests WHERE id = s.request_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;
  SELECT * INTO s FROM public.designer_request_stages WHERE id = p_stage_id FOR UPDATE;
  IF s.id IS NULL OR s.request_id IS DISTINCT FROM r.id THEN
    RAISE EXCEPTION 'Stage changed';
  END IF;
  SELECT * INTO state FROM public.designer_review_stage_state WHERE stage_id = s.id FOR UPDATE;
  IF state.stage_id IS NULL OR state.request_id IS DISTINCT FROM r.id
     OR state.item_id IS DISTINCT FROM s.request_item_id
     OR s.stage_type <> 'design'
     OR s.assignee_profile_id IS DISTINCT FROM auth.uid()
     OR r.deleted_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'Review submission denied';
  END IF;

  -- A retry is valid only for the same actor, revision and note. It returns the
  -- original ID instead of publishing a second submission after a timeout.
  SELECT * INTO existing FROM public.designer_review_events e
  WHERE e.stage_id = s.id AND e.event_type = 'submit' AND e.client_operation_id = p_operation_id;
  IF existing.id IS NOT NULL THEN
    IF existing.actor_profile_id IS DISTINCT FROM auth.uid()
       OR existing.expected_revision IS DISTINCT FROM p_expected_revision
       OR existing.note IS DISTINCT FROM normalized_note
       OR existing.submission_id IS NULL
    THEN
      RAISE EXCEPTION 'Idempotency key reused with different input';
    END IF;
    RETURN existing.submission_id;
  END IF;

  IF NOT state.is_active OR r.status IN ('completed', 'cancelled')
     OR s.status NOT IN ('in_progress', 'revision')
     OR state.draft_revision IS DISTINCT FROM p_expected_revision
     OR state.pending_submission_id IS NOT NULL
     OR state.final_submission_id IS NOT NULL
  THEN
    RAISE EXCEPTION 'Review stage or draft changed; refresh';
  END IF;

  -- Only a complete, non-empty current set may be submitted. Every mutation of
  -- that set and every delete prepare MUST lock the same stage/state first;
  -- those functions are not implemented in this candidate.
  IF NOT EXISTS (SELECT 1 FROM public.designer_review_current_assets a WHERE a.stage_id = s.id AND a.removed_at IS NULL)
     OR EXISTS (
       SELECT 1
       FROM public.designer_review_current_assets a
       LEFT JOIN public.designer_stage_deliverables d ON d.id = a.deliverable_id
       LEFT JOIN storage.objects o ON o.bucket_id = 'designer-stage-deliverables' AND o.name = d.storage_path
       WHERE a.stage_id = s.id AND a.removed_at IS NULL
         AND (d.id IS NULL OR d.stage_id IS DISTINCT FROM s.id
           OR d.request_id IS DISTINCT FROM r.id
           OR d.request_item_id IS DISTINCT FROM s.request_item_id
           OR d.delete_requested_at IS NOT NULL OR o.id IS NULL)
     )
  THEN
    RAISE EXCEPTION 'Current image set is empty, incomplete or being deleted';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.designer_stage_deliverable_upload_sessions u
    WHERE u.stage_id = s.id AND u.status IN ('pending','uploading','uploaded','registering')
  ) THEN
    RAISE EXCEPTION 'An upload is still pending';
  END IF;

  SELECT coalesce(max(v.version_number), 0) + 1 INTO next_version
  FROM public.designer_stage_deliverable_submissions v WHERE v.stage_id = s.id;
  INSERT INTO public.designer_stage_deliverable_submissions
    (request_id, stage_id, version_number, submitted_by)
  VALUES (r.id, s.id, next_version, auth.uid()) RETURNING id INTO sid;

  INSERT INTO public.designer_review_submission_assets (submission_id, stage_id, deliverable_id)
  SELECT sid, s.id, a.deliverable_id FROM public.designer_review_current_assets a
  WHERE a.stage_id = s.id AND a.removed_at IS NULL;

  -- CSV 80's existing Storage SELECT policy permits the applicant to read
  -- submitted objects only when the deliverable's submission_id is non-null.
  -- Rebind every member of this opted-in Stage's complete current set to the
  -- new submission for compatibility. Immutable snapshot rows above retain
  -- each submitted membership; non-opted-in historical stages are untouched.
  SELECT count(*) INTO expected_count FROM public.designer_review_current_assets a WHERE a.stage_id = s.id AND a.removed_at IS NULL;
  UPDATE public.designer_stage_deliverables d SET submission_id = sid
  FROM public.designer_review_current_assets a
  WHERE a.stage_id = s.id AND a.removed_at IS NULL AND a.deliverable_id = d.id
    AND d.stage_id = s.id AND d.request_id = r.id
    AND d.request_item_id IS NOT DISTINCT FROM s.request_item_id
    AND d.delete_requested_at IS NULL;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> expected_count OR affected < 1 THEN
    RAISE EXCEPTION 'Current image set changed during submission';
  END IF;

  INSERT INTO public.designer_review_events
    (stage_id, submission_id, actor_profile_id, event_type, client_operation_id, expected_revision, note)
  VALUES (s.id, sid, auth.uid(), 'submit', p_operation_id, p_expected_revision, normalized_note);
  UPDATE public.designer_review_stage_state SET pending_submission_id = sid, updated_at = now() WHERE stage_id = s.id;
  UPDATE public.designer_request_stages SET status = 'awaiting_agent_confirmation', submitted_at = now() WHERE id = s.id;
  RETURN sid;
END;
$function$;

-- New functions default to PUBLIC EXECUTE unless explicitly revoked.
REVOKE ALL ON FUNCTION public.submit_designer_review_current_set(uuid,bigint,text,uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- No EXECUTE grants. Never deploy separately: existing submit paths can bypass
-- this function, and read/return/confirm/delete and consistency guards are
-- not yet implemented or verified.

CREATE FUNCTION public.return_designer_review_submission(
  p_stage_id uuid, p_expected_submission_id uuid, p_feedback text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  s public.designer_request_stages;
  r public.designer_requests;
  state public.designer_review_stage_state;
  trimmed text := NULLIF(btrim(coalesce(p_feedback, '')), '');
BEGIN
  IF auth.uid() IS NULL OR p_stage_id IS NULL OR p_expected_submission_id IS NULL
     OR trimmed IS NULL OR length(trimmed) > 4000 THEN
    RAISE EXCEPTION 'Feedback and submission are required';
  END IF;
  SELECT * INTO s FROM public.designer_request_stages WHERE id = p_stage_id;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Stage not found'; END IF;
  SELECT * INTO r FROM public.designer_requests WHERE id = s.request_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;
  SELECT * INTO s FROM public.designer_request_stages WHERE id = p_stage_id FOR UPDATE;
  SELECT * INTO state FROM public.designer_review_stage_state WHERE stage_id = p_stage_id FOR UPDATE;
  IF s.id IS NULL OR state.stage_id IS NULL OR s.request_id IS DISTINCT FROM r.id
     OR state.request_id IS DISTINCT FROM r.id
     OR state.item_id IS DISTINCT FROM s.request_item_id
     OR s.stage_type <> 'design' OR r.deleted_at IS NOT NULL
     OR NOT state.is_active OR r.status IN ('completed','cancelled')
     OR r.agent_profile_id IS DISTINCT FROM auth.uid()
     OR s.status <> 'awaiting_agent_confirmation'
     OR state.pending_submission_id IS DISTINCT FROM p_expected_submission_id
     OR state.final_submission_id IS NOT NULL
     OR NOT EXISTS (SELECT 1 FROM public.designer_stage_deliverable_submissions v
       WHERE v.id = p_expected_submission_id AND v.stage_id = s.id AND v.request_id = r.id)
  THEN RAISE EXCEPTION 'Review changed or return denied'; END IF;

  INSERT INTO public.designer_review_events
    (stage_id,submission_id,actor_profile_id,event_type,note)
  VALUES (s.id,p_expected_submission_id,auth.uid(),'return',trimmed);
  UPDATE public.designer_review_stage_state
    SET pending_submission_id = NULL, draft_revision = draft_revision + 1, updated_at = now()
    WHERE stage_id = s.id;
  -- Keep assignee IDs intact, as in the actual production return function.
  UPDATE public.designer_request_stages SET status = 'revision',
    feedback = trimmed, feedback_count = feedback_count + 1 WHERE id = s.id;
END;
$function$;

CREATE FUNCTION public.confirm_designer_review_submission(
  p_stage_id uuid, p_expected_submission_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  s public.designer_request_stages;
  r public.designer_requests;
  state public.designer_review_stage_state;
  eid uuid;
  item_aware boolean;
BEGIN
  IF auth.uid() IS NULL OR p_stage_id IS NULL OR p_expected_submission_id IS NULL THEN
    RAISE EXCEPTION 'Authentication and submission required';
  END IF;
  SELECT * INTO s FROM public.designer_request_stages WHERE id = p_stage_id;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Stage not found'; END IF;
  SELECT * INTO r FROM public.designer_requests WHERE id = s.request_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;
  SELECT * INTO s FROM public.designer_request_stages WHERE id = p_stage_id FOR UPDATE;
  SELECT * INTO state FROM public.designer_review_stage_state WHERE stage_id = p_stage_id FOR UPDATE;
  IF s.id IS NULL OR state.stage_id IS NULL OR s.request_id IS DISTINCT FROM r.id
     OR state.request_id IS DISTINCT FROM r.id
     OR state.item_id IS DISTINCT FROM s.request_item_id
     OR s.stage_type <> 'design' OR r.deleted_at IS NOT NULL
     OR NOT state.is_active OR r.status IN ('completed','cancelled')
     OR r.agent_profile_id IS DISTINCT FROM auth.uid()
     OR s.status <> 'awaiting_agent_confirmation'
     OR state.pending_submission_id IS DISTINCT FROM p_expected_submission_id
     OR state.final_submission_id IS NOT NULL
     OR NOT EXISTS (SELECT 1 FROM public.designer_stage_deliverable_submissions v
       WHERE v.id = p_expected_submission_id AND v.stage_id = s.id AND v.request_id = r.id)
  THEN RAISE EXCEPTION 'Review changed or confirmation denied'; END IF;

  -- Stage/state lock is only sufficient once every current-set writer and
  -- deletion path observes the same lock order. Those functions are pending.
  IF NOT EXISTS (SELECT 1 FROM public.designer_review_current_assets a WHERE a.stage_id = s.id AND a.removed_at IS NULL)
     OR EXISTS (
       SELECT 1 FROM public.designer_review_current_assets a
       LEFT JOIN public.designer_stage_deliverables d ON d.id = a.deliverable_id
       LEFT JOIN storage.objects o ON o.bucket_id = 'designer-stage-deliverables' AND o.name = d.storage_path
       WHERE a.stage_id = s.id AND a.removed_at IS NULL AND (
         d.id IS NULL OR d.stage_id IS DISTINCT FROM s.id
         OR d.request_id IS DISTINCT FROM r.id
         OR d.request_item_id IS DISTINCT FROM s.request_item_id
         OR d.delete_requested_at IS NOT NULL OR o.id IS NULL
         OR d.submission_id IS DISTINCT FROM p_expected_submission_id
       )
     )
  THEN RAISE EXCEPTION 'Current image set is incomplete or being deleted'; END IF;

  SELECT id INTO eid FROM public.employees WHERE profile_id = auth.uid() AND deleted_at IS NULL LIMIT 1;
  INSERT INTO public.designer_review_events
    (stage_id,submission_id,actor_profile_id,event_type)
  VALUES (s.id,p_expected_submission_id,auth.uid(),'confirm');
  UPDATE public.designer_review_stage_state SET final_submission_id = p_expected_submission_id,
    pending_submission_id = NULL, updated_at = now() WHERE stage_id = s.id;
  UPDATE public.designer_request_stages SET status = 'completed', confirmed_at = now(),
    confirmed_by_profile_id = auth.uid(), confirmed_by_employee_id = eid WHERE id = s.id;

  -- Mirrors CSV 79: only an existing corresponding production Stage is opened.
  item_aware := EXISTS (SELECT 1 FROM public.designer_request_items WHERE request_id = r.id);
  IF (item_aware AND s.request_item_id IS NOT NULL)
     OR (NOT item_aware AND r.work_mode = 'design_production')
  THEN
    UPDATE public.designer_request_stages SET status = 'unclaimed'
    WHERE request_id = r.id AND stage_type = 'production' AND status = 'scheduled'
      AND (NOT item_aware OR request_item_id = s.request_item_id);
  END IF;
  IF item_aware THEN
    PERFORM public.complete_item_aware_designer_request_if_ready(r.id);
  ELSIF r.work_mode <> 'design_production' THEN
    UPDATE public.designer_requests SET status = 'completed', completed_at = now() WHERE id = r.id;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.return_designer_review_submission(uuid,uuid,text),
  public.confirm_designer_review_submission(uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- No grants. Old confirm/return endpoints remain unguarded and therefore this
-- candidate alone is not safe to enable. Runtime privilege and RLS audit needed.

COMMIT;
