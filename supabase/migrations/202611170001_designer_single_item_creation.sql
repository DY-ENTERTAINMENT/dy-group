-- Candidate: future single-item requests only; no historical backfill.
BEGIN;
create function public.create_designer_single_item_internal(
  p_creator_profile_id uuid,
  p_work_mode public.designer_work_mode,
  p_request_type public.design_request_type,
  p_task_type text,
  p_other_design_type text,
  p_event_start_at timestamptz default null,
  p_event_end_at timestamptz default null,
  p_design_content text default null,
  p_style text default null,
  p_color text default null,
  p_specification text default null,
  p_special_content text default null,
  p_reference_material_status text default 'not_required',
  p_live_room text default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c public.creator_profiles;
  rid uuid;
  eid uuid;
  st public.designer_stage_type;
  iid uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.current_user_has_permission('agent-design-requests', 'use') then
    raise exception 'Permission denied.';
  end if;

  select * into c
  from public.creator_profiles
  where id = p_creator_profile_id and status = 'active';

  if c.id is null or not public.current_user_can_access_region(c.region_id) then
    raise exception 'Creator access denied.';
  end if;

  if p_task_type is null or p_task_type not in ('daily', 'activity') then
    raise exception 'Invalid task type.';
  end if;

  if p_request_type = 'special'
    and nullif(btrim(coalesce(p_other_design_type, '')), '') is null then
    raise exception 'Other design type is required.';
  end if;

  if p_reference_material_status not in ('not_required', 'provided') then
    raise exception 'Invalid reference material status.';
  end if;

  select id into eid
  from public.employees
  where profile_id = auth.uid() and deleted_at is null
  limit 1;

  insert into public.designer_requests(
    agent_profile_id,
    agent_employee_id,
    creator_profile_id,
    creator_entity_id,
    region_id,
    work_mode,
    request_type,
    task_type,
    other_design_type,
    platform,
    platform_user_id,
    creator_name,
    platform_account,
    event_start_at,
    event_end_at,
    design_content,
    style,
    color,
    specification,
    special_content,
    reference_material_status,
    live_room
  ) values (
    auth.uid(),
    eid,
    c.id,
    c.creator_entity_id,
    c.region_id,
    p_work_mode,
    p_request_type,
    p_task_type,
    case when p_request_type = 'special' then btrim(p_other_design_type) else null end,
    c.platform,
    c.platform_user_id,
    c.creator_name,
    c.platform_account,
    p_event_start_at,
    p_event_end_at,
    p_design_content,
    p_style,
    p_color,
    p_specification,
    p_special_content,
    p_reference_material_status,
    p_live_room
  ) returning id into rid;

  insert into public.designer_request_items(request_id,item_type,item_name,content,special_content,style,color,specification,sort_order)
  values (rid, case when p_work_mode='setup_only' then 'setup' when p_request_type='special' then 'other' else p_request_type::text end,
    case when p_work_mode <> 'setup_only' and p_request_type='special' then btrim(p_other_design_type) else null end,
    p_design_content,p_special_content,p_style,p_color,p_specification,0) returning id into iid;
  st := case when p_work_mode = 'setup_only' then 'setup' else 'design' end;
  insert into public.designer_request_stages(request_id,request_item_id,stage_type) values (rid,iid,st);

  if p_work_mode = 'design_production' then
    insert into public.designer_request_stages(request_id, request_item_id, stage_type, status) values (rid, iid, 'production', 'scheduled');
  end if;

  return rid;
end;
$$;

REVOKE ALL ON FUNCTION public.create_designer_single_item_internal(uuid,public.designer_work_mode,public.design_request_type,text,text,timestamptz,timestamptz,text,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;

create or replace function public.update_designer_request(p_request_id uuid,p_task_type text,p_request_type public.design_request_type,p_other_design_type text,p_event_start_at timestamptz default null,p_event_end_at timestamptz default null,p_design_content text default null,p_special_content text default null,p_style text default null,p_color text default null,p_specification text default null,p_live_room text default null,p_reference_material_status text default 'not_required') returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.designer_requests; s public.designer_request_stages; item_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into r from public.designer_requests where id=p_request_id for update;
  if r.id is null or r.agent_profile_id<>auth.uid() or r.status<>'unclaimed' then raise exception 'Request cannot be edited.'; end if;
  for s in select * from public.designer_request_stages where request_id=r.id for update loop
    if s.assignee_profile_id is not null or s.accepted_at is not null or s.status not in ('unclaimed','scheduled') then raise exception 'Request has already started.'; end if;
  end loop;
  if p_task_type is null or p_task_type not in ('daily','activity') then raise exception 'Invalid task type.'; end if;
  if p_request_type='special' and nullif(btrim(coalesce(p_other_design_type,'')),'') is null then raise exception 'Other design type is required.'; end if;
  if p_reference_material_status not in ('not_required','provided') then raise exception 'Invalid reference material status.'; end if;
  select count(*) into item_count from public.designer_request_items where request_id=r.id;
  if item_count > 0 and (item_count <> 1 or r.work_mode is null) then raise exception 'Only single-item requests can be edited here.'; end if;
  if item_count = 1 then
    update public.designer_request_items set
      item_type=case when r.work_mode='setup_only' then 'setup' when p_request_type='special' then 'other' else p_request_type::text end,
      item_name=case when r.work_mode<>'setup_only' and p_request_type='special' then btrim(p_other_design_type) else null end,
      content=p_design_content,special_content=p_special_content,style=p_style,color=p_color,specification=p_specification
    where request_id=r.id;
  end if;
  update public.designer_requests set task_type=p_task_type,request_type=p_request_type,other_design_type=case when p_request_type='special' then btrim(p_other_design_type) else null end,event_start_at=p_event_start_at,event_end_at=p_event_end_at,design_content=p_design_content,special_content=p_special_content,style=p_style,color=p_color,specification=p_specification,live_room=p_live_room,reference_material_status=p_reference_material_status where id=r.id;
end $$;


-- A unique operation is locked and recorded in the same transaction as creation.
-- The table is private; the RPC checks both the caller and the complete typed payload.
CREATE TABLE public.designer_single_create_operations (
  operation_id uuid PRIMARY KEY,
  actor_profile_id uuid NOT NULL,
  request_id uuid NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.designer_single_create_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.designer_single_create_operations FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.create_designer_single_item_idempotent(
  p_operation_id uuid, p_creator_profile_id uuid, p_work_mode public.designer_work_mode,
  p_request_type public.design_request_type, p_task_type text, p_other_design_type text,
  p_event_start_at timestamptz DEFAULT NULL, p_event_end_at timestamptz DEFAULT NULL,
  p_design_content text DEFAULT NULL, p_style text DEFAULT NULL, p_color text DEFAULT NULL,
  p_specification text DEFAULT NULL, p_special_content text DEFAULT NULL,
  p_reference_material_status text DEFAULT 'not_required', p_live_room text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE op public.designer_single_create_operations; rid uuid; args jsonb;
BEGIN
  IF auth.uid() IS NULL OR p_operation_id IS NULL OR NOT public.current_user_has_permission('agent-design-requests','use') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  args := jsonb_build_array(p_creator_profile_id,p_work_mode,p_request_type,p_task_type,p_other_design_type,
    extract(epoch from p_event_start_at),extract(epoch from p_event_end_at),p_design_content,p_style,p_color,p_specification,p_special_content,p_reference_material_status,p_live_room);
  PERFORM pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  SELECT * INTO op FROM public.designer_single_create_operations WHERE operation_id=p_operation_id;
  IF FOUND THEN
    IF op.actor_profile_id IS DISTINCT FROM auth.uid() OR op.payload IS DISTINCT FROM args THEN
      RAISE EXCEPTION 'Operation already used with different request';
    END IF;
    RETURN op.request_id;
  END IF;
  rid := public.create_designer_single_item_internal(p_creator_profile_id,p_work_mode,p_request_type,p_task_type,p_other_design_type,
    p_event_start_at,p_event_end_at,p_design_content,p_style,p_color,p_specification,p_special_content,p_reference_material_status,p_live_room);
  INSERT INTO public.designer_single_create_operations(operation_id,actor_profile_id,request_id,payload)
    VALUES(p_operation_id,auth.uid(),rid,args);
  RETURN rid;
END $$;
REVOKE ALL ON FUNCTION public.create_designer_single_item_idempotent(uuid,uuid,public.designer_work_mode,public.design_request_type,text,text,timestamptz,timestamptz,text,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_designer_single_item_idempotent(uuid,uuid,public.designer_work_mode,public.design_request_type,text,text,timestamptz,timestamptz,text,text,text,text,text,text,text) TO authenticated;

-- Keep the installed legacy implementation intact behind a guarded public entry.
ALTER FUNCTION public.submit_designer_request_stage(uuid,text) RENAME TO submit_designer_request_stage_before_item_guard;
REVOKE ALL ON FUNCTION public.submit_designer_request_stage_before_item_guard(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.submit_designer_request_stage(p_stage_id uuid,p_feedback text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF EXISTS (SELECT 1 FROM public.designer_request_stages s WHERE s.id=p_stage_id AND s.stage_type='design' AND s.request_item_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Use design review submission';
  END IF;
  PERFORM public.submit_designer_request_stage_before_item_guard(p_stage_id,p_feedback);
END $$;
REVOKE ALL ON FUNCTION public.submit_designer_request_stage(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.submit_designer_request_stage(uuid,text) TO authenticated, service_role;

COMMIT;
