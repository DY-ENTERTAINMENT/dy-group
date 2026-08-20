create or replace function public.sync_creator_adjustment_request()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_creator public.creator_profiles;
  target_employee public.employees;
begin
  if new.requester_employee_id is null then
    new.requester_employee_id := public.current_user_employee_id();
  end if;

  if new.creator_profile_id is null and new.platform_user_id is not null then
    select * into target_creator
    from public.creator_profiles cp
    where cp.platform = new.platform
      and cp.platform_user_id = new.platform_user_id
    limit 1;

    if target_creator.id is not null then
      new.creator_profile_id := target_creator.id;
    end if;
  end if;

  if tg_op = 'INSERT' and new.creator_profile_id is not null then
    select * into target_creator
    from public.creator_profiles cp
    where cp.id = new.creator_profile_id
    limit 1;

    if target_creator.status = 'invalid' then
      raise exception 'Invalid creator profiles cannot create adjustment requests.';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.status = 'approved' and old.status is distinct from 'approved' and new.creator_profile_id is not null then
    if new.request_type = 'to_online' then
      update public.creator_profiles set creator_type = 'online' where id = new.creator_profile_id;
    elsif new.request_type = 'to_company' then
      update public.creator_profiles set creator_type = 'company', bank_name = new.bank_name, bank_account = new.bank_account where id = new.creator_profile_id;
    elsif new.request_type = 'to_5_1' then
      update public.creator_profiles set creator_type = '5+1', bank_name = new.bank_name, bank_account = new.bank_account where id = new.creator_profile_id;
    elsif new.request_type = 'change_bank' then
      update public.creator_profiles set bank_name = new.bank_name, bank_account = new.bank_account where id = new.creator_profile_id;
    elsif new.request_type = 'change_manager' then
      select * into target_employee
      from public.employees
      where lower(email) = lower(coalesce(new.target_email, ''))
        and deleted_at is null
      limit 1;

      select * into target_creator
      from public.creator_profiles cp
      where cp.id = new.creator_profile_id
      limit 1;

      if target_employee.id is not null then
        if target_creator.creator_entity_id is not null then
          update public.creator_profiles
          set manager_employee_id = target_employee.id
          where creator_entity_id = target_creator.creator_entity_id;

          update public.creator_entities
          set manager_employee_id = target_employee.id
          where id = target_creator.creator_entity_id;
        else
          update public.creator_profiles
          set manager_employee_id = target_employee.id
          where id = new.creator_profile_id;
        end if;
      end if;
    elsif new.request_type = 'change_scout' then
      select * into target_employee from public.employees where lower(email) = lower(coalesce(new.target_email, '')) and deleted_at is null limit 1;
      update public.creator_profiles set scout_employee_id = target_employee.id, scout_profile_id = target_employee.profile_id where id = new.creator_profile_id and target_employee.id is not null;
    end if;
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  end if;

  return new;
end;
$$;
