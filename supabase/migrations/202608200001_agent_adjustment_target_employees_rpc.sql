create or replace function public.get_agent_adjustment_target_employees(
  p_target_type text
)
returns table (
  id uuid,
  employee_code text,
  full_name text,
  nickname text,
  email text,
  region_id uuid
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  target_permission_key text;
begin
  if p_target_type not in ('manager', 'scout') then
    raise exception 'Unsupported adjustment target type: %', p_target_type
      using errcode = '22023';
  end if;

  if not (
    public.current_user_has_permission('agent-adjustment-requests', 'use')
    or public.current_user_has_permission('management-streamer-stats', 'use')
  ) then
    raise exception 'Permission denied'
      using errcode = '42501';
  end if;

  target_permission_key := case
    when p_target_type = 'manager' then 'agent-creator-data'
    else 'scout-recruiting-data'
  end;

  return query
  with recursive applicable_permissions as (
    select pi.permission_key, pi.parent_key
    from public.permission_items pi
    where pi.permission_key = target_permission_key
      and pi.is_active = true

    union all

    select parent.permission_key, parent.parent_key
    from public.permission_items parent
    join applicable_permissions child
      on child.parent_key = parent.permission_key
    where parent.is_active = true
  )
  select
    e.id,
    e.employee_code,
    e.full_name,
    e.nickname,
    e.email,
    e.region_id
  from public.employees e
  join public.profiles p
    on p.id = e.profile_id
  where e.deleted_at is null
    and e.status = 'active'
    and nullif(btrim(coalesce(e.email, '')), '') is not null
    and e.profile_id is not null
    and p.status = 'approved'
    and not exists (
      select 1
      from public.employee_permission_overrides epo
      join applicable_permissions ap
        on ap.permission_key = epo.permission_key
      where epo.employee_id = e.id
        and epo.effect = 'deny'
    )
    and exists (
      select 1
      from applicable_permissions ap
      where exists (
        select 1
        from public.employee_permission_overrides epo
        where epo.employee_id = e.id
          and epo.permission_key = ap.permission_key
          and epo.effect = 'grant'
          and epo.can_view
      )
      or exists (
        select 1
        where not exists (
          select 1
          from public.employee_permission_overrides scoped_epo
          join applicable_permissions scoped_ap
            on scoped_ap.permission_key = scoped_epo.permission_key
          where scoped_epo.employee_id = e.id
            and scoped_epo.effect = 'grant'
        )
        and (
          exists (
            select 1
            from public.job_title_permission_templates jtpt
            where jtpt.job_title_id = e.job_title_id
              and jtpt.permission_key = ap.permission_key
              and jtpt.can_view
          )
          or exists (
            select 1
            from public.employee_special_permissions esp
            join public.special_permission_template_items spti
              on spti.special_permission_template_id = esp.special_permission_template_id
            where esp.employee_id = e.id
              and esp.is_enabled = true
              and esp.can_view
              and spti.permission_key = ap.permission_key
              and spti.can_view
          )
        )
      )
    )
  order by
    coalesce(nullif(btrim(e.nickname), ''), e.full_name),
    e.full_name,
    e.employee_code nulls last,
    e.id;
end;
$$;

revoke all on function public.get_agent_adjustment_target_employees(text) from public;
grant execute on function public.get_agent_adjustment_target_employees(text) to authenticated;
