-- REVIEW CANDIDATE ONLY. NOT APPROVED FOR DEPLOYMENT.
-- 03/03: apply only after schema and access candidates.
-- Old function body is based on the Production pg_get_functiondef CSV
-- supplied on 2026-10-29; confirm that definition again before deployment.

CREATE TABLE public.designer_stage_deliverables_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  legacy_design_enforced boolean NOT NULL DEFAULT false
);

-- No client SELECT/INSERT/UPDATE/DELETE. SECURITY DEFINER RPCs alone read the gate.
ALTER TABLE public.designer_stage_deliverables_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.designer_stage_deliverables_settings
FROM PUBLIC, anon, authenticated;

INSERT INTO public.designer_stage_deliverables_settings (
  singleton, legacy_design_enforced
) VALUES (true, false)
ON CONFLICT (singleton) DO NOTHING;

-- Existing Production RPC: retain old authentication/ownership/state checks,
-- RETURN void, feedback semantics, and Request -> Stage lock order.
-- Only add explicit missing-row errors plus gate-dependent Legacy design guard.
CREATE OR REPLACE FUNCTION public.submit_designer_request_stage(
  p_stage_id uuid, p_feedback text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  s public.designer_request_stages;
  r public.designer_requests;
  enforce boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO s FROM public.designer_request_stages WHERE id = p_stage_id;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Stage not found'; END IF;

  SELECT * INTO r FROM public.designer_requests
  WHERE id = s.request_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;

  SELECT * INTO s FROM public.designer_request_stages
  WHERE id = p_stage_id FOR UPDATE;
  IF s.id IS NULL OR s.request_id <> r.id THEN
    RAISE EXCEPTION 'Stage changed during submission';
  END IF;

  IF r.status IN ('completed', 'cancelled')
     OR s.assignee_profile_id <> auth.uid()
     OR s.status NOT IN ('in_progress', 'revision')
  THEN
    RAISE EXCEPTION 'Invalid submission';
  END IF;

  SELECT legacy_design_enforced INTO enforce
  FROM public.designer_stage_deliverables_settings WHERE singleton = true;

  IF COALESCE(enforce, false)
     AND s.stage_type = 'design'
     AND s.request_item_id IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.designer_request_items i
       WHERE i.request_id = s.request_id
     )
  THEN
    RAISE EXCEPTION '设计成果提交已启用，请刷新页面后上传成果并提交确认';
  END IF;

  UPDATE public.designer_request_stages
  SET status = 'awaiting_agent_confirmation',
      submitted_at = now(),
      feedback = COALESCE(NULLIF(btrim(p_feedback), ''), feedback)
  WHERE id = s.id;
END;
$$;

-- New all-or-nothing submission. A Request -> Stage row lock serializes
-- submissions and protects monotonic per-stage version numbers.
CREATE OR REPLACE FUNCTION public.submit_designer_stage_deliverables(
  p_stage_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  s public.designer_request_stages;
  r public.designer_requests;
  sid uuid;
  v integer;
  affected integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO s FROM public.designer_request_stages WHERE id = p_stage_id;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Stage not found'; END IF;

  SELECT * INTO r FROM public.designer_requests
  WHERE id = s.request_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;

  SELECT * INTO s FROM public.designer_request_stages
  WHERE id = p_stage_id FOR UPDATE;
  IF s.id IS NULL OR s.request_id <> r.id THEN
    RAISE EXCEPTION 'Stage changed during submission';
  END IF;

  IF r.status IN ('completed', 'cancelled')
     OR s.assignee_profile_id <> auth.uid()
     OR s.stage_type <> 'design'
     OR s.status NOT IN ('in_progress', 'revision')
     OR s.request_item_id IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM public.designer_request_items i
       WHERE i.request_id = s.request_id
     )
  THEN
    RAISE EXCEPTION 'Deliverable submission denied';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.designer_stage_deliverables d
    WHERE d.stage_id = s.id AND d.request_id = s.request_id
      AND d.submission_id IS NULL AND d.delete_requested_at IS NULL
      AND d.uploaded_by = auth.uid()
  ) THEN
    RAISE EXCEPTION 'At least one active draft is required';
  END IF;

  SELECT COALESCE(max(version_number), 0) + 1 INTO v
  FROM public.designer_stage_deliverable_submissions
  WHERE stage_id = s.id;

  INSERT INTO public.designer_stage_deliverable_submissions (
    request_id, stage_id, version_number, submitted_by
  ) VALUES (s.request_id, s.id, v, auth.uid())
  RETURNING id INTO sid;

  UPDATE public.designer_stage_deliverables
  SET submission_id = sid
  WHERE stage_id = s.id AND request_id = s.request_id
    AND submission_id IS NULL AND delete_requested_at IS NULL
    AND uploaded_by = auth.uid();
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected < 1 THEN
    RAISE EXCEPTION 'Draft batch changed';
  END IF;

  UPDATE public.designer_request_stages
  SET status = 'awaiting_agent_confirmation', submitted_at = now()
  WHERE id = s.id AND status IN ('in_progress', 'revision');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stage changed during submission';
  END IF;
END;
$$;

-- Leave the existing Production function's ACL untouched to preserve clients.
-- Only the new RPC receives an explicit least-privilege EXECUTE grant.
REVOKE ALL ON FUNCTION public.submit_designer_stage_deliverables(uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_designer_stage_deliverables(uuid)
TO authenticated;
