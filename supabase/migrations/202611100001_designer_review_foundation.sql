-- Additive foundation only. No protocol activation, client access, or historical backfill.
-- This migration does not implement or enable review operations.
BEGIN;

-- A row would explicitly opt one Stage into the new protocol. Existing stages
-- have no row and retain their previous behaviour. No automatic backfill.
CREATE TABLE public.designer_review_stage_state (
  stage_id uuid PRIMARY KEY REFERENCES public.designer_request_stages(id),
  request_id uuid NOT NULL REFERENCES public.designer_requests(id),
  item_id uuid REFERENCES public.designer_request_items(id),
  is_active boolean NOT NULL DEFAULT false,
  draft_revision bigint NOT NULL DEFAULT 0 CHECK (draft_revision >= 0),
  pending_submission_id uuid REFERENCES public.designer_stage_deliverable_submissions(id),
  final_submission_id uuid REFERENCES public.designer_stage_deliverable_submissions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Mutable current set, separate from historical request data. A future
-- constraint trigger must prove Stage / Request / Item / deliverable match.
-- This table alone does not authorize insertion or make deletion safe.
CREATE TABLE public.designer_review_current_assets (
  stage_id uuid NOT NULL REFERENCES public.designer_review_stage_state(stage_id),
  deliverable_id uuid NOT NULL REFERENCES public.designer_stage_deliverables(id),
  -- May only be set by a future authorized registration RPC for new-protocol
  -- files. Legacy/imported files remain false and are never auto-deleted.
  review_owned boolean NOT NULL DEFAULT false,
  removed_at timestamptz,
  removed_by uuid REFERENCES public.profiles(id),
  removal_operation_id uuid,
  removal_expected_revision bigint,
  CHECK ((removed_at IS NULL AND removed_by IS NULL AND removal_operation_id IS NULL AND removal_expected_revision IS NULL) OR (removed_at IS NOT NULL AND removed_by IS NOT NULL AND removal_operation_id IS NOT NULL AND removal_expected_revision IS NOT NULL)),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (stage_id, deliverable_id),
  UNIQUE (deliverable_id)
);

-- Immutable membership snapshots for each new-protocol submission.
CREATE TABLE public.designer_review_submission_assets (
  submission_id uuid NOT NULL REFERENCES public.designer_stage_deliverable_submissions(id),
  stage_id uuid NOT NULL REFERENCES public.designer_review_stage_state(stage_id),
  deliverable_id uuid NOT NULL REFERENCES public.designer_stage_deliverables(id),
  PRIMARY KEY (submission_id, deliverable_id)
);
ALTER TABLE public.designer_review_submission_assets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.designer_review_submission_assets FROM PUBLIC, anon, authenticated, service_role;

-- Binds only explicitly opted-in upload sessions to their expected draft.
-- When an asset is later deleted the session remains consumed, so a retry
-- must report that the registered asset no longer exists, not recreate it.
CREATE TABLE public.designer_review_upload_bindings (
  upload_task_id uuid PRIMARY KEY REFERENCES public.designer_stage_deliverable_upload_sessions(upload_task_id),
  stage_id uuid NOT NULL REFERENCES public.designer_review_stage_state(stage_id),
  expected_revision bigint NOT NULL CHECK (expected_revision >= 0),
  deliverable_id uuid UNIQUE REFERENCES public.designer_stage_deliverables(id) ON DELETE SET NULL
);

-- Text audit only: old image bytes are not retained by these event rows.
CREATE TABLE public.designer_review_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id uuid NOT NULL REFERENCES public.designer_review_stage_state(stage_id),
  submission_id uuid REFERENCES public.designer_stage_deliverable_submissions(id),
  actor_profile_id uuid NOT NULL REFERENCES public.profiles(id),
  event_type text NOT NULL CHECK (event_type IN ('submit', 'return', 'confirm')),
  client_operation_id uuid,
  expected_revision bigint,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stage_id, event_type, client_operation_id)
);

ALTER TABLE public.designer_review_stage_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.designer_review_current_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.designer_review_upload_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.designer_review_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.designer_review_stage_state,
  public.designer_review_current_assets, public.designer_review_upload_bindings, public.designer_review_events FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
