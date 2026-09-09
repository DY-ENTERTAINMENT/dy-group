begin;

-- Monthly offline-live-room KPI targets. A target belongs to one current agent
-- employee and one calendar month; it is intentionally independent of revenue
-- platform because the KPI completion metric sums TikTok and Douyin amounts.
create table public.agent_offline_revenue_kpis (
  id uuid primary key default gen_random_uuid(),
  agent_employee_id uuid not null references public.employees(id) on delete restrict,
  month date not null,
  kpi_amount numeric(14, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  constraint agent_offline_revenue_kpis_month_check
    check (month = date_trunc('month', month)::date),
  constraint agent_offline_revenue_kpis_kpi_amount_check
    check (kpi_amount >= 0),
  constraint agent_offline_revenue_kpis_agent_month_unique
    unique (agent_employee_id, month)
);

create index agent_offline_revenue_kpis_month_agent_idx
on public.agent_offline_revenue_kpis (month, agent_employee_id);

create or replace function public.set_agent_offline_revenue_kpis_audit_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create trigger set_agent_offline_revenue_kpis_audit_fields
before update on public.agent_offline_revenue_kpis
for each row execute function public.set_agent_offline_revenue_kpis_audit_fields();

alter table public.agent_offline_revenue_kpis enable row level security;
revoke all on table public.agent_offline_revenue_kpis from anon, authenticated;

-- KPI readers have the same management permission used by the total-revenue
-- feature. Writes are deliberately available only through the guarded RPC below.
create policy "Revenue managers can read offline agent KPIs"
on public.agent_offline_revenue_kpis
for select to authenticated
using (
  public.current_user_has_permission('management-revenue-data', 'view')
  and (
    public.current_user_is_super_admin()
    or exists (
      select 1
      from public.employees agent
      where agent.id = agent_offline_revenue_kpis.agent_employee_id
        and agent.region_id in (select public.current_user_authorized_region_ids())
    )
  )
);

create or replace function public.list_agent_offline_revenue_kpis(p_month date)
returns table (
  agent_employee_id uuid,
  kpi_amount numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.current_user_has_permission('management-revenue-data', 'view') then
    raise exception 'Permission denied.';
  end if;

  if p_month is null or p_month <> date_trunc('month', p_month)::date then
    raise exception 'Month must be the first day of its month.' using errcode = '22023';
  end if;

  return query
  select k.agent_employee_id, k.kpi_amount
  from public.agent_offline_revenue_kpis k
  join public.employees agent on agent.id = k.agent_employee_id
  join public.job_titles job_title on job_title.id = agent.job_title_id
  where k.month = p_month
    and agent.deleted_at is null
    and agent.status = 'active'
    and job_title.name in ('TALENT AGENT LEAD', 'TALENT AGENT')
    and (
      public.current_user_is_super_admin()
      or agent.region_id in (select public.current_user_authorized_region_ids())
    )
  order by k.agent_employee_id;
end;
$$;

create or replace function public.upsert_agent_offline_revenue_kpi(
  p_agent_employee_id uuid,
  p_month date,
  p_kpi_amount numeric
)
returns public.agent_offline_revenue_kpis
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_row public.agent_offline_revenue_kpis;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  if p_month is null or p_month <> date_trunc('month', p_month)::date then
    raise exception 'Month must be the first day of its month.' using errcode = '22023';
  end if;

  if p_kpi_amount is null or p_kpi_amount < 0 then
    raise exception 'KPI amount must be a non-negative number.' using errcode = '22023';
  end if;

  if not public.current_user_is_super_admin() and not exists (
    select 1
    from public.employees e
    join public.profiles p on p.id = e.profile_id
    join public.job_titles jt on jt.id = e.job_title_id
    where e.profile_id = auth.uid()
      and e.deleted_at is null
      and e.status = 'active'
      and p.status = 'approved'
      and jt.name = 'TALENT AGENT LEAD'
  ) then
    raise exception 'Only Super Admin or an active TALENT AGENT LEAD can save offline revenue KPIs.';
  end if;

  if not exists (
    select 1
    from public.employees e
    join public.job_titles jt on jt.id = e.job_title_id
    where e.id = p_agent_employee_id
      and e.deleted_at is null
      and e.status = 'active'
      and jt.name in ('TALENT AGENT LEAD', 'TALENT AGENT')
      and (
        public.current_user_is_super_admin()
        or e.region_id in (select public.current_user_authorized_region_ids())
      )
  ) then
    raise exception 'KPI target employee must be an active Talent Agent or Talent Agent Lead.' using errcode = '22023';
  end if;

  insert into public.agent_offline_revenue_kpis (agent_employee_id, month, kpi_amount)
  values (p_agent_employee_id, p_month, p_kpi_amount)
  on conflict (agent_employee_id, month) do update
    set kpi_amount = excluded.kpi_amount
  returning * into target_row;

  return target_row;
end;
$$;

-- Uses the current primary manager on creator_entities. Primary-manager history
-- does not exist, so past months cannot be attributed to a former primary manager.
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
  -- Calendar months and weekly revenue dates use the DY Group business timezone.
  -- Do not cast date directly to timestamptz: that would depend on session TimeZone.
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
  latest_monthly_records as (
    select ranked.creator_entity_id, ranked.revenue_amount
    from (
      select
        coalesce(wr.creator_entity_id, profile.creator_entity_id) as creator_entity_id,
        wr.creator_profile_id,
        wr.week_start_date,
        wr.week_end_date,
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
    where ranked.version_rank = 1
      and exists (
        select 1
        from public.offline_live_room_creators assignment
        where assignment.creator_entity_id = ranked.creator_entity_id
          and assignment.assigned_at < ((ranked.week_end_date + 1)::timestamp at time zone 'Asia/Kuala_Lumpur')
          and coalesce(assignment.ended_at, 'infinity'::timestamptz) > (ranked.week_start_date::timestamp at time zone 'Asia/Kuala_Lumpur')
      )
  ),
  completed_amounts as (
    select entity.manager_employee_id, coalesce(sum(record.revenue_amount), 0)::numeric as amount
    from latest_monthly_records record
    join public.creator_entities entity on entity.id = record.creator_entity_id
    where entity.status = 'active'
      and entity.manager_employee_id is not null
    group by entity.manager_employee_id
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

revoke all on function public.list_agent_offline_revenue_kpis(date) from public;
revoke all on function public.upsert_agent_offline_revenue_kpi(uuid, date, numeric) from public;
revoke all on function public.get_agent_offline_revenue_kpi_summary(date) from public;
grant execute on function public.list_agent_offline_revenue_kpis(date) to authenticated;
grant execute on function public.upsert_agent_offline_revenue_kpi(uuid, date, numeric) to authenticated;
grant execute on function public.get_agent_offline_revenue_kpi_summary(date) to authenticated;

commit;
