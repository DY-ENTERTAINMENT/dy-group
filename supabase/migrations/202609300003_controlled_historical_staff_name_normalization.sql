begin;

create or replace function public.normalize_confirmed_historical_staff_names()
returns table (
  employee_id uuid,
  employee_number text,
  before_employee_name text,
  after_employee_name text,
  before_profile_name text,
  after_profile_name text,
  employee_changed boolean,
  profile_changed boolean,
  employee_name_normalized boolean,
  employee_profile_name_match boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_employee_count integer;
  locked_target_count integer;
  verification_failure_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  if not public.current_user_is_super_admin() then
    raise exception 'Only super_admin can normalize confirmed historical staff names.';
  end if;

  create temporary table historical_staff_name_normalization_targets
  on commit drop
  as
  select
    e.id as employee_id,
    e.profile_id,
    e.employee_code as employee_number,
    e.full_name as before_employee_name,
    public.normalize_employee_full_name(e.full_name) as after_employee_name,
    p.full_name as before_profile_name
  from public.employees e
  left join public.profiles p on p.id = e.profile_id
  where e.deleted_at is null
    and (
      e.full_name is distinct from public.normalize_employee_full_name(e.full_name)
      or (p.id is not null and p.full_name is distinct from public.normalize_employee_full_name(e.full_name))
    );

  select count(*)
  into target_employee_count
  from historical_staff_name_normalization_targets;

  if target_employee_count <> 15 then
    raise exception 'Historical staff-name normalization aborted: expected 15 target employees, found %.', target_employee_count;
  end if;

  perform 1
  from public.employees e
  join historical_staff_name_normalization_targets target on target.employee_id = e.id
  for update of e;

  select count(*)
  into locked_target_count
  from public.employees e
  join historical_staff_name_normalization_targets target on target.employee_id = e.id
  where e.deleted_at is null
    and e.profile_id is not distinct from target.profile_id
    and e.full_name is not distinct from target.before_employee_name;

  if locked_target_count <> target_employee_count then
    raise exception 'Historical staff-name normalization aborted: the target set changed while acquiring locks. Retry the review.';
  end if;

  perform 1
  from public.profiles p
  join historical_staff_name_normalization_targets target on target.profile_id = p.id
  for update;

  update public.employees e
  set full_name = target.after_employee_name
  from historical_staff_name_normalization_targets target
  where e.id = target.employee_id
    and e.deleted_at is null
    and e.full_name is distinct from target.after_employee_name;

  update public.profiles p
  set full_name = target.after_employee_name
  from historical_staff_name_normalization_targets target
  join public.employees e on e.id = target.employee_id
  where e.deleted_at is null
    and e.profile_id = target.profile_id
    and p.id = target.profile_id
    and p.full_name is distinct from target.after_employee_name;

  select count(*)
  into verification_failure_count
  from historical_staff_name_normalization_targets target
  join public.employees e on e.id = target.employee_id
  left join public.profiles p on p.id = e.profile_id
  where e.deleted_at is not null
    or e.profile_id is distinct from target.profile_id
    or e.full_name is distinct from public.normalize_employee_full_name(e.full_name)
    or (p.id is not null and p.full_name is distinct from e.full_name);

  if verification_failure_count <> 0 then
    raise exception 'Historical staff-name normalization verification failed for % employee(s).', verification_failure_count;
  end if;

  return query
  select
    target.employee_id,
    target.employee_number,
    target.before_employee_name,
    e.full_name as after_employee_name,
    target.before_profile_name,
    p.full_name as after_profile_name,
    e.full_name is distinct from target.before_employee_name as employee_changed,
    p.full_name is distinct from target.before_profile_name as profile_changed,
    e.full_name = public.normalize_employee_full_name(e.full_name) as employee_name_normalized,
    (p.id is null or p.full_name = e.full_name) as employee_profile_name_match
  from historical_staff_name_normalization_targets target
  join public.employees e on e.id = target.employee_id
  left join public.profiles p on p.id = e.profile_id
  order by target.before_employee_name, target.employee_number;
end;
$$;

revoke all on function public.normalize_confirmed_historical_staff_names() from public;
grant execute on function public.normalize_confirmed_historical_staff_names() to authenticated;

commit;
