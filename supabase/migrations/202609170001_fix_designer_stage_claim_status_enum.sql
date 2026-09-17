create or replace function public.claim_designer_request_stage(p_stage_id uuid)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  s public.designer_request_stages;
  eid uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into s
  from public.designer_request_stages
  where id=p_stage_id
  for update;

  if s.status<>'unclaimed'
    or not public.current_user_has_permission('designer-intake','use')
    or not public.can_access_designer_request(s.request_id) then
    raise exception 'Stage unavailable.';
  end if;

  select id into eid
  from public.employees
  where profile_id=auth.uid() and deleted_at is null
  limit 1;

  update public.designer_request_stages
  set status=(case when s.stage_type='setup' then 'scheduled' else 'in_progress' end)::public.designer_stage_status,
      assignee_profile_id=auth.uid(),
      assignee_employee_id=eid,
      accepted_at=now()
  where id=s.id;
end $$;

revoke all on function public.claim_designer_request_stage(uuid) from public, anon;
grant execute on function public.claim_designer_request_stage(uuid) to authenticated;
