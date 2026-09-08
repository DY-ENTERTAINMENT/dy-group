begin;

insert into public.permission_items (permission_key, parent_key, name, sort_order, is_reserved)
values ('leave-balance-management', 'hr', '假期管理', 46, false)
on conflict (permission_key) do update
set
  parent_key = excluded.parent_key,
  name = excluded.name,
  sort_order = excluded.sort_order,
  is_reserved = excluded.is_reserved,
  is_active = true,
  updated_at = now();

insert into public.job_title_permission_templates (job_title_id, permission_key, can_view, can_use)
select jt.id, 'leave-balance-management', true, true
from public.job_titles jt
where jt.name = 'HR ADMIN'
on conflict (job_title_id, permission_key) do update
set
  can_view = true,
  can_use = true,
  updated_at = now();

create or replace function public.calculate_employee_leave_balances(
  p_employee_id uuid,
  p_year integer
)
returns table (
  leave_type public.leave_type,
  base_entitlement integer,
  adjustment_total integer,
  effective_entitlement integer,
  used_days integer,
  remaining_days integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with target_employee as (
    select e.id, e.profile_id, e.region_id, e.status, e.probation_confirm_date
    from public.employees e
    where e.id = p_employee_id
      and e.deleted_at is null
  ),
  year_bounds as (
    select
      make_date(p_year, 1, 1) as year_start,
      make_date(p_year, 12, 31) as year_end
    where p_year between 2000 and 2100
  ),
  entitlement_years as (
    select
      te.*,
      greatest(0, date_part('year', age(current_date, te.probation_confirm_date))::integer) as completed_years
    from target_employee te
  ),
  base_rows as (
    select
      'annual'::public.leave_type as balance_leave_type,
      case
        when ey.id is null
          or ey.status <> 'active'
          or ey.probation_confirm_date is null
          or ey.probation_confirm_date > current_date then 0
        when ey.completed_years < 2 then 8
        when ey.completed_years < 5 then 12
        else least(20, 16 + greatest(0, ey.completed_years - 5))
      end as base_days
    from entitlement_years ey

    union all

    select
      'medical'::public.leave_type as balance_leave_type,
      case
        when ey.id is null
          or ey.status <> 'active'
          or ey.probation_confirm_date is null
          or ey.probation_confirm_date > current_date then 0
        else 14
      end as base_days
    from entitlement_years ey
  ),
  approved_ordinary_leave as (
    select lr.id, lr.leave_type, lr.start_date, lr.end_date, coalesce(lr.employee_id, te.id) as employee_id, te.region_id
    from public.leave_requests lr
    join target_employee te
      on lr.employee_id = te.id
    join year_bounds yb on true
    where lr.status = 'approved'
      and lr.leave_type in ('annual', 'medical')
      and lr.end_date >= yb.year_start
      and lr.start_date <= yb.year_end
  ),
  public_holiday_dates as (
    select ph.holiday_date
    from public.public_holidays ph
    cross join target_employee te
    cross join year_bounds yb
    where ph.is_active = true
      and ph.holiday_date between yb.year_start and yb.year_end
      and (ph.region_id is null or ph.region_id = te.region_id)
  ),
  replacement_sources as (
    select lr.id, lr.start_date, lr.employee_id
    from public.leave_requests lr
    join target_employee te
      on lr.employee_id = te.id
    where lr.leave_type = 'replacement'
      and lr.status = 'approved'
  ),
  latest_reschedules as (
    select distinct on (rcr.source_replacement_leave_request_id)
      rcr.source_replacement_leave_request_id,
      rcr.requested_makeup_date
    from public.replacement_work_change_requests rcr
    join replacement_sources rs
      on rs.id = rcr.source_replacement_leave_request_id
    where rcr.status = 'approved'
      and rcr.change_type = 'reschedule'
      and rcr.requested_makeup_date is not null
    order by
      rcr.source_replacement_leave_request_id,
      rcr.reviewed_at desc nulls last,
      rcr.created_at desc,
      rcr.id desc
  ),
  effective_replacement_sources as (
    select
      rs.id,
      rs.employee_id,
      coalesce(lr.requested_makeup_date, rs.start_date) as effective_makeup_date
    from replacement_sources rs
    left join latest_reschedules lr
      on lr.source_replacement_leave_request_id = rs.id
  ),
  effective_makeup_dates as (
    select ers.effective_makeup_date
    from effective_replacement_sources ers
  ),
  annual_working_dates as (
    select distinct day_value::date as leave_date
    from approved_ordinary_leave lr
    cross join year_bounds yb
    cross join lateral generate_series(
      greatest(lr.start_date, yb.year_start),
      least(lr.end_date, yb.year_end),
      interval '1 day'
    ) as day_value
    where lr.leave_type = 'annual'
      and (
        extract(dow from day_value) not in (0, 6)
        or (
          extract(dow from day_value) = 6
          and exists (
            select 1
            from effective_makeup_dates emd
            where emd.effective_makeup_date = day_value::date
          )
        )
      )
      and not exists (
        select 1
        from public_holiday_dates phd
        where phd.holiday_date = day_value::date
      )
  ),
  annual_change_dates as (
    select distinct ers.effective_makeup_date as leave_date
    from public.replacement_work_change_requests rcr
    join effective_replacement_sources ers
      on ers.id = rcr.source_replacement_leave_request_id
    cross join year_bounds yb
    where rcr.status = 'approved'
      and rcr.change_type = 'annual_leave'
      and ers.effective_makeup_date between yb.year_start and yb.year_end
  ),
  medical_working_dates as (
    select day_value::date as leave_date
    from approved_ordinary_leave lr
    cross join year_bounds yb
    cross join lateral generate_series(
      greatest(lr.start_date, yb.year_start),
      least(lr.end_date, yb.year_end),
      interval '1 day'
    ) as day_value
    where lr.leave_type = 'medical'
      and extract(dow from day_value) not in (0, 6)
      and not exists (
        select 1
        from public_holiday_dates phd
        where phd.holiday_date = day_value::date
      )
  ),
  used_rows as (
    select 'annual'::public.leave_type as used_leave_type, count(distinct leave_date)::integer as used_days
    from (
      select leave_date from annual_working_dates
      union
      select leave_date from annual_change_dates
    ) annual_dates

    union all

    select 'medical'::public.leave_type as used_leave_type, count(*)::integer as used_days
    from medical_working_dates
  ),
  adjustment_rows as (
    select
      elba.leave_type as adjustment_leave_type,
      coalesce(sum(elba.adjustment_days), 0)::integer as adjustment_days
    from public.employee_leave_balance_adjustments elba
    where elba.employee_id = p_employee_id
      and elba.leave_year = p_year
      and elba.leave_type in ('annual', 'medical')
    group by elba.leave_type
  )
  select
    br.balance_leave_type as leave_type,
    br.base_days as base_entitlement,
    coalesce(ar.adjustment_days, 0) as adjustment_total,
    br.base_days + coalesce(ar.adjustment_days, 0) as effective_entitlement,
    coalesce(ur.used_days, 0) as used_days,
    br.base_days + coalesce(ar.adjustment_days, 0) - coalesce(ur.used_days, 0) as remaining_days
  from base_rows br
  left join adjustment_rows ar
    on ar.adjustment_leave_type = br.balance_leave_type
  left join used_rows ur
    on ur.used_leave_type = br.balance_leave_type
$$;

revoke all on function public.calculate_employee_leave_balances(uuid, integer) from public;
revoke execute on function public.calculate_employee_leave_balances(uuid, integer) from anon;
revoke execute on function public.calculate_employee_leave_balances(uuid, integer) from authenticated;

create or replace function public.get_my_leave_balances(
  p_year integer default extract(year from current_date)::integer
)
returns table (
  leave_type public.leave_type,
  base_entitlement integer,
  adjustment_total integer,
  effective_entitlement integer,
  used_days integer,
  remaining_days integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  current_employee_id uuid;
begin
  if p_year is null or p_year not between 2000 and 2100 then
    raise exception 'Invalid leave year.';
  end if;

  select e.id
  into current_employee_id
  from public.employees e
  where e.profile_id = auth.uid()
    and e.deleted_at is null
  limit 1;

  if current_employee_id is null then
    return query
    select *
    from (
      values
        ('annual'::public.leave_type, 0, 0, 0, 0, 0),
        ('medical'::public.leave_type, 0, 0, 0, 0, 0)
    ) as empty_balances(leave_type, base_entitlement, adjustment_total, effective_entitlement, used_days, remaining_days);
    return;
  end if;

  return query
  select *
  from public.calculate_employee_leave_balances(current_employee_id, p_year);
end;
$$;

revoke all on function public.get_my_leave_balances(integer) from public;
revoke execute on function public.get_my_leave_balances(integer) from anon;
grant execute on function public.get_my_leave_balances(integer) to authenticated;

create or replace function public.get_management_leave_balances(
  p_year integer default extract(year from current_date)::integer,
  p_region_id uuid default null,
  p_employee_status text default 'working',
  p_search text default null
)
returns table (
  employee_id uuid,
  profile_id uuid,
  employee_name text,
  employee_code text,
  region_id uuid,
  region_code text,
  region_name text,
  job_title text,
  employee_status public.employee_status,
  probation_confirm_date date,
  annual_base_entitlement integer,
  annual_adjustment_total integer,
  annual_effective_entitlement integer,
  annual_used_days integer,
  annual_remaining_days integer,
  medical_base_entitlement integer,
  medical_adjustment_total integer,
  medical_effective_entitlement integer,
  medical_used_days integer,
  medical_remaining_days integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.current_user_has_permission('leave-balance-management', 'view') then
    raise exception 'No permission to view leave balances.';
  end if;

  if p_year is null or p_year not between 2000 and 2100 then
    raise exception 'Invalid leave year.';
  end if;

  if p_region_id is not null and not public.current_user_can_access_region(p_region_id) then
    raise exception 'No permission to view this region.';
  end if;

  if coalesce(p_employee_status, 'working') not in ('working', 'active', 'probation', 'inactive', 'left', 'all') then
    raise exception 'Invalid employee status filter.';
  end if;

  return query
  select
    e.id as employee_id,
    e.profile_id,
    e.full_name as employee_name,
    e.employee_code,
    e.region_id,
    r.code as region_code,
    r.name as region_name,
    jt.name as job_title,
    e.status as employee_status,
    e.probation_confirm_date,
    annual_balance.base_entitlement as annual_base_entitlement,
    annual_balance.adjustment_total as annual_adjustment_total,
    annual_balance.effective_entitlement as annual_effective_entitlement,
    annual_balance.used_days as annual_used_days,
    annual_balance.remaining_days as annual_remaining_days,
    medical_balance.base_entitlement as medical_base_entitlement,
    medical_balance.adjustment_total as medical_adjustment_total,
    medical_balance.effective_entitlement as medical_effective_entitlement,
    medical_balance.used_days as medical_used_days,
    medical_balance.remaining_days as medical_remaining_days
  from public.employees e
  left join public.regions r
    on r.id = e.region_id
  left join public.job_titles jt
    on jt.id = e.job_title_id
  join lateral (
    select ceb.*
    from public.calculate_employee_leave_balances(e.id, p_year) ceb
    where ceb.leave_type = 'annual'
  ) annual_balance on true
  join lateral (
    select ceb.*
    from public.calculate_employee_leave_balances(e.id, p_year) ceb
    where ceb.leave_type = 'medical'
  ) medical_balance on true
  where e.deleted_at is null
    and public.current_user_can_access_region(e.region_id)
    and (p_region_id is null or e.region_id = p_region_id)
    and (
      coalesce(p_employee_status, 'working') = 'all'
      or (coalesce(p_employee_status, 'working') = 'working' and e.status in ('active', 'probation'))
      or e.status::text = coalesce(p_employee_status, 'working')
    )
    and (
      length(btrim(coalesce(p_search, ''))) = 0
      or e.full_name ilike '%' || btrim(p_search) || '%'
      or e.nickname ilike '%' || btrim(p_search) || '%'
      or e.employee_code ilike '%' || btrim(p_search) || '%'
      or r.code ilike '%' || btrim(p_search) || '%'
      or jt.name ilike '%' || btrim(p_search) || '%'
    )
  order by r.sort_order nulls last, e.full_name asc, e.employee_code asc;
end;
$$;

revoke all on function public.get_management_leave_balances(integer, uuid, text, text) from public;
revoke execute on function public.get_management_leave_balances(integer, uuid, text, text) from anon;
grant execute on function public.get_management_leave_balances(integer, uuid, text, text) to authenticated;

create or replace function public.adjust_employee_leave_balance(
  p_employee_id uuid,
  p_leave_year integer,
  p_leave_type text,
  p_adjustment_days integer,
  p_reason text
)
returns table (
  id uuid,
  employee_id uuid,
  leave_year integer,
  leave_type public.leave_type,
  adjustment_days integer,
  reason text,
  adjusted_by uuid,
  created_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  target_employee record;
  current_balance record;
  adjusted_effective_entitlement integer;
  created_adjustment_id uuid;
begin
  if not public.current_user_has_permission('leave-balance-management', 'use') then
    raise exception 'No permission to adjust leave balances.';
  end if;

  if p_leave_year is null or p_leave_year not between 2000 and 2100 then
    raise exception 'Invalid leave year.';
  end if;

  if p_leave_type not in ('annual', 'medical') then
    raise exception 'Invalid leave type.';
  end if;

  if p_adjustment_days is null or p_adjustment_days = 0 then
    raise exception 'Adjustment days must not be zero.';
  end if;

  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Adjustment reason is required.';
  end if;

  select e.id, e.region_id
  into target_employee
  from public.employees e
  where e.id = p_employee_id
    and e.deleted_at is null
  for update;

  if target_employee.id is null then
    raise exception 'Employee not found.';
  end if;

  if not public.current_user_can_access_region(target_employee.region_id) then
    raise exception 'No permission to adjust this employee.';
  end if;

  select ceb.*
  into current_balance
  from public.calculate_employee_leave_balances(target_employee.id, p_leave_year) ceb
  where ceb.leave_type = p_leave_type::public.leave_type;

  adjusted_effective_entitlement :=
    current_balance.base_entitlement + current_balance.adjustment_total + p_adjustment_days;

  if adjusted_effective_entitlement < current_balance.used_days then
    raise exception '额度调整后不可低于已使用天数。';
  end if;

  insert into public.employee_leave_balance_adjustments (
    employee_id,
    leave_year,
    leave_type,
    adjustment_days,
    reason,
    adjusted_by
  )
  values (
    target_employee.id,
    p_leave_year,
    p_leave_type::public.leave_type,
    p_adjustment_days,
    btrim(p_reason),
    auth.uid()
  )
  returning employee_leave_balance_adjustments.id into created_adjustment_id;

  return query
  select
    elba.id,
    elba.employee_id,
    elba.leave_year,
    elba.leave_type,
    elba.adjustment_days,
    elba.reason,
    elba.adjusted_by,
    elba.created_at
  from public.employee_leave_balance_adjustments elba
  where elba.id = created_adjustment_id;
end;
$$;

revoke all on function public.adjust_employee_leave_balance(uuid, integer, text, integer, text) from public;
revoke execute on function public.adjust_employee_leave_balance(uuid, integer, text, integer, text) from anon;
grant execute on function public.adjust_employee_leave_balance(uuid, integer, text, integer, text) to authenticated;

create or replace function public.list_employee_leave_balance_adjustments(
  p_employee_id uuid,
  p_year integer default null
)
returns table (
  id uuid,
  employee_id uuid,
  leave_year integer,
  leave_type public.leave_type,
  adjustment_days integer,
  reason text,
  adjusted_by uuid,
  adjusted_by_name text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  target_employee record;
begin
  if not public.current_user_has_permission('leave-balance-management', 'view') then
    raise exception 'No permission to view leave balance adjustments.';
  end if;

  if p_year is not null and p_year not between 2000 and 2100 then
    raise exception 'Invalid leave year.';
  end if;

  select e.id, e.region_id
  into target_employee
  from public.employees e
  where e.id = p_employee_id
    and e.deleted_at is null;

  if target_employee.id is null then
    raise exception 'Employee not found.';
  end if;

  if not public.current_user_can_access_region(target_employee.region_id) then
    raise exception 'No permission to view this employee.';
  end if;

  return query
  select
    elba.id,
    elba.employee_id,
    elba.leave_year,
    elba.leave_type,
    elba.adjustment_days,
    elba.reason,
    elba.adjusted_by,
    coalesce(p.full_name, p.email) as adjusted_by_name,
    elba.created_at
  from public.employee_leave_balance_adjustments elba
  left join public.profiles p
    on p.id = elba.adjusted_by
  where elba.employee_id = target_employee.id
    and (p_year is null or elba.leave_year = p_year)
  order by elba.created_at desc, elba.id desc;
end;
$$;

revoke all on function public.list_employee_leave_balance_adjustments(uuid, integer) from public;
revoke execute on function public.list_employee_leave_balance_adjustments(uuid, integer) from anon;
grant execute on function public.list_employee_leave_balance_adjustments(uuid, integer) to authenticated;

commit;
