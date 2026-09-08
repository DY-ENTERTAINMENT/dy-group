begin;

insert into public.permission_items (permission_key, parent_key, name, sort_order, is_reserved)
values ('creator-adjustment-review', null, '主播资料调整审批', 98, false)
on conflict (permission_key) do nothing;

insert into public.job_title_permission_templates (job_title_id, permission_key, can_view, can_use)
select jt.id, 'creator-adjustment-review', true, true
from public.job_titles jt
where jt.name = 'HR ADMIN'
on conflict (job_title_id, permission_key) do nothing;

create or replace function public.current_user_can_review_creator_adjustment(
  p_creator_profile_id uuid,
  p_action text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  target_region_id uuid;
begin
  if not public.current_user_has_permission('creator-adjustment-review', p_action) then
    return false;
  end if;

  if public.current_user_is_super_admin() then
    return true;
  end if;

  if p_creator_profile_id is null then
    return false;
  end if;

  select cp.region_id
  into target_region_id
  from public.creator_profiles cp
  where cp.id = p_creator_profile_id;

  return target_region_id is not null
    and public.current_user_can_access_region(target_region_id);
end;
$$;

revoke all on function public.current_user_can_review_creator_adjustment(uuid, text) from public;
grant execute on function public.current_user_can_review_creator_adjustment(uuid, text) to authenticated;

drop policy if exists "Agents can read own adjustment requests" on public.creator_adjustment_requests;
create policy "Agents can read own adjustment requests"
on public.creator_adjustment_requests for select to authenticated
using (
  requester_profile_id = auth.uid()
  or public.current_user_can_review_creator_adjustment(creator_profile_id, 'view')
);

drop policy if exists "Managers can review adjustment requests" on public.creator_adjustment_requests;
create policy "Managers can review adjustment requests"
on public.creator_adjustment_requests for update to authenticated
using (
  public.current_user_can_review_creator_adjustment(creator_profile_id, 'use')
)
with check (
  public.current_user_can_review_creator_adjustment(creator_profile_id, 'use')
);

commit;
