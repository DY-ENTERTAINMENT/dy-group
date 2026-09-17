-- 美工申请 Phase 1：仅允许原申请人在任何阶段开始前修改或取消。
create or replace function public.update_designer_request(p_request_id uuid,p_task_type text,p_request_type public.design_request_type,p_other_design_type text,p_event_start_at timestamptz default null,p_event_end_at timestamptz default null,p_design_content text default null,p_special_content text default null,p_style text default null,p_color text default null,p_specification text default null,p_live_room text default null,p_reference_material_status text default 'not_required') returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.designer_requests; s public.designer_request_stages;
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
  update public.designer_requests set task_type=p_task_type,request_type=p_request_type,other_design_type=case when p_request_type='special' then btrim(p_other_design_type) else null end,event_start_at=p_event_start_at,event_end_at=p_event_end_at,design_content=p_design_content,special_content=p_special_content,style=p_style,color=p_color,specification=p_specification,live_room=p_live_room,reference_material_status=p_reference_material_status where id=r.id;
end $$;

create or replace function public.cancel_designer_request(p_request_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.designer_requests; s public.designer_request_stages;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into r from public.designer_requests where id=p_request_id for update;
  if r.id is null or r.agent_profile_id<>auth.uid() or r.status<>'unclaimed' then raise exception 'Request cannot be cancelled.'; end if;
  for s in select * from public.designer_request_stages where request_id=r.id for update loop
    if s.assignee_profile_id is not null or s.accepted_at is not null or s.status not in ('unclaimed','scheduled') then raise exception 'Request has already started.'; end if;
  end loop;
  update public.designer_request_stages set status='cancelled' where request_id=r.id and status in ('unclaimed','scheduled');
  update public.designer_requests set status='cancelled' where id=r.id;
end $$;

revoke all on function public.update_designer_request(uuid,text,public.design_request_type,text,timestamptz,timestamptz,text,text,text,text,text,text,text) from public, anon;
revoke all on function public.cancel_designer_request(uuid) from public, anon;
grant execute on function public.update_designer_request(uuid,text,public.design_request_type,text,timestamptz,timestamptz,text,text,text,text,text,text,text),public.cancel_designer_request(uuid) to authenticated;
