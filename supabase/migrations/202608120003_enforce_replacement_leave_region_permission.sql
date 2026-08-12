begin;

create or replace function public.enforce_replacement_leave_region_permission()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.leave_type = 'replacement'
     and not public.current_user_has_region_feature_permission('replacement-leave', 'use') then
    raise exception '当前地区暂未开放调休申请。'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_replacement_leave_region_permission
on public.leave_requests;

create trigger trg_enforce_replacement_leave_region_permission
before insert or update of leave_type
on public.leave_requests
for each row
execute function public.enforce_replacement_leave_region_permission();

revoke all on function public.enforce_replacement_leave_region_permission() from public;
grant execute on function public.enforce_replacement_leave_region_permission() to authenticated, service_role;

commit;
