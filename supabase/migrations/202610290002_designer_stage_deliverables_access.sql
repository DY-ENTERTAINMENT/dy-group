-- REVIEW CANDIDATE ONLY. NOT APPROVED FOR DEPLOYMENT.
-- 02/03: apply only after schema candidate.
-- Order: base permissions -> helper functions -> workflow functions
--        -> function grants -> final table/storage policies.

-- RLS was enabled by schema candidate; repeat harmlessly for auditability.
ALTER TABLE public.designer_stage_deliverables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.designer_stage_deliverable_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.designer_stage_deliverable_upload_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE
  public.designer_stage_deliverables,
  public.designer_stage_deliverable_submissions,
  public.designer_stage_deliverable_upload_sessions
FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE
  public.designer_stage_deliverables,
  public.designer_stage_deliverable_submissions,
  public.designer_stage_deliverable_upload_sessions
TO authenticated;

-- Helper 1: current owner and valid legacy design stage.
-- [.] avoids SQL backslash-escaping ambiguity while matching a literal period.
CREATE OR REPLACE FUNCTION public.can_write_designer_stage_deliverable(
  p_stage_id uuid, p_request_id uuid, p_path text
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.designer_request_stages s
    JOIN public.designer_requests r ON r.id = s.request_id
    WHERE s.id = p_stage_id
      AND s.request_id = p_request_id
      AND s.assignee_profile_id = auth.uid()
      AND s.stage_type = 'design'
      AND s.status IN ('in_progress', 'revision')
      AND r.status NOT IN ('completed', 'cancelled')
      AND s.request_item_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.designer_request_items i
        WHERE i.request_id = s.request_id
      )
      AND p_path ~ (
        '^' || auth.uid()::text || '/' || p_stage_id::text || '/'
        || '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
        || '[.](jpg|jpeg|png|webp|pdf)$'
      )
  );
$$;

-- Helper 2: submitted versions are visible only to the actual applicant,
-- assigned designer, or authorized Super Admin. Never grants draft access.
CREATE OR REPLACE FUNCTION public.can_read_designer_stage_deliverable_submission(
  p_stage_id uuid, p_request_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.designer_request_stages s
    JOIN public.designer_requests r ON r.id = s.request_id
    WHERE s.id = p_stage_id AND r.id = p_request_id
      AND (
        r.agent_profile_id = auth.uid()
        OR s.assignee_profile_id = auth.uid()
        OR public.current_user_is_super_admin()
      )
  );
$$;

-- API: list only submitted versions visible to viewer, or live own drafts.
CREATE OR REPLACE FUNCTION public.list_designer_stage_deliverables(p_stage_id uuid)
RETURNS TABLE (
  id uuid, request_id uuid, stage_id uuid, request_item_id uuid,
  storage_path text, original_name text, content_type text, size_bytes bigint,
  submission_id uuid, version_number integer, created_at timestamptz,
  submitted_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT d.id, d.request_id, d.stage_id, d.request_item_id,
         d.storage_path, d.original_name, d.content_type, d.size_bytes,
         d.submission_id, v.version_number, d.created_at, v.submitted_at
  FROM public.designer_stage_deliverables d
  LEFT JOIN public.designer_stage_deliverable_submissions v ON v.id = d.submission_id
  WHERE d.stage_id = p_stage_id
    AND (
      (d.submission_id IS NOT NULL
       AND public.can_read_designer_stage_deliverable_submission(d.stage_id, d.request_id))
      OR
      (d.submission_id IS NULL AND d.delete_requested_at IS NULL
       AND d.uploaded_by = auth.uid()
       AND EXISTS (
         SELECT 1 FROM public.designer_request_stages s
         WHERE s.id = d.stage_id AND s.assignee_profile_id = auth.uid()
       ))
    )
  ORDER BY v.version_number DESC NULLS LAST, d.created_at ASC;
$$;

-- API: initiate a one-hour path-bound upload task. No direct client INSERT.
CREATE OR REPLACE FUNCTION public.create_designer_stage_deliverable_upload_session(
  p_upload_task_id uuid, p_request_id uuid, p_stage_id uuid,
  p_storage_path text, p_original_name text, p_content_type text,
  p_size_bytes bigint, p_file_fingerprint text, p_last_modified bigint
) RETURNS public.designer_stage_deliverable_upload_sessions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE result public.designer_stage_deliverable_upload_sessions;
BEGIN
  IF auth.uid() IS NULL
     OR p_upload_task_id IS NULL
     OR NULLIF(btrim(p_file_fingerprint), '') IS NULL
     OR p_last_modified IS NULL OR p_last_modified < 0
     OR NULLIF(btrim(p_original_name), '') IS NULL
     OR NOT COALESCE(public.can_write_designer_stage_deliverable(
           p_stage_id, p_request_id, p_storage_path), false)
     OR p_content_type NOT IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
     OR p_size_bytes IS NULL OR p_size_bytes <= 0 OR p_size_bytes > 52428800
  THEN
    RAISE EXCEPTION 'Upload session denied';
  END IF;

  INSERT INTO public.designer_stage_deliverable_upload_sessions (
    upload_task_id, uploaded_by, request_id, stage_id, storage_path,
    original_name, content_type, size_bytes, file_fingerprint, last_modified, status
  ) VALUES (
    p_upload_task_id, auth.uid(), p_request_id, p_stage_id, p_storage_path,
    left(btrim(p_original_name), 255), p_content_type,
    p_size_bytes, p_file_fingerprint, p_last_modified, 'pending'
  ) RETURNING * INTO result;
  RETURN result;
END;
$$;

-- API: register only an object whose task remains valid AFTER upload.
-- Lock Request -> Stage before rechecking; never register after reassignment.
CREATE OR REPLACE FUNCTION public.register_designer_stage_deliverable_draft(
  p_upload_task_id uuid
) RETURNS public.designer_stage_deliverables
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  u public.designer_stage_deliverable_upload_sessions;
  r public.designer_requests;
  s public.designer_request_stages;
  result public.designer_stage_deliverables;
  obj storage.objects;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO u FROM public.designer_stage_deliverable_upload_sessions
  WHERE upload_task_id = p_upload_task_id FOR UPDATE;
  IF u.upload_task_id IS NULL
     OR u.uploaded_by <> auth.uid()
     OR u.status NOT IN ('pending', 'uploading', 'uploaded')
     OR u.expires_at <= now()
  THEN
    RAISE EXCEPTION 'Upload session cannot be registered';
  END IF;

  SELECT * INTO r FROM public.designer_requests
  WHERE id = u.request_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;
  SELECT * INTO s FROM public.designer_request_stages
  WHERE id = u.stage_id FOR UPDATE;
  IF s.id IS NULL OR s.request_id <> r.id
     OR NOT COALESCE(public.can_write_designer_stage_deliverable(
           u.stage_id, u.request_id, u.storage_path), false)
  THEN
    RAISE EXCEPTION 'Stage is no longer eligible to register this draft';
  END IF;

  SELECT * INTO obj FROM storage.objects
  WHERE bucket_id = 'designer-stage-deliverables' AND name = u.storage_path;
  IF obj.id IS NULL
     OR COALESCE((obj.metadata ->> 'size')::bigint, -1) <> u.size_bytes
     OR COALESCE(obj.metadata ->> 'mimetype', '') <> u.content_type
  THEN
    RAISE EXCEPTION 'Uploaded object metadata mismatch';
  END IF;

  INSERT INTO public.designer_stage_deliverables (
    request_id, stage_id, storage_path, original_name,
    content_type, size_bytes, uploaded_by
  ) VALUES (
    u.request_id, u.stage_id, u.storage_path, u.original_name,
    u.content_type, u.size_bytes, u.uploaded_by
  ) RETURNING * INTO result;

  UPDATE public.designer_stage_deliverable_upload_sessions
  SET status = 'consumed', updated_at = now()
  WHERE upload_task_id = u.upload_task_id;
  RETURN result;
END;
$$;

-- API: request cleanup of an unregistered upload-task object.
CREATE OR REPLACE FUNCTION public.request_designer_stage_deliverable_upload_session_cleanup(
  p_upload_task_id uuid, p_error text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE u public.designer_stage_deliverable_upload_sessions;
BEGIN
  SELECT * INTO u FROM public.designer_stage_deliverable_upload_sessions
  WHERE upload_task_id = p_upload_task_id FOR UPDATE;
  IF u.upload_task_id IS NULL OR u.uploaded_by <> auth.uid()
     OR u.status IN ('consumed', 'cleaned')
     OR EXISTS (SELECT 1 FROM public.designer_stage_deliverables d
                WHERE d.storage_path = u.storage_path)
  THEN
    RAISE EXCEPTION 'Upload cleanup denied';
  END IF;
  UPDATE public.designer_stage_deliverable_upload_sessions
  SET status = 'cleanup_requested',
      cleanup_requested_at = COALESCE(cleanup_requested_at, now()),
      cleanup_error = left(NULLIF(btrim(p_error), ''), 500),
      updated_at = now()
  WHERE upload_task_id = u.upload_task_id;
  RETURN u.storage_path;
END;
$$;

-- API: success requires storage.objects to have been deleted by Storage API.
-- Error reports preserve retryable cleanup_failed status.
CREATE OR REPLACE FUNCTION public.complete_designer_stage_deliverable_upload_session_cleanup(
  p_upload_task_id uuid, p_error text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE u public.designer_stage_deliverable_upload_sessions;
BEGIN
  SELECT * INTO u FROM public.designer_stage_deliverable_upload_sessions
  WHERE upload_task_id = p_upload_task_id FOR UPDATE;
  IF u.upload_task_id IS NULL OR u.uploaded_by <> auth.uid()
     OR u.status NOT IN ('cleanup_requested', 'cleanup_failed', 'expired', 'cancelled')
     OR EXISTS (SELECT 1 FROM public.designer_stage_deliverables d
                WHERE d.storage_path = u.storage_path)
  THEN
    RAISE EXCEPTION 'Upload cleanup completion denied';
  END IF;
  IF NULLIF(btrim(p_error), '') IS NULL
     AND EXISTS (SELECT 1 FROM storage.objects o
                 WHERE o.bucket_id = 'designer-stage-deliverables'
                   AND o.name = u.storage_path)
  THEN
    RAISE EXCEPTION 'Storage object still exists; cannot mark cleaned';
  END IF;
  UPDATE public.designer_stage_deliverable_upload_sessions
  SET status = CASE WHEN NULLIF(btrim(p_error), '') IS NULL
                    THEN 'cleaned' ELSE 'cleanup_failed' END,
      cleanup_error = left(NULLIF(btrim(p_error), ''), 500),
      updated_at = now()
  WHERE upload_task_id = u.upload_task_id;
END;
$$;

-- API: two-phase deletion. Never delete submitted assets.
CREATE OR REPLACE FUNCTION public.request_designer_stage_deliverable_draft_delete(
  p_deliverable_id uuid
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE d public.designer_stage_deliverables;
BEGIN
  SELECT * INTO d FROM public.designer_stage_deliverables
  WHERE id = p_deliverable_id FOR UPDATE;
  IF d.id IS NULL OR d.submission_id IS NOT NULL
     OR d.uploaded_by <> auth.uid()
     OR NOT EXISTS (
       SELECT 1 FROM public.designer_request_stages s
       WHERE s.id = d.stage_id AND s.assignee_profile_id = auth.uid()
         AND s.status IN ('in_progress', 'revision')
     )
  THEN
    RAISE EXCEPTION 'Draft deletion denied';
  END IF;
  UPDATE public.designer_stage_deliverables
  SET delete_requested_at = COALESCE(delete_requested_at, now())
  WHERE id = d.id;
  RETURN d.storage_path;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_designer_stage_deliverable_draft_delete(
  p_deliverable_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE d public.designer_stage_deliverables;
BEGIN
  SELECT * INTO d FROM public.designer_stage_deliverables
  WHERE id = p_deliverable_id FOR UPDATE;
  IF d.id IS NULL OR d.submission_id IS NOT NULL
     OR d.delete_requested_at IS NULL OR d.uploaded_by <> auth.uid()
     OR NOT EXISTS (
       SELECT 1 FROM public.designer_request_stages s
       WHERE s.id = d.stage_id AND s.assignee_profile_id = auth.uid()
     )
  THEN
    RAISE EXCEPTION 'Draft deletion finalization denied';
  END IF;
  IF EXISTS (SELECT 1 FROM storage.objects o
             WHERE o.bucket_id = 'designer-stage-deliverables'
               AND o.name = d.storage_path)
  THEN
    RAISE EXCEPTION 'Storage object still exists; draft deletion not finalized';
  END IF;
  DELETE FROM public.designer_stage_deliverables WHERE id = d.id;
END;
$$;

-- All functions exist before privileges are changed. PostgreSQL PUBLIC
-- has default EXECUTE on new functions unless explicitly revoked.
REVOKE ALL ON FUNCTION
  public.can_write_designer_stage_deliverable(uuid, uuid, text),
  public.can_read_designer_stage_deliverable_submission(uuid, uuid),
  public.list_designer_stage_deliverables(uuid),
  public.create_designer_stage_deliverable_upload_session(uuid,uuid,uuid,text,text,text,bigint,text,bigint),
  public.register_designer_stage_deliverable_draft(uuid),
  public.request_designer_stage_deliverable_upload_session_cleanup(uuid,text),
  public.complete_designer_stage_deliverable_upload_session_cleanup(uuid,text),
  public.request_designer_stage_deliverable_draft_delete(uuid),
  public.finalize_designer_stage_deliverable_draft_delete(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.can_write_designer_stage_deliverable(uuid,uuid,text),
  public.can_read_designer_stage_deliverable_submission(uuid,uuid),
  public.list_designer_stage_deliverables(uuid),
  public.create_designer_stage_deliverable_upload_session(uuid,uuid,uuid,text,text,text,bigint,text,bigint),
  public.register_designer_stage_deliverable_draft(uuid),
  public.request_designer_stage_deliverable_upload_session_cleanup(uuid,text),
  public.complete_designer_stage_deliverable_upload_session_cleanup(uuid,text),
  public.request_designer_stage_deliverable_draft_delete(uuid),
  public.finalize_designer_stage_deliverable_draft_delete(uuid)
TO authenticated;

-- New-table RLS. No client INSERT/UPDATE/DELETE grants: writes use RPC only.
CREATE POLICY "Deliverable submitted read is narrow"
ON public.designer_stage_deliverables FOR SELECT TO authenticated
USING (submission_id IS NOT NULL AND
       public.can_read_designer_stage_deliverable_submission(stage_id, request_id));

CREATE POLICY "Deliverable assignee reads own drafts"
ON public.designer_stage_deliverables FOR SELECT TO authenticated
USING (
  submission_id IS NULL AND delete_requested_at IS NULL
  AND uploaded_by = auth.uid()
  AND EXISTS (SELECT 1 FROM public.designer_request_stages s
              WHERE s.id = stage_id AND s.assignee_profile_id = auth.uid())
);

CREATE POLICY "Deliverable submission read is narrow"
ON public.designer_stage_deliverable_submissions FOR SELECT TO authenticated
USING (public.can_read_designer_stage_deliverable_submission(stage_id,request_id));

CREATE POLICY "Upload session owner reads own"
ON public.designer_stage_deliverable_upload_sessions FOR SELECT TO authenticated
USING (uploaded_by = auth.uid());

-- Storage policies are all bucket-scoped. No public/anon policies.
CREATE POLICY "Deliverable object insert via upload session"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'designer-stage-deliverables'
  AND EXISTS (
    SELECT 1 FROM public.designer_stage_deliverable_upload_sessions u
    WHERE u.storage_path = name AND u.uploaded_by = auth.uid()
      AND u.status IN ('pending', 'uploading') AND u.expires_at > now()
  )
);

CREATE POLICY "Deliverable object select is narrow"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'designer-stage-deliverables'
  AND EXISTS (
    SELECT 1 FROM public.designer_stage_deliverables d
    WHERE d.storage_path = name
      AND (
        (d.submission_id IS NOT NULL AND
         public.can_read_designer_stage_deliverable_submission(d.stage_id,d.request_id))
        OR
        (d.submission_id IS NULL AND d.uploaded_by = auth.uid()
         AND EXISTS (SELECT 1 FROM public.designer_request_stages s
                     WHERE s.id = d.stage_id
                       AND s.assignee_profile_id = auth.uid()))
      )
  )
);

-- Temporary own-object read during an unregistered upload cleanup, to permit
-- Storage.remove() on implementations that require both SELECT and DELETE.
CREATE POLICY "Deliverable cleanup object select"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'designer-stage-deliverables'
  AND EXISTS (
    SELECT 1 FROM public.designer_stage_deliverable_upload_sessions u
    WHERE u.storage_path = name AND u.uploaded_by = auth.uid()
      AND u.status IN ('cleanup_requested','cleanup_failed','expired','cancelled')
      AND NOT EXISTS (
        SELECT 1 FROM public.designer_stage_deliverables d
        WHERE d.storage_path = u.storage_path
      )
  )
);

CREATE POLICY "Deliverable object delete via upload cleanup session"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'designer-stage-deliverables'
  AND EXISTS (
    SELECT 1 FROM public.designer_stage_deliverable_upload_sessions u
    WHERE u.storage_path = name AND u.uploaded_by = auth.uid()
      AND u.status IN ('cleanup_requested','cleanup_failed','expired','cancelled')
      AND NOT EXISTS (
        SELECT 1 FROM public.designer_stage_deliverables d
        WHERE d.storage_path = u.storage_path
      )
  )
);

CREATE POLICY "Deliverable marked own draft delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'designer-stage-deliverables'
  AND EXISTS (
    SELECT 1 FROM public.designer_stage_deliverables d
    JOIN public.designer_request_stages s ON s.id = d.stage_id
    WHERE d.storage_path = name
      AND d.submission_id IS NULL AND d.delete_requested_at IS NOT NULL
      AND d.uploaded_by = auth.uid() AND s.assignee_profile_id = auth.uid()
  )
);
