-- 美工申请 Phase 1 补充：任务类型与设计类型分离；历史记录保持 NULL。
alter table public.designer_requests
  add column if not exists task_type text check (task_type is null or task_type in ('daily', 'activity')),
  add column if not exists other_design_type text check (other_design_type is null or btrim(other_design_type) <> '');

-- 保留旧 overload 以避免删除潜在依赖，但禁止客户端继续使用它绕过新字段校验。
revoke all on function public.create_designer_request(uuid, public.designer_work_mode, public.design_request_type, timestamptz, timestamptz, text, text, text, text, text, text, text) from public, anon, authenticated;

create or replace function public.create_designer_request(
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

  st := case when p_work_mode = 'setup_only' then 'setup' else 'design' end;
  insert into public.designer_request_stages(request_id, stage_type) values (rid, st);

  if p_work_mode = 'design_production' then
    insert into public.designer_request_stages(request_id, stage_type, status)
    values (rid, 'production', 'scheduled');
  end if;

  return rid;
end;
$$;

revoke all on function public.create_designer_request(uuid, public.designer_work_mode, public.design_request_type, text, text, timestamptz, timestamptz, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.create_designer_request(uuid, public.designer_work_mode, public.design_request_type, text, text, timestamptz, timestamptz, text, text, text, text, text, text, text) to authenticated;
