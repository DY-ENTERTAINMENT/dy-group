-- Compatibility guards based on production CSV 79 and 83. Requires 001-004.
-- Do not deploy until definitions and in-flight operations have been verified.
BEGIN;
DO $preflight$
BEGIN
  IF to_regprocedure('public.assert_designer_deliverable_consistency()') IS NULL OR md5(replace(pg_get_functiondef(to_regprocedure('public.assert_designer_deliverable_consistency()')), chr(13), '')) IS DISTINCT FROM '0776fdf73199c4f0b7ba321d31d5283f' THEN RAISE EXCEPTION 'Production definition changed: assert_designer_deliverable_consistency'; END IF;
  IF to_regprocedure('public.submit_designer_request_stage(uuid,text)') IS NULL OR md5(replace(pg_get_functiondef(to_regprocedure('public.submit_designer_request_stage(uuid,text)')), chr(13), '')) IS DISTINCT FROM 'b5bf31c170aa4015c06f0a27d876b766' THEN RAISE EXCEPTION 'Production definition changed: submit_designer_request_stage'; END IF;
  IF to_regprocedure('public.submit_designer_stage_deliverables(uuid)') IS NULL OR md5(replace(pg_get_functiondef(to_regprocedure('public.submit_designer_stage_deliverables(uuid)')), chr(13), '')) IS DISTINCT FROM '3cfdd919fe169d8fab76c93121119e86' THEN RAISE EXCEPTION 'Production definition changed: submit_designer_stage_deliverables'; END IF;
  IF to_regprocedure('public.confirm_designer_request_stage(uuid)') IS NULL OR md5(replace(pg_get_functiondef(to_regprocedure('public.confirm_designer_request_stage(uuid)')), chr(13), '')) IS DISTINCT FROM '6a79dfdbb3ee044938fb62c26c9a9ab1' THEN RAISE EXCEPTION 'Production definition changed: confirm_designer_request_stage'; END IF;
  IF to_regprocedure('public.return_designer_request_stage(uuid,text)') IS NULL OR md5(replace(pg_get_functiondef(to_regprocedure('public.return_designer_request_stage(uuid,text)')), chr(13), '')) IS DISTINCT FROM 'e35dbf7fad46451dcede6b74dce27a6e' THEN RAISE EXCEPTION 'Production definition changed: return_designer_request_stage'; END IF;
  IF to_regprocedure('public.create_designer_stage_deliverable_upload_session(uuid,uuid,uuid,text,text,text,bigint,text,bigint)') IS NULL OR md5(replace(pg_get_functiondef(to_regprocedure('public.create_designer_stage_deliverable_upload_session(uuid,uuid,uuid,text,text,text,bigint,text,bigint)')), chr(13), '')) IS DISTINCT FROM 'cd46be176f335920b2430be082c0e024' THEN RAISE EXCEPTION 'Production definition changed: create_designer_stage_deliverable_upload_session'; END IF;
  IF to_regprocedure('public.register_designer_stage_deliverable_draft(uuid)') IS NULL OR md5(replace(pg_get_functiondef(to_regprocedure('public.register_designer_stage_deliverable_draft(uuid)')), chr(13), '')) IS DISTINCT FROM '5102c95901c9c2fc6eb32a21967d76d4' THEN RAISE EXCEPTION 'Production definition changed: register_designer_stage_deliverable_draft'; END IF;
  IF to_regprocedure('public.request_designer_stage_deliverable_draft_delete(uuid)') IS NULL OR md5(replace(pg_get_functiondef(to_regprocedure('public.request_designer_stage_deliverable_draft_delete(uuid)')), chr(13), '')) IS DISTINCT FROM '63b83159684fdd59014179a99a096785' THEN RAISE EXCEPTION 'Production definition changed: request_designer_stage_deliverable_draft_delete'; END IF;
  IF to_regprocedure('public.finalize_designer_stage_deliverable_draft_delete(uuid)') IS NULL OR md5(replace(pg_get_functiondef(to_regprocedure('public.finalize_designer_stage_deliverable_draft_delete(uuid)')), chr(13), '')) IS DISTINCT FROM '5998a49380e43756c582686b79fc32a5' THEN RAISE EXCEPTION 'Production definition changed: finalize_designer_stage_deliverable_draft_delete'; END IF;
END $preflight$;
CREATE OR REPLACE FUNCTION public.assert_designer_deliverable_consistency()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  stage_row public.designer_request_stages;
  protocol_row public.designer_review_stage_state;
BEGIN
  SELECT * INTO stage_row
  FROM public.designer_request_stages s
  WHERE s.id = NEW.stage_id AND s.request_id = NEW.request_id;
  IF stage_row.id IS NULL THEN
    RAISE EXCEPTION 'Deliverable Stage/Request mismatch';
  END IF;

  SELECT * INTO protocol_row
  FROM public.designer_review_stage_state state
  WHERE state.stage_id = NEW.stage_id;

  IF protocol_row.stage_id IS NULL THEN
    -- Preserve the CSV 83 production rule for every non-opted-in stage.
    IF NEW.request_item_id IS NOT NULL THEN
      RAISE EXCEPTION 'Multi Item deliverables are not enabled';
    END IF;
  ELSE
    IF protocol_row.request_id IS DISTINCT FROM stage_row.request_id
       OR protocol_row.item_id IS DISTINCT FROM stage_row.request_item_id
       OR NEW.request_item_id IS DISTINCT FROM stage_row.request_item_id
       OR NEW.request_item_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.designer_request_items i
         WHERE i.id = NEW.request_item_id AND i.request_id = NEW.request_id)
       OR stage_row.stage_type <> 'design'
    THEN
      RAISE EXCEPTION 'Review Stage/Request/Item mismatch';
    END IF;
  END IF;

  -- Preserve the existing submitted-record integrity rule. The new deletion
  -- workflow must not clear or bypass it without a separate reference audit.
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
$function$;

-- Remaining upload helper, register, list, submit, return, confirm, delete,
-- Storage and grants are intentionally absent. This function alone cannot
-- enable multi-Item handling safely. Validate all of them together.

CREATE OR REPLACE FUNCTION public.submit_designer_request_stage(p_stage_id uuid, p_feedback text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  END IF; IF s.stage_type = 'design' AND EXISTS (SELECT 1 FROM public.designer_review_stage_state st WHERE st.stage_id = s.id) THEN RAISE EXCEPTION 'Use the version-checked review endpoint'; END IF; 

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
$function$;

CREATE OR REPLACE FUNCTION public.submit_designer_stage_deliverables(p_stage_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  END IF; IF s.stage_type = 'design' AND EXISTS (SELECT 1 FROM public.designer_review_stage_state st WHERE st.stage_id = s.id) THEN RAISE EXCEPTION 'Use the version-checked review endpoint'; END IF; 

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
$function$;

CREATE OR REPLACE FUNCTION public.confirm_designer_request_stage(p_stage_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ declare s public.designer_request_stages;r public.designer_requests;eid uuid;item_aware boolean; begin if auth.uid() is null then raise exception 'Authentication required'; end if;select * into s from public.designer_request_stages where id=p_stage_id;select * into r from public.designer_requests where id=s.request_id for update;select * into s from public.designer_request_stages where id=p_stage_id for update;if r.status in ('completed','cancelled') or r.agent_profile_id<>auth.uid() or s.status<>'awaiting_agent_confirmation' then raise exception 'Confirmation denied';end if; IF s.stage_type = 'design' AND EXISTS (SELECT 1 FROM public.designer_review_stage_state st WHERE st.stage_id = s.id) THEN RAISE EXCEPTION 'Use the version-checked review endpoint'; END IF; select id into eid from public.employees where profile_id=auth.uid() and deleted_at is null limit 1;update public.designer_request_stages set status='completed',confirmed_at=now(),confirmed_by_profile_id=auth.uid(),confirmed_by_employee_id=eid where id=s.id;item_aware:=exists(select 1 from public.designer_request_items where request_id=r.id);if s.stage_type='design' and ((item_aware and s.request_item_id is not null) or (not item_aware and r.work_mode='design_production')) then update public.designer_request_stages set status='unclaimed' where request_id=r.id and stage_type='production' and status='scheduled' and (not item_aware or request_item_id=s.request_item_id);end if;if item_aware then perform public.complete_item_aware_designer_request_if_ready(r.id);elsif not(s.stage_type='design' and r.work_mode='design_production') then update public.designer_requests set status='completed',completed_at=now() where id=r.id;end if;end $function$;

CREATE OR REPLACE FUNCTION public.return_designer_request_stage(p_stage_id uuid, p_feedback text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ declare s public.designer_request_stages;r public.designer_requests;begin if auth.uid() is null then raise exception 'Authentication required';end if;if nullif(btrim(p_feedback),'') is null then raise exception 'Feedback is required';end if;select * into s from public.designer_request_stages where id=p_stage_id;select * into r from public.designer_requests where id=s.request_id for update;select * into s from public.designer_request_stages where id=p_stage_id for update;if r.status in ('completed','cancelled') or r.agent_profile_id<>auth.uid() or s.status<>'awaiting_agent_confirmation' then raise exception 'Return denied';end if; IF s.stage_type = 'design' AND EXISTS (SELECT 1 FROM public.designer_review_stage_state st WHERE st.stage_id = s.id) THEN RAISE EXCEPTION 'Use the version-checked review endpoint'; END IF; update public.designer_request_stages set status='revision',feedback=btrim(p_feedback),feedback_count=feedback_count+1 where id=s.id;end $function$;


CREATE OR REPLACE FUNCTION public.create_designer_stage_deliverable_upload_session(p_upload_task_id uuid, p_request_id uuid, p_stage_id uuid, p_storage_path text, p_original_name text, p_content_type text, p_size_bytes bigint, p_file_fingerprint text, p_last_modified bigint)
 RETURNS designer_stage_deliverable_upload_sessions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare result public.designer_stage_deliverable_upload_sessions; r public.designer_requests;
begin
  if auth.uid() is null or p_upload_task_id is null or nullif(btrim(p_file_fingerprint),'') is null
     or p_last_modified is null or p_last_modified<0 or nullif(btrim(p_original_name),'') is null
     or not coalesce(public.can_write_designer_stage_deliverable(p_stage_id,p_request_id,p_storage_path),false)
     or p_content_type not in ('image/jpeg','image/png','image/webp','application/pdf')
     or p_size_bytes is null or p_size_bytes<=0 or p_size_bytes>52428800 then
    raise exception 'Upload session denied';
  end if;
  select * into r from public.designer_requests where id=p_request_id for update;
  if r.id is null or r.deleted_at is not null
     or not coalesce(public.can_write_designer_stage_deliverable(p_stage_id,p_request_id,p_storage_path),false) then
    raise exception 'Upload session denied';
  end if; IF EXISTS (SELECT 1 FROM public.designer_review_stage_state st WHERE st.stage_id = p_stage_id) THEN RAISE EXCEPTION 'Use the revision-checked review upload endpoint'; END IF; 
  insert into public.designer_stage_deliverable_upload_sessions(upload_task_id,uploaded_by,request_id,stage_id,storage_path,original_name,content_type,size_bytes,file_fingerprint,last_modified,status)
  values(p_upload_task_id,auth.uid(),p_request_id,p_stage_id,p_storage_path,left(btrim(p_original_name),255),p_content_type,p_size_bytes,p_file_fingerprint,p_last_modified,'pending') returning * into result;
  return result;
end $function$;
CREATE OR REPLACE FUNCTION public.register_designer_stage_deliverable_draft(p_upload_task_id uuid)
 RETURNS designer_stage_deliverables
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  END IF; IF EXISTS (SELECT 1 FROM public.designer_review_stage_state st WHERE st.stage_id = s.id) THEN RAISE EXCEPTION 'Use the revision-checked review registration endpoint'; END IF; 

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
$function$;

CREATE OR REPLACE FUNCTION public.request_designer_stage_deliverable_draft_delete(p_deliverable_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  END IF; IF EXISTS (SELECT 1 FROM public.designer_review_stage_state st WHERE st.stage_id = d.stage_id) THEN RAISE EXCEPTION 'Use the reference-checked review deletion endpoint'; END IF; 
  UPDATE public.designer_stage_deliverables
  SET delete_requested_at = COALESCE(delete_requested_at, now())
  WHERE id = d.id;
  RETURN d.storage_path;
END;
$function$;
CREATE OR REPLACE FUNCTION public.finalize_designer_stage_deliverable_draft_delete(p_deliverable_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  END IF; IF EXISTS (SELECT 1 FROM public.designer_review_stage_state st WHERE st.stage_id = d.stage_id) THEN RAISE EXCEPTION 'Use the reference-checked review deletion endpoint'; END IF; 
  IF EXISTS (SELECT 1 FROM storage.objects o
             WHERE o.bucket_id = 'designer-stage-deliverables'
               AND o.name = d.storage_path)
  THEN
    RAISE EXCEPTION 'Storage object still exists; draft deletion not finalized';
  END IF;
  DELETE FROM public.designer_stage_deliverables WHERE id = d.id;
END;
$function$;

COMMIT;
