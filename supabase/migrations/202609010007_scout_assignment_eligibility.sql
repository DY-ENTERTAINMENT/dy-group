insert into public.permission_items (permission_key, parent_key, name, sort_order, is_reserved)
values ('scout-assignment-eligible', 'scout', '星探指定资格', 15, false)
on conflict (permission_key) do update
set
  parent_key = excluded.parent_key,
  name = excluded.name,
  sort_order = excluded.sort_order,
  is_reserved = excluded.is_reserved;

create or replace function public.is_onboarding_scout_employee(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.employees e
    join public.profiles p on p.id = e.profile_id
    join public.job_titles jt on jt.id = e.job_title_id
    where e.id = p_employee_id
      and e.deleted_at is null
      and e.status in ('active', 'probation')
      and e.profile_id is not null
      and p.status = 'approved'
      and jt.is_active = true
      and (
        jt.name in ('TALENT SCOUT', 'TALENT SCOUT LEAD')
        or (
          not exists (
            select 1
            from public.employee_permission_overrides denied_override
            where denied_override.employee_id = e.id
              and denied_override.permission_key = 'scout-assignment-eligible'
              and denied_override.effect = 'deny'
          )
          and exists (
            select 1
            from public.employee_permission_overrides granted_override
            where granted_override.employee_id = e.id
              and granted_override.permission_key = 'scout-assignment-eligible'
              and granted_override.effect = 'grant'
              and granted_override.can_view = true
              and granted_override.can_use = true
          )
        )
      )
  );
$$;

revoke all on function public.is_onboarding_scout_employee(uuid) from public;
