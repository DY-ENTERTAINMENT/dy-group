-- Per-stage rollout: no automatic enrollment or historical conversion.
BEGIN;
CREATE TABLE public.designer_review_rollout_boundary (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 installed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO public.designer_review_rollout_boundary(singleton) VALUES (true);
ALTER TABLE public.designer_review_rollout_boundary ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.designer_review_rollout_boundary FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE public.designer_review_activation_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 stage_id uuid NOT NULL REFERENCES public.designer_request_stages(id),
 request_id uuid NOT NULL REFERENCES public.designer_requests(id),
 item_id uuid NOT NULL REFERENCES public.designer_request_items(id),
 actor_profile_id uuid NOT NULL REFERENCES public.profiles(id),
 action text NOT NULL CHECK (action IN ('enable','pause')),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.designer_review_activation_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.designer_review_activation_events FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.get_designer_review_stage_mode(p_request_id uuid,p_stage_id uuid,p_item_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $function$
DECLARE r public.designer_requests; s public.designer_request_stages; st public.designer_review_stage_state;
BEGIN
 IF auth.uid() IS NULL OR p_request_id IS NULL OR p_stage_id IS NULL OR p_item_id IS NULL THEN RAISE EXCEPTION 'Invalid stage'; END IF;
 SELECT * INTO r FROM public.designer_requests WHERE id=p_request_id FOR SHARE;
 SELECT * INTO s FROM public.designer_request_stages WHERE id=p_stage_id FOR SHARE;
 IF r.id IS NULL OR r.deleted_at IS NOT NULL OR s.id IS NULL OR s.request_id IS DISTINCT FROM r.id
 OR s.stage_type <> 'design' OR s.request_item_id IS DISTINCT FROM p_item_id
 OR NOT EXISTS (SELECT 1 FROM public.designer_request_items i WHERE i.id=p_item_id AND i.request_id=r.id)
 OR (r.agent_profile_id IS DISTINCT FROM auth.uid() AND s.assignee_profile_id IS DISTINCT FROM auth.uid()
     AND NOT coalesce(public.current_user_is_super_admin(),false))
 THEN RAISE EXCEPTION 'Stage unavailable'; END IF;
 SELECT * INTO st FROM public.designer_review_stage_state WHERE stage_id=s.id FOR SHARE;
 IF st.stage_id IS NULL THEN RETURN 'off'; END IF;
 IF st.request_id IS DISTINCT FROM r.id OR st.item_id IS DISTINCT FROM p_item_id THEN RAISE EXCEPTION 'Stage mismatch'; END IF;
 IF st.is_active THEN RETURN 'active'; END IF;
 RETURN 'paused';
END;
$function$;

CREATE FUNCTION public.set_designer_review_stage_active(p_request_id uuid,p_stage_id uuid,p_item_id uuid,p_active boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $function$
DECLARE r public.designer_requests; s public.designer_request_stages; st public.designer_review_stage_state; boundary timestamptz;
BEGIN
 IF auth.uid() IS NULL OR NOT coalesce(public.current_user_is_super_admin(),false)
 OR NOT EXISTS (SELECT 1 FROM public.profiles admin WHERE admin.id=auth.uid()
   AND admin.status='approved' AND admin.role='super_admin')
 THEN RAISE EXCEPTION 'Administrator required'; END IF;
 IF p_request_id IS NULL OR p_stage_id IS NULL OR p_item_id IS NULL OR p_active IS NULL THEN RAISE EXCEPTION 'Invalid stage'; END IF;
 SELECT * INTO r FROM public.designer_requests WHERE id=p_request_id FOR UPDATE;
 SELECT * INTO s FROM public.designer_request_stages WHERE id=p_stage_id FOR UPDATE;
 IF r.id IS NULL OR r.deleted_at IS NOT NULL OR s.id IS NULL OR s.request_id IS DISTINCT FROM r.id
 OR s.stage_type <> 'design' OR s.request_item_id IS DISTINCT FROM p_item_id
 OR NOT EXISTS (SELECT 1 FROM public.designer_request_items i WHERE i.id=p_item_id AND i.request_id=r.id)
 THEN RAISE EXCEPTION 'Stage mismatch'; END IF;
 SELECT * INTO st FROM public.designer_review_stage_state WHERE stage_id=s.id FOR UPDATE;
 IF st.stage_id IS NOT NULL AND (st.request_id IS DISTINCT FROM r.id OR st.item_id IS DISTINCT FROM p_item_id)
 THEN RAISE EXCEPTION 'Stage state mismatch'; END IF;
 IF p_active THEN
   IF r.status IN ('completed','cancelled') OR s.status NOT IN ('in_progress','revision','awaiting_agent_confirmation')
      OR s.assignee_profile_id IS NULL OR st.final_submission_id IS NOT NULL THEN RAISE EXCEPTION 'Stage cannot be enabled'; END IF;
   IF st.stage_id IS NULL THEN
     SELECT installed_at INTO boundary FROM public.designer_review_rollout_boundary WHERE singleton;
     IF boundary IS NULL OR r.created_at IS NULL OR r.created_at < boundary OR s.status <> 'in_progress'
       OR EXISTS (SELECT 1 FROM public.designer_stage_deliverables d WHERE d.stage_id=s.id)
       OR EXISTS (SELECT 1 FROM public.designer_stage_deliverable_submissions v WHERE v.stage_id=s.id)
       OR EXISTS (SELECT 1 FROM public.designer_stage_deliverable_upload_sessions u WHERE u.stage_id=s.id)
     THEN RAISE EXCEPTION 'Only new unconverted stages may be enabled'; END IF;
     INSERT INTO public.designer_review_stage_state(stage_id,request_id,item_id,is_active)
       VALUES(s.id,r.id,p_item_id,true);
   ELSIF st.is_active THEN RETURN;
   ELSE UPDATE public.designer_review_stage_state SET is_active=true,updated_at=now() WHERE stage_id=s.id;
   END IF;
 ELSE
   IF st.stage_id IS NULL OR NOT st.is_active THEN RETURN; END IF;
   UPDATE public.designer_review_stage_state SET is_active=false,updated_at=now() WHERE stage_id=s.id;
 END IF;
 INSERT INTO public.designer_review_activation_events(stage_id,request_id,item_id,actor_profile_id,action)
 VALUES(s.id,r.id,p_item_id,auth.uid(),CASE WHEN p_active THEN 'enable' ELSE 'pause' END);
END;
$function$;
REVOKE ALL ON FUNCTION public.get_designer_review_stage_mode(uuid,uuid,uuid),
 public.set_designer_review_stage_active(uuid,uuid,uuid,boolean) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.enable_designer_review_stage(p_request_id uuid,p_stage_id uuid,p_item_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $function$
 SELECT public.set_designer_review_stage_active(p_request_id,p_stage_id,p_item_id,true);
$function$;
CREATE FUNCTION public.pause_designer_review_stage(p_request_id uuid,p_stage_id uuid,p_item_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $function$
 SELECT public.set_designer_review_stage_active(p_request_id,p_stage_id,p_item_id,false);
$function$;
REVOKE ALL ON FUNCTION public.enable_designer_review_stage(uuid,uuid,uuid), public.pause_designer_review_stage(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_designer_review_stage_mode(uuid,uuid,uuid), public.enable_designer_review_stage(uuid,uuid,uuid), public.pause_designer_review_stage(uuid,uuid,uuid) TO authenticated;
COMMIT;
