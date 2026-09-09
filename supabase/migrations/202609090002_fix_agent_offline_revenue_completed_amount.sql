begin;

-- Keep managed_creator_count on its existing current-active-entity definition.
-- Completed revenue is historical: a creator entity with any binding overlap in
-- the requested MYT calendar month contributes its whole month's valid revenue,
-- even if the entity is no longer active when a historical month is viewed.
create or replace function public.get_agent_offline_revenue_kpi_summary(p_month date)
returns table (
  agent_employee_id uuid,
  agent_name text,
  job_title text,
  managed_creator_count bigint,
  kpi_amount numeric,
  completed_amount numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  month_start_at timestamptz;
  month_end_at timestamptz;
begin
  if auth.uid() is null or not public.current_user_has_permission('management-revenue-data', 'view') then
    raise exception 'Permission denied.';
  end if;

  if p_month is null or p_month <> date_trunc('month', p_month)::date then
    raise exception 'Month must be the first day of its month.' using errcode = '22023';
  end if;

  month_start_at := p_month::timestamp at time zone 'Asia/Kuala_Lumpur';
  month_end_at := (p_month + interval '1 month') at time zone 'Asia/Kuala_Lumpur';

  return query
  with eligible_agents as (
    select e.id, coalesce(nullif(btrim(e.nickname), ''), e.full_name) as name, jt.name as title
    from public.employees e
    join public.job_titles jt on jt.id = e.job_title_id
    where e.deleted_at is null
      and e.status = 'active'
      and jt.name in ('TALENT AGENT LEAD', 'TALENT AGENT')
      and (
        public.current_user_is_super_admin()
        or e.region_id in (select public.current_user_authorized_region_ids())
      )
  ),
  offline_entities as (
    select distinct entity.id as creator_entity_id, entity.manager_employee_id
    from public.offline_live_room_creators assignment
    join public.creator_entities entity on entity.id = assignment.creator_entity_id
    join eligible_agents agent on agent.id = entity.manager_employee_id
    where entity.status = 'active'
      and assignment.assigned_at < month_end_at
      and coalesce(assignment.ended_at, 'infinity'::timestamptz) > month_start_at
      and entity.manager_employee_id is not null
  ),
  managed_counts as (
    select oe.manager_employee_id, count(*)::bigint as creator_count
    from offline_entities oe
    group by oe.manager_employee_id
  ),
  completed_offline_entities as (
    select distinct entity.id as creator_entity_id, entity.manager_employee_id
    from public.offline_live_room_creators assignment
    join public.creator_entities entity on entity.id = assignment.creator_entity_id
    join eligible_agents agent on agent.id = entity.manager_employee_id
    where assignment.assigned_at < month_end_at
      and coalesce(assignment.ended_at, 'infinity'::timestamptz) > month_start_at
      and entity.manager_employee_id is not null
  ),
  latest_monthly_records as (
    select completed_entity.manager_employee_id, ranked.revenue_amount
    from (
      select
        coalesce(wr.creator_entity_id, profile.creator_entity_id) as creator_entity_id,
        wr.creator_profile_id,
        wr.week_start_date,
        wr.revenue_amount,
        row_number() over (
          partition by wr.creator_profile_id, wr.week_start_date
          order by coalesce(wr.updated_at, wr.submitted_at, wr.created_at) desc, wr.id desc
        ) as version_rank
      from public.creator_weekly_revenue_records wr
      join public.creator_profiles profile on profile.id = wr.creator_profile_id
      where wr.status in ('submitted', 'confirmed')
        and wr.week_start_date >= p_month
        and wr.week_start_date < (p_month + interval '1 month')::date
    ) ranked
    join completed_offline_entities completed_entity
      on completed_entity.creator_entity_id = ranked.creator_entity_id
    where ranked.version_rank = 1
  ),
  completed_amounts as (
    select record.manager_employee_id, coalesce(sum(record.revenue_amount), 0)::numeric as amount
    from latest_monthly_records record
    group by record.manager_employee_id
  )
  select
    agent.id,
    agent.name,
    agent.title,
    coalesce(managed.creator_count, 0),
    kpi.kpi_amount,
    coalesce(completed.amount, 0)
  from eligible_agents agent
  left join managed_counts managed on managed.manager_employee_id = agent.id
  left join public.agent_offline_revenue_kpis kpi
    on kpi.agent_employee_id = agent.id and kpi.month = p_month
  left join completed_amounts completed on completed.manager_employee_id = agent.id
  order by agent.name, agent.id;
end;
$$;

revoke all on function public.get_agent_offline_revenue_kpi_summary(date) from public;
grant execute on function public.get_agent_offline_revenue_kpi_summary(date) to authenticated;

commit;
