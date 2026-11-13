-- These grants only expose individually authorized RPCs. No Stage is opted in
-- by this migration; state rows remain the server-side, per-Stage gate.
-- Do not deploy without reviewing all preceding migrations and Edge behavior.
BEGIN;
GRANT EXECUTE ON FUNCTION public.read_designer_review_current(uuid,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_designer_review_upload_session(uuid,uuid,uuid,uuid,text,text,text,bigint,text,bigint,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_designer_review_upload(uuid,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_designer_review_upload_cleanup(uuid,uuid,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_designer_review_current_set(uuid,bigint,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.return_designer_review_submission(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_designer_review_submission(uuid,uuid) TO authenticated;
COMMIT;
