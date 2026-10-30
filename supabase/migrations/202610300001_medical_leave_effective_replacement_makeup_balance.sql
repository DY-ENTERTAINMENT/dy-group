-- Phase 1: count approved medical leave on an explicitly approved employee
-- replacement make-up date. This deliberately does not introduce a company-wide
-- make-up-workday model; that data source remains a follow-up feature.
begin;

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
    select make_date(p_year, 1, 1) as year_start, make_date(p_year, 12, 31) as year_end
    where p_year between 2000 and 2100
  ),
  entitlement_years as (
    select te.*, greatest(0, date_part('year', age(current_date, te.probation_confirm_date))::integer) as completed_years
    from target_employee te
  ),
  base_rows as (
    select 'annual'::public.leave_type as balance_leave_type,
      case
        when ey.id is null or ey.status <> 'active' or ey.probation_confirm_date is null or ey.probation_confirm_date > current_date then 0
        when ey.completed_years < 2 then 8
        when ey.completed_years < 5 then 12
        else least(20, 16 + greatest(0, ey.completed_years - 5))
      end as base_days
    from entitlement_years ey
    union all
    select 'medical'::public.leave_type,
      case when ey.id is null or ey.status <> 'active' or ey.probation_confirm_date is null or ey.probation_confirm_date > current_date then 0 else 14 end
    from entitlement_years ey
  ),
  approved_ordinary_leave as (
    select lr.id, lr.leave_type, lr.start_date, lr.end_date, te.region_id
    from public.leave_requests lr
    join target_employee te on lr.employee_id = te.id
    join year_bounds yb on true
    where lr.status = 'approved' and lr.leave_type in ('annual', 'medical')
      and lr.end_date >= yb.year_start and lr.start_date <= yb.year_end
  ),
  public_holiday_dates as (
    select ph.holiday_date
    from public.public_holidays ph cross join target_employee te cross join year_bounds yb
    where ph.is_active and ph.holiday_date between yb.year_start and yb.year_end
      and (ph.region_id is null or ph.region_id = te.region_id)
  ),
  replacement_sources as (
    select lr.id, lr.start_date, lr.employee_id
    from public.leave_requests lr join target_employee te on lr.employee_id = te.id
    where lr.leave_type = 'replacement' and lr.status = 'approved'
  ),
  latest_reschedules as (
    select distinct on (rcr.source_replacement_leave_request_id)
      rcr.source_replacement_leave_request_id, rcr.requested_makeup_date
    from public.replacement_work_change_requests rcr
    join replacement_sources rs on rs.id = rcr.source_replacement_leave_request_id
    where rcr.status = 'approved' and rcr.change_type = 'reschedule' and rcr.requested_makeup_date is not null
    order by rcr.source_replacement_leave_request_id, rcr.reviewed_at desc nulls last, rcr.created_at desc, rcr.id desc
  ),
  effective_replacement_sources as (
    select rs.id, rs.employee_id, coalesce(lr.requested_makeup_date, rs.start_date) as effective_makeup_date
    from replacement_sources rs left join latest_reschedules lr on lr.source_replacement_leave_request_id = rs.id
  ),
  effective_makeup_dates as (
    select ers.effective_makeup_date from effective_replacement_sources ers
  ),
  annual_working_dates as (
    select distinct day_value::date as leave_date
    from approved_ordinary_leave lr cross join year_bounds yb
    cross join lateral generate_series(greatest(lr.start_date, yb.year_start), least(lr.end_date, yb.year_end), interval '1 day') as day_value
    where lr.leave_type = 'annual'
      and (extract(dow from day_value) not in (0, 6) or (extract(dow from day_value) = 6 and exists (select 1 from effective_makeup_dates emd where emd.effective_makeup_date = day_value::date)))
      and not exists (select 1 from public_holiday_dates phd where phd.holiday_date = day_value::date)
  ),
  annual_change_dates as (
    select distinct ers.effective_makeup_date as leave_date
    from public.replacement_work_change_requests rcr
    join effective_replacement_sources ers on ers.id = rcr.source_replacement_leave_request_id
    cross join year_bounds yb
    where rcr.status = 'approved' and rcr.change_type = 'annual_leave'
      and ers.effective_makeup_date between yb.year_start and yb.year_end
  ),
  medical_working_dates as (
    select distinct day_value::date as leave_date
    from approved_ordinary_leave lr cross join year_bounds yb
    cross join lateral generate_series(greatest(lr.start_date, yb.year_start), least(lr.end_date, yb.year_end), interval '1 day') as day_value
    where lr.leave_type = 'medical'
      and (
        extract(dow from day_value) not in (0, 6)
        or exists (select 1 from effective_makeup_dates emd where emd.effective_makeup_date = day_value::date)
      )
      and not exists (select 1 from public_holiday_dates phd where phd.holiday_date = day_value::date)
  ),
  used_rows as (
    select 'annual'::public.leave_type as used_leave_type, count(distinct leave_date)::integer as used_days
    from (select leave_date from annual_working_dates union select leave_date from annual_change_dates) annual_dates
    union all
    select 'medical'::public.leave_type, count(distinct leave_date)::integer from medical_working_dates
  ),
  adjustment_rows as (
    select elba.leave_type as adjustment_leave_type, coalesce(sum(elba.adjustment_days), 0)::integer as adjustment_days
    from public.employee_leave_balance_adjustments elba
    where elba.employee_id = p_employee_id and elba.leave_year = p_year and elba.leave_type in ('annual', 'medical')
    group by elba.leave_type
  )
  select br.balance_leave_type, br.base_days, coalesce(ar.adjustment_days, 0), br.base_days + coalesce(ar.adjustment_days, 0),
    coalesce(ur.used_days, 0), br.base_days + coalesce(ar.adjustment_days, 0) - coalesce(ur.used_days, 0)
  from base_rows br
  left join adjustment_rows ar on ar.adjustment_leave_type = br.balance_leave_type
  left join used_rows ur on ur.used_leave_type = br.balance_leave_type
$$;

revoke all on function public.calculate_employee_leave_balances(uuid, integer) from public;
revoke execute on function public.calculate_employee_leave_balances(uuid, integer) from anon;
revoke execute on function public.calculate_employee_leave_balances(uuid, integer) from authenticated;

commit;
