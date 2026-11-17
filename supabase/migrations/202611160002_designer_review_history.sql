-- CANDIDATE ONLY. Not in the migration deployment directory. Do not execute automatically.
-- Depends on Production's 202611100001-011 and 202611160001; does not alter deletion approval.
BEGIN;

-- Abort atomically if the required recorded baseline or existing restrictive
-- Storage guard is missing. This does not certify the bodies of those objects.
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM (VALUES ('202611100001'),('202611100002'),('202611100003'),
   ('202611100004'),('202611100005'),('202611100006'),('202611100007'),
   ('202611100008'),('202611100009'),('202611100010'),('202611100011'),('202611160001')) AS required(version)
   WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations m WHERE m.version=required.version))
 THEN RAISE EXCEPTION 'Required designer review migration history missing'; END IF;
 IF to_regprocedure('public.designer_review_storage_select_guard(text,text)') IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='storage' AND c.relname='objects'
      AND p.polname='Review removed asset select restrictive guard' AND NOT p.polpermissive AND p.polcmd='r')
 THEN RAISE EXCEPTION 'Existing review Storage SELECT guard missing or changed'; END IF;
 IF (SELECT regexp_replace(p.prosrc, '\s+', '', 'g') FROM pg_proc p
      WHERE p.oid=to_regprocedure('public.designer_review_storage_select_guard(text,text)'))
    IS DISTINCT FROM regexp_replace($expected$
 SELECT p_bucket IS DISTINCT FROM 'designer-stage-deliverables' OR NOT EXISTS (
  SELECT 1 FROM public.designer_review_current_assets a JOIN public.designer_stage_deliverables d ON d.id=a.deliverable_id
  WHERE d.storage_path=p_path AND a.removed_at IS NOT NULL
 ) OR EXISTS (
  SELECT 1 FROM public.designer_stage_deliverables d LEFT JOIN public.designer_review_current_assets a ON a.deliverable_id=d.id
  WHERE d.storage_path=p_path AND (a.deliverable_id IS NULL OR a.removed_at IS NULL)
 );
 $expected$, '\s+', '', 'g')
 THEN RAISE EXCEPTION 'Existing review Storage SELECT guard definition changed'; END IF;
END $$;

-- History is available only to the request owner and the assigned designer.
-- Production assignees receive only the final submission for their own item.
CREATE FUNCTION public.designer_review_history_authorized(p_request uuid,p_stage uuid,p_item uuid,p_submission uuid,p_final_only boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS (
  SELECT 1 FROM public.designer_requests r
  JOIN public.designer_request_items i ON i.id=p_item AND i.request_id=r.id
  JOIN public.designer_request_stages s ON s.id=p_stage AND s.request_id=r.id AND s.request_item_id=i.id AND s.stage_type='design'
  JOIN public.designer_review_stage_state st ON st.stage_id=s.id AND st.request_id=r.id AND st.item_id=i.id
  JOIN public.designer_stage_deliverable_submissions v ON v.id=p_submission AND v.stage_id=s.id AND v.request_id=r.id
  WHERE r.id=p_request AND r.deleted_at IS NULL AND (
   (NOT p_final_only AND (r.agent_profile_id=auth.uid() OR s.assignee_profile_id=auth.uid()))
   OR (st.final_submission_id=v.id AND EXISTS (SELECT 1 FROM public.designer_request_stages prod
      WHERE prod.request_id=r.id AND prod.request_item_id=i.id AND prod.stage_type='production'
      AND prod.assignee_profile_id=auth.uid() AND prod.status NOT IN ('scheduled','cancelled')))
  )
 );
$$;
REVOKE ALL ON FUNCTION public.designer_review_history_authorized(uuid,uuid,uuid,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.read_designer_review_history(p_request_id uuid,p_stage_id uuid,p_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.designer_requests r
  JOIN public.designer_request_stages s ON s.request_id=r.id
  JOIN public.designer_request_items i ON i.id=s.request_item_id AND i.request_id=r.id
  JOIN public.designer_review_stage_state st ON st.stage_id=s.id AND st.request_id=r.id AND st.item_id=i.id
  WHERE r.id=p_request_id AND r.deleted_at IS NULL AND s.id=p_stage_id AND i.id=p_item_id
  AND s.stage_type='design' AND (r.agent_profile_id=auth.uid() OR s.assignee_profile_id=auth.uid()))
 THEN RAISE EXCEPTION 'Review history unavailable'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',v.id,'version',v.version_number,'submittedAt',v.submitted_at,
  'note',(SELECT e.note FROM public.designer_review_events e WHERE e.stage_id=v.stage_id AND e.submission_id=v.id AND e.event_type='submit' ORDER BY e.created_at DESC,e.id DESC LIMIT 1),
  'feedback',(SELECT e.note FROM public.designer_review_events e WHERE e.stage_id=v.stage_id AND e.submission_id=v.id AND e.event_type='return' ORDER BY e.created_at DESC,e.id DESC LIMIT 1),
  'isFinal',v.id=st.final_submission_id,
  'images',coalesce((SELECT jsonb_agg(jsonb_build_object('id',d.id,'originalName',d.original_name,'contentType',d.content_type,'sizeBytes',d.size_bytes,'storagePath',d.storage_path) ORDER BY d.created_at,d.id)
   FROM public.designer_review_submission_assets a JOIN public.designer_stage_deliverables d ON d.id=a.deliverable_id
   WHERE a.submission_id=v.id AND a.stage_id=v.stage_id AND d.stage_id=v.stage_id AND d.request_id=v.request_id AND d.request_item_id=p_item_id),'[]'::jsonb)) ORDER BY v.version_number DESC),'[]'::jsonb)
 INTO result FROM public.designer_stage_deliverable_submissions v JOIN public.designer_review_stage_state st ON st.stage_id=v.stage_id
 WHERE v.request_id=p_request_id AND v.stage_id=p_stage_id AND EXISTS (SELECT 1 FROM public.designer_review_events e WHERE e.stage_id=v.stage_id AND e.submission_id=v.id AND e.event_type='submit');
 RETURN result;
END $$;

CREATE FUNCTION public.read_designer_review_final_handoff(p_request_id uuid,p_stage_id uuid,p_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE sid uuid; result jsonb;
BEGIN
 SELECT st.final_submission_id INTO sid FROM public.designer_review_stage_state st WHERE st.request_id=p_request_id AND st.stage_id=p_stage_id AND st.item_id=p_item_id;
 IF sid IS NULL OR NOT public.designer_review_history_authorized(p_request_id,p_stage_id,p_item_id,sid,true) THEN RAISE EXCEPTION 'Final handoff unavailable'; END IF;
 SELECT jsonb_build_object('id',v.id,'version',v.version_number,'submittedAt',v.submitted_at,
  'images',coalesce((SELECT jsonb_agg(jsonb_build_object('id',d.id,'originalName',d.original_name,'contentType',d.content_type,'sizeBytes',d.size_bytes,'storagePath',d.storage_path) ORDER BY d.created_at,d.id)
  FROM public.designer_review_submission_assets a JOIN public.designer_stage_deliverables d ON d.id=a.deliverable_id
  WHERE a.submission_id=v.id AND a.stage_id=v.stage_id AND d.stage_id=v.stage_id AND d.request_id=v.request_id AND d.request_item_id=p_item_id),'[]'::jsonb))
 INTO result FROM public.designer_stage_deliverable_submissions v WHERE v.id=sid AND v.request_id=p_request_id AND v.stage_id=p_stage_id;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.read_designer_review_history(uuid,uuid,uuid),public.read_designer_review_final_handoff(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_designer_review_history(uuid,uuid,uuid),public.read_designer_review_final_handoff(uuid,uuid,uuid) TO authenticated;

-- Production tasks only contain their own Stage. Resolve the matching design
-- Stage on the server, then reuse the item/final-submission authorization.
CREATE FUNCTION public.read_designer_production_final_handoff(p_production_stage_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE prod public.designer_request_stages; design_id uuid; matches integer;
BEGIN
 IF auth.uid() IS NULL OR p_production_stage_id IS NULL THEN RAISE EXCEPTION 'Final handoff unavailable'; END IF;
 SELECT * INTO prod FROM public.designer_request_stages WHERE id=p_production_stage_id;
 IF prod.id IS NULL OR prod.stage_type <> 'production' OR prod.request_item_id IS NULL
    OR prod.assignee_profile_id IS DISTINCT FROM auth.uid() OR prod.status IN ('scheduled','cancelled')
 THEN RAISE EXCEPTION 'Final handoff unavailable'; END IF;
 SELECT count(*), min(s.id::text)::uuid INTO matches, design_id FROM public.designer_request_stages s
 WHERE s.request_id=prod.request_id AND s.request_item_id=prod.request_item_id AND s.stage_type='design';
 IF matches <> 1 THEN RAISE EXCEPTION 'Final handoff unavailable'; END IF;
 RETURN public.read_designer_review_final_handoff(prod.request_id,design_id,prod.request_item_id);
END $$;
REVOKE ALL ON FUNCTION public.read_designer_production_final_handoff(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_designer_production_final_handoff(uuid) TO authenticated;

CREATE FUNCTION public.designer_review_can_read_submitted_object(p_bucket text,p_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT p_bucket='designer-stage-deliverables' AND EXISTS (
  SELECT 1 FROM public.designer_review_submission_assets a
  JOIN public.designer_stage_deliverables d ON d.id=a.deliverable_id AND d.stage_id=a.stage_id
  JOIN public.designer_review_stage_state st ON st.stage_id=a.stage_id AND st.request_id=d.request_id AND st.item_id=d.request_item_id
  WHERE d.storage_path=p_path AND public.designer_review_history_authorized(st.request_id,st.stage_id,st.item_id,a.submission_id,false)
 );
$$;
REVOKE ALL ON FUNCTION public.designer_review_can_read_submitted_object(text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.designer_review_can_read_submitted_object(text,text) TO authenticated;
-- A permissive policy is required in addition to the existing restrictive guard.
CREATE POLICY "Review submitted history scoped read" ON storage.objects FOR SELECT TO authenticated
 USING (public.designer_review_can_read_submitted_object(bucket_id,name));
CREATE OR REPLACE FUNCTION public.designer_review_storage_select_guard(p_bucket text,p_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT p_bucket IS DISTINCT FROM 'designer-stage-deliverables'
 OR public.designer_review_can_read_submitted_object(p_bucket,p_path)
 OR NOT EXISTS (SELECT 1 FROM public.designer_review_current_assets a JOIN public.designer_stage_deliverables d ON d.id=a.deliverable_id WHERE d.storage_path=p_path AND a.removed_at IS NOT NULL)
 OR EXISTS (SELECT 1 FROM public.designer_stage_deliverables d LEFT JOIN public.designer_review_current_assets a ON a.deliverable_id=d.id WHERE d.storage_path=p_path AND (a.deliverable_id IS NULL OR a.removed_at IS NULL));
$$;

-- Block object overwrites/deletes for any submitted review member, independently
-- of mutable deliverable.submission_id; leave other buckets and legacy paths alone.
CREATE FUNCTION public.designer_review_submitted_object_writable(p_bucket text,p_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT p_bucket IS DISTINCT FROM 'designer-stage-deliverables' OR NOT EXISTS (
  SELECT 1 FROM public.designer_review_submission_assets a JOIN public.designer_stage_deliverables d ON d.id=a.deliverable_id WHERE d.storage_path=p_path);
$$;
REVOKE ALL ON FUNCTION public.designer_review_submitted_object_writable(text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.designer_review_submitted_object_writable(text,text) TO authenticated;
CREATE POLICY "Review submitted objects immutable update" ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
 USING (public.designer_review_submitted_object_writable(bucket_id,name)) WITH CHECK (public.designer_review_submitted_object_writable(bucket_id,name));
CREATE POLICY "Review submitted objects immutable delete" ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
 USING (public.designer_review_submitted_object_writable(bucket_id,name));

-- Lock the final snapshot and its registered asset rows even if a legacy RPC
-- attempts to mutate them. The transition which first sets final is unaffected.
CREATE FUNCTION public.guard_designer_review_final_snapshot() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_TABLE_NAME='designer_review_stage_state' THEN
  IF OLD.final_submission_id IS NOT NULL AND (TG_OP='DELETE' OR NEW IS DISTINCT FROM OLD) THEN RAISE EXCEPTION 'Final review is immutable'; END IF;
 ELSIF TG_TABLE_NAME='designer_review_submission_assets' THEN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Submitted review membership is immutable'; END IF;
  IF EXISTS (SELECT 1 FROM public.designer_review_events e WHERE e.stage_id=NEW.stage_id AND e.submission_id=NEW.submission_id AND e.event_type='submit')
     OR EXISTS (SELECT 1 FROM public.designer_review_stage_state st WHERE st.final_submission_id=NEW.submission_id)
     OR NOT EXISTS (SELECT 1 FROM public.designer_review_stage_state st
       JOIN public.designer_stage_deliverable_submissions v ON v.id=NEW.submission_id AND v.stage_id=st.stage_id AND v.request_id=st.request_id
       JOIN public.designer_stage_deliverables d ON d.id=NEW.deliverable_id AND d.stage_id=st.stage_id AND d.request_id=st.request_id AND d.request_item_id=st.item_id
       JOIN public.designer_review_current_assets a ON a.stage_id=st.stage_id AND a.deliverable_id=d.id AND a.removed_at IS NULL
       WHERE st.stage_id=NEW.stage_id)
  THEN RAISE EXCEPTION 'Submitted review membership is invalid or immutable'; END IF;
 ELSIF TG_TABLE_NAME='designer_stage_deliverables' THEN
  IF EXISTS (SELECT 1 FROM public.designer_review_submission_assets a WHERE a.deliverable_id=OLD.id) THEN
   IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Submitted review asset is immutable'; END IF;
   -- Existing submission RPC deliberately rebinds submission_id after it has
   -- inserted the new membership. Preserve that operation, and nothing else.
   IF (to_jsonb(NEW) - 'submission_id') IS DISTINCT FROM (to_jsonb(OLD) - 'submission_id')
      OR NEW.submission_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.designer_review_submission_assets a
        WHERE a.deliverable_id=OLD.id AND a.stage_id=OLD.stage_id AND a.submission_id=NEW.submission_id)
      OR EXISTS (SELECT 1 FROM public.designer_review_submission_assets a JOIN public.designer_review_stage_state st ON st.final_submission_id=a.submission_id WHERE a.deliverable_id=OLD.id)
   THEN RAISE EXCEPTION 'Submitted review asset is immutable'; END IF;
  END IF;
 ELSIF TG_TABLE_NAME='designer_stage_deliverable_submissions' THEN
  IF EXISTS (SELECT 1 FROM public.designer_review_submission_assets a WHERE a.submission_id=OLD.id) THEN RAISE EXCEPTION 'Submitted review version is immutable'; END IF;
 ELSIF TG_TABLE_NAME='designer_review_current_assets' THEN
  IF TG_OP <> 'INSERT' AND EXISTS (SELECT 1 FROM public.designer_review_stage_state st WHERE st.stage_id=OLD.stage_id AND st.final_submission_id IS NOT NULL) THEN RAISE EXCEPTION 'Final review is immutable'; END IF;
  IF TG_OP <> 'DELETE' AND EXISTS (SELECT 1 FROM public.designer_review_stage_state st WHERE st.stage_id=NEW.stage_id AND st.final_submission_id IS NOT NULL) THEN RAISE EXCEPTION 'Final review is immutable'; END IF;
 ELSIF TG_TABLE_NAME='designer_request_stages' THEN
  IF OLD.status='completed' AND EXISTS (SELECT 1 FROM public.designer_review_stage_state st WHERE st.stage_id=OLD.id AND st.final_submission_id IS NOT NULL) THEN RAISE EXCEPTION 'Final review is immutable'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_designer_review_final_snapshot() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER review_final_state_immutable BEFORE UPDATE OR DELETE ON public.designer_review_stage_state FOR EACH ROW EXECUTE FUNCTION public.guard_designer_review_final_snapshot();
CREATE TRIGGER review_final_members_immutable BEFORE INSERT OR UPDATE OR DELETE ON public.designer_review_submission_assets FOR EACH ROW EXECUTE FUNCTION public.guard_designer_review_final_snapshot();
CREATE TRIGGER review_final_deliverable_immutable BEFORE UPDATE OR DELETE ON public.designer_stage_deliverables FOR EACH ROW EXECUTE FUNCTION public.guard_designer_review_final_snapshot();
CREATE TRIGGER review_final_submission_immutable BEFORE UPDATE OR DELETE ON public.designer_stage_deliverable_submissions FOR EACH ROW EXECUTE FUNCTION public.guard_designer_review_final_snapshot();
CREATE TRIGGER review_final_current_immutable BEFORE INSERT OR UPDATE OR DELETE ON public.designer_review_current_assets FOR EACH ROW EXECUTE FUNCTION public.guard_designer_review_final_snapshot();
CREATE TRIGGER review_final_stage_immutable BEFORE UPDATE OR DELETE ON public.designer_request_stages FOR EACH ROW EXECUTE FUNCTION public.guard_designer_review_final_snapshot();
COMMIT;
