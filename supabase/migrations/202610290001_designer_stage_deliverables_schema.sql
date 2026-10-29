-- REVIEW CANDIDATE ONLY. NOT APPROVED FOR DEPLOYMENT.
-- 01/03: new isolated schema and private bucket; no Production SQL executed.
-- Requires existing public.designer_requests, designer_request_stages,
-- designer_request_items, and profiles. New tables are fail-closed immediately.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'designer-stage-deliverables',
  'designer-stage-deliverables',
  false,
  52428800,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE TABLE public.designer_stage_deliverable_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.designer_requests(id),
  stage_id uuid NOT NULL REFERENCES public.designer_request_stages(id),
  version_number integer NOT NULL CHECK (version_number > 0),
  submitted_by uuid NOT NULL REFERENCES public.profiles(id),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stage_id, version_number)
);

CREATE TABLE public.designer_stage_deliverables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.designer_requests(id),
  stage_id uuid NOT NULL REFERENCES public.designer_request_stages(id),
  request_item_id uuid REFERENCES public.designer_request_items(id),
  storage_path text NOT NULL UNIQUE,
  original_name text NOT NULL,
  content_type text NOT NULL CHECK (
    content_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
  ),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 52428800),
  uploaded_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  submission_id uuid REFERENCES public.designer_stage_deliverable_submissions(id),
  delete_requested_at timestamptz
);

CREATE INDEX designer_stage_deliverables_stage_drafts_idx
  ON public.designer_stage_deliverables(stage_id, submission_id, uploaded_by)
  WHERE delete_requested_at IS NULL;

CREATE TABLE public.designer_stage_deliverable_upload_sessions (
  upload_task_id uuid PRIMARY KEY,
  uploaded_by uuid NOT NULL REFERENCES public.profiles(id),
  request_id uuid NOT NULL REFERENCES public.designer_requests(id),
  stage_id uuid NOT NULL REFERENCES public.designer_request_stages(id),
  storage_path text NOT NULL UNIQUE,
  original_name text NOT NULL,
  content_type text NOT NULL CHECK (
    content_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
  ),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 52428800),
  file_fingerprint text NOT NULL,
  last_modified bigint NOT NULL CHECK (last_modified >= 0),
  status text NOT NULL CHECK (
    status IN ('pending', 'uploading', 'uploaded', 'registering', 'consumed',
               'cleanup_requested', 'cleanup_failed', 'cleaned', 'expired', 'cancelled')
  ),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '1 hour',
  cleanup_requested_at timestamptz,
  cleanup_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX designer_deliverable_upload_sessions_owner_idx
  ON public.designer_stage_deliverable_upload_sessions(uploaded_by, status);

-- Fail closed even if the three files are installed in separate steps.
ALTER TABLE public.designer_stage_deliverable_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.designer_stage_deliverables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.designer_stage_deliverable_upload_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE
  public.designer_stage_deliverable_submissions,
  public.designer_stage_deliverables,
  public.designer_stage_deliverable_upload_sessions
FROM PUBLIC, anon, authenticated;

-- These constraint triggers check the owning request and prevent cross-stage
-- version attachment. Each table exists before its trigger is created.
CREATE FUNCTION public.assert_designer_deliverable_submission_consistency()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.designer_request_stages s
    WHERE s.id = NEW.stage_id AND s.request_id = NEW.request_id
  ) THEN
    RAISE EXCEPTION 'Submission Stage/Request mismatch';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER designer_submission_stage_request_match
AFTER INSERT OR UPDATE OF stage_id, request_id
ON public.designer_stage_deliverable_submissions
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW EXECUTE FUNCTION public.assert_designer_deliverable_submission_consistency();

CREATE FUNCTION public.assert_designer_deliverable_consistency()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.designer_request_stages s
    WHERE s.id = NEW.stage_id AND s.request_id = NEW.request_id
  ) THEN
    RAISE EXCEPTION 'Deliverable Stage/Request mismatch';
  END IF;
  IF NEW.request_item_id IS NOT NULL THEN
    RAISE EXCEPTION 'Multi Item deliverables are not enabled';
  END IF;
  IF NEW.submission_id IS NOT NULL THEN
    IF NEW.delete_requested_at IS NOT NULL OR NOT EXISTS (
      SELECT 1 FROM public.designer_stage_deliverable_submissions v
      WHERE v.id = NEW.submission_id
        AND v.stage_id = NEW.stage_id
        AND v.request_id = NEW.request_id
    ) THEN
      RAISE EXCEPTION 'Deliverable/submission mismatch';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER designer_deliverable_stage_submission_match
AFTER INSERT OR UPDATE OF stage_id, request_id, submission_id, request_item_id, delete_requested_at
ON public.designer_stage_deliverables
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW EXECUTE FUNCTION public.assert_designer_deliverable_consistency();

CREATE FUNCTION public.assert_designer_upload_session_stage_request()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.designer_request_stages s
    WHERE s.id = NEW.stage_id AND s.request_id = NEW.request_id
  ) THEN
    RAISE EXCEPTION 'Upload session Stage/Request mismatch';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER designer_upload_session_stage_request_match
AFTER INSERT OR UPDATE OF stage_id, request_id
ON public.designer_stage_deliverable_upload_sessions
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW EXECUTE FUNCTION public.assert_designer_upload_session_stage_request();

REVOKE ALL ON FUNCTION
  public.assert_designer_deliverable_submission_consistency(),
  public.assert_designer_deliverable_consistency(),
  public.assert_designer_upload_session_stage_request()
FROM PUBLIC, anon, authenticated;
