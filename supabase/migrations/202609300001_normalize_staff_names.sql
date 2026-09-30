begin;

create or replace function public.normalize_employee_full_name(value text)
returns text
language plpgsql
immutable
as $$
declare
  normalized_value text := regexp_replace(btrim(coalesce(value, '')), '\s+', ' ', 'g');
  word text;
  normalized_word text;
begin
  if normalized_value = '' then
    raise exception '工作人员姓名不能为空';
  end if;

  normalized_value := '';
  foreach word in array string_to_array(regexp_replace(btrim(coalesce(value, '')), '\s+', ' ', 'g'), ' ')
  loop
    normalized_word := lower(word);
    normalized_value := concat_ws(' ', normalized_value, upper(left(normalized_word, 1)) || substr(normalized_word, 2));
  end loop;

  return normalized_value;
end;
$$;

create or replace function public.normalize_employee_name_on_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.full_name := public.normalize_employee_full_name(new.full_name);

  if old.profile_id is not null then
    update public.profiles
    set full_name = new.full_name
    where id = old.profile_id
      and full_name is distinct from new.full_name;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_normalize_employee_name_on_write on public.employees;
create trigger trg_normalize_employee_name_on_write
before update of full_name on public.employees
for each row
when (old.full_name is distinct from new.full_name and new.profile_id is not distinct from old.profile_id)
execute function public.normalize_employee_name_on_write();

revoke all on function public.normalize_employee_name_on_write() from public;
revoke all on function public.normalize_employee_full_name(text) from public;

create or replace function public.approve_registration_with_employee(
  profile_id uuid,
  employment_type_id uuid,
  job_title_id uuid,
  employee_status public.employee_status,
  hire_date date,
  start_work_time time,
  end_work_time time,
  require_attendance boolean,
  base_salary numeric default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_profile public.profiles;
  employee_id uuid;
  next_employee_code text;
  normalized_employee_name text;
begin
  if not public.current_user_has_permission('registration-review', 'use') then
    raise exception 'No permission to approve registration applications.';
  end if;

  select p.* into target_profile from public.profiles p
  where p.id = approve_registration_with_employee.profile_id and p.status = 'pending_review' limit 1;

  if target_profile.id is null then raise exception 'Registration application does not exist or has already been processed.'; end if;
  if not public.current_user_can_access_region(target_profile.region_id) then raise exception 'No permission to approve registration applications in this region.'; end if;
  if target_profile.region_id is null or employment_type_id is null or job_title_id is null or employee_status is null or hire_date is null or start_work_time is null or end_work_time is null then
    raise exception 'Please complete all employee onboarding information.';
  end if;

  normalized_employee_name := public.normalize_employee_full_name(target_profile.full_name);

  update public.profiles set status = 'approved', full_name = normalized_employee_name, reviewed_by = auth.uid(), reviewed_at = now(), review_note = null, updated_at = now()
  where id = target_profile.id;

  select e.id into employee_id from public.employees e
  where e.profile_id = target_profile.id or (e.email is not null and lower(e.email) = lower(target_profile.email))
  order by e.created_at asc limit 1;

  if employee_id is null then
    next_employee_code := public.generate_employee_code(target_profile.region_id);
    insert into public.employees (profile_id, employee_code, full_name, nickname, email, phone, gender, birthday, identity_number, region_id, employment_type_id, job_title_id, status, hire_date, start_work_time, end_work_time, require_attendance, base_salary, reviewed_by, reviewed_at)
    values (target_profile.id, next_employee_code, normalized_employee_name, target_profile.nickname, target_profile.email, target_profile.phone, target_profile.gender, target_profile.birthday, target_profile.identity_number, target_profile.region_id, approve_registration_with_employee.employment_type_id, approve_registration_with_employee.job_title_id, approve_registration_with_employee.employee_status, approve_registration_with_employee.hire_date, approve_registration_with_employee.start_work_time, approve_registration_with_employee.end_work_time, coalesce(approve_registration_with_employee.require_attendance, true), approve_registration_with_employee.base_salary, auth.uid(), now());
  else
    select coalesce(e.employee_code, public.generate_employee_code(target_profile.region_id)) into next_employee_code from public.employees e where e.id = employee_id;
    update public.employees set profile_id = target_profile.id, employee_code = next_employee_code, full_name = normalized_employee_name, nickname = target_profile.nickname, email = target_profile.email, phone = target_profile.phone, gender = target_profile.gender, birthday = target_profile.birthday, identity_number = target_profile.identity_number, region_id = target_profile.region_id, employment_type_id = approve_registration_with_employee.employment_type_id, job_title_id = approve_registration_with_employee.job_title_id, status = approve_registration_with_employee.employee_status, hire_date = approve_registration_with_employee.hire_date, start_work_time = approve_registration_with_employee.start_work_time, end_work_time = approve_registration_with_employee.end_work_time, require_attendance = coalesce(approve_registration_with_employee.require_attendance, true), base_salary = approve_registration_with_employee.base_salary, reviewed_by = auth.uid(), reviewed_at = now(), deleted_at = null, updated_at = now()
    where id = employee_id;
  end if;
end;
$$;

commit;
