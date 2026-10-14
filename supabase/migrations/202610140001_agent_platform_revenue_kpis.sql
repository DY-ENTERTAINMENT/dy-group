-- RELEASE CANDIDATE ONLY. Not approved for deployment.
-- DATABASE INTEGRATION TESTS SKIPPED BY USER.
-- Production structural CSVs reviewed; live behavior/defaults not verified.
-- Requires deployed 202610120002 and 202610130001 plus existing identity/region
-- helpers and set_agent_offline_revenue_kpis_audit_fields().
-- Recheck current version/object absence before release. CREATE fails on conflicts.
-- Transaction failure must be investigated; do not drop objects, force migration
-- history or retry blindly. Never delete stored KPI targets for rollback.
begin;

-- Platform targets are intentionally separate from offline-live-room targets.
create table public.agent_platform_revenue_kpis (
  id uuid primary key default gen_random_uuid(),
  agent_employee_id uuid not null references public.employees(id) on delete restrict,
  month date not null,
  platform public.creator_platform not null,
  kpi_amount numeric(14, 2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  constraint agent_platform_revenue_kpis_month_check check (month = date_trunc('month', month)::date),
  constraint agent_platform_revenue_kpis_platform_check check (platform in ('tiktok', 'douyin')),
  constraint agent_platform_revenue_kpis_amount_check check (
    kpi_amount >= 0 and kpi_amount::text not in ('NaN', 'Infinity', '-Infinity')
  ),
  constraint agent_platform_revenue_kpis_agent_month_platform_unique unique (agent_employee_id, month, platform)
);

create index agent_platform_revenue_kpis_month_platform_agent_idx
  on public.agent_platform_revenue_kpis (month, platform, agent_employee_id);

create trigger set_agent_platform_revenue_kpis_audit_fields
before update on public.agent_platform_revenue_kpis
for each row execute function public.set_agent_offline_revenue_kpis_audit_fields();

alter table public.agent_platform_revenue_kpis enable row level security;
revoke all on public.agent_platform_revenue_kpis from anon, authenticated;

create policy "Revenue managers can read platform agent KPIs"
on public.agent_platform_revenue_kpis for select to authenticated
using (
  public.current_user_has_permission('management-revenue-data', 'view')
  and (
    public.current_user_is_super_admin()
    or exists (
      select 1 from public.employees agent
      where agent.id = agent_platform_revenue_kpis.agent_employee_id
        and agent.region_id in (select public.current_user_authorized_region_ids())
    )
  )
);

create function public.upsert_agent_platform_revenue_kpi(
  p_agent_employee_id uuid,
  p_month date,
  p_platform public.creator_platform,
  p_kpi_amount numeric
)
returns public.agent_platform_revenue_kpis
language plpgsql security definer set search_path = public, pg_temp as $$
declare target_row public.agent_platform_revenue_kpis;
begin
  if auth.uid() is null or not public.current_user_is_active_employee() then raise exception 'An active employee is required.' using errcode = '42501'; end if;
  if p_month is null or p_month <> date_trunc('month', p_month)::date then raise exception 'Month must be the first day of its month.' using errcode = '22023'; end if;
  if p_platform is null or p_platform not in ('tiktok', 'douyin') then raise exception 'Invalid platform.' using errcode = '22023'; end if;
  -- Keep numeric(14,2) storage rounding; reject only invalid/non-finite input.
  if p_kpi_amount is null or p_kpi_amount::text in ('NaN', 'Infinity', '-Infinity') or p_kpi_amount < 0 then raise exception 'KPI amount must be a finite non-negative number.' using errcode = '22023'; end if;

  if not public.current_user_is_super_admin() and not exists (
    select 1 from public.employees e join public.profiles p on p.id = e.profile_id join public.job_titles jt on jt.id = e.job_title_id
    where e.profile_id = auth.uid() and e.deleted_at is null and e.status = 'active' and p.status = 'approved' and jt.name = 'TALENT AGENT LEAD'
  ) then raise exception 'Only Super Admin or an active TALENT AGENT LEAD can save platform revenue KPIs.'; end if;

  if not exists (
    select 1 from public.employees e join public.job_titles jt on jt.id = e.job_title_id
    where e.id = p_agent_employee_id and e.deleted_at is null and e.status = 'active'
      and jt.name in ('TALENT AGENT LEAD', 'TALENT AGENT')
      and (public.current_user_is_super_admin() or e.region_id in (select public.current_user_authorized_region_ids()))
  ) then raise exception 'KPI target employee must be an active Talent Agent or Talent Agent Lead in an authorized region.' using errcode = '22023'; end if;

  insert into public.agent_platform_revenue_kpis (agent_employee_id, month, platform, kpi_amount)
  values (p_agent_employee_id, p_month, p_platform, p_kpi_amount)
  on conflict (agent_employee_id, month, platform) do update set kpi_amount = excluded.kpi_amount
  returning * into target_row;
  return target_row;
end;
$$;

-- Report RPC owns cycle applicability, canonicalization and historical attribution.
create function public.get_agent_platform_revenue_kpi_summary(p_month date, p_platform public.creator_platform)
returns table (agent_employee_id uuid, agent_name text, job_title text, managed_creator_count bigint,
 kpi_amount numeric, completed_amount numeric, unverified_amount numeric, unverified_record_count bigint, cycle_sources text[])
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_offset integer := 0; v_page jsonb; v_records jsonb := '[]'::jsonb;
begin
 if auth.uid() is null or not public.current_user_is_active_employee() or not public.current_user_has_permission('management-revenue-data', 'view') then raise exception 'Permission denied.' using errcode = '42501'; end if;
 if p_month is null or p_month <> date_trunc('month', p_month)::date then raise exception 'Month must be the first day of its month.' using errcode = '22023'; end if;
 if p_platform is null or p_platform not in ('tiktok', 'douyin') then raise exception 'Invalid platform.' using errcode = '22023'; end if;
 loop
  select coalesce(jsonb_agg(report.record), '[]'::jsonb) into v_page
  from public.list_management_revenue_records_e(p_start_date => p_month,
   p_end_date => (p_month + interval '1 month - 1 day')::date,
   p_manager_employee_id => null, p_platform => p_platform::text,
   p_creator_type => null, p_region_id => null, p_status => null,
   p_limit => 500, p_offset => v_offset, p_revenue_cycle => null) report;
  v_records := v_records || v_page;
  exit when jsonb_array_length(v_page) < 500;
  v_offset := v_offset + 500;
 end loop;
 return query with eligible_agents as (
  select e.id, coalesce(nullif(btrim(e.nickname), ''), e.full_name) as name, jt.name as title
  from public.employees e join public.job_titles jt on jt.id = e.job_title_id
  where e.deleted_at is null and e.status = 'active' and jt.name in ('TALENT AGENT LEAD', 'TALENT AGENT')
   and (public.current_user_is_super_admin() or public.current_user_can_access_region(e.region_id))
 ), managed_counts as (
  select entity.manager_employee_id, count(distinct entity.id)::bigint as creator_count
  from public.creator_entities entity join public.creator_profiles profile on profile.creator_entity_id = entity.id
  join eligible_agents agent on agent.id = entity.manager_employee_id
  where entity.status = 'active' and profile.status = 'active' and profile.membership_status = 'active' and profile.platform = p_platform
   and public.current_user_can_access_region(profile.region_id)
  group by entity.manager_employee_id
 ), actual_records as (
  select item.record from jsonb_array_elements(v_records) item(record)
  where (item.record->>'has_revenue_record')::boolean is true and item.record->>'id' is not null
   and item.record->>'platform' = p_platform::text and item.record->>'status' in ('submitted', 'confirmed')
 ), completed_amounts as (
  select (record->>'reporting_manager_employee_id')::uuid as manager_id,
   sum((record->>'revenue_amount')::numeric) as amount,
   coalesce(sum((record->>'revenue_amount')::numeric) filter (where record->>'cycle_source' = 'LEGACY_UNKNOWN'), 0) as unknown_amount,
   count(*) filter (where record->>'cycle_source' = 'LEGACY_UNKNOWN') as unknown_count,
   array_agg(distinct record->>'cycle_source') as sources
  from actual_records group by (record->>'reporting_manager_employee_id')::uuid
 )
 select agent.id, agent.name, agent.title, coalesce(managed.creator_count, 0), target.kpi_amount,
  coalesce(completed.amount, 0), coalesce(completed.unknown_amount, 0), coalesce(completed.unknown_count, 0), coalesce(completed.sources, array[]::text[])
 from eligible_agents agent
 left join managed_counts managed on managed.manager_employee_id = agent.id
 left join public.agent_platform_revenue_kpis target on target.agent_employee_id = agent.id and target.month = p_month and target.platform = p_platform
 left join completed_amounts completed on completed.manager_id = agent.id order by agent.name, agent.id;
end;
$$;

revoke all on function public.upsert_agent_platform_revenue_kpi(uuid, date, public.creator_platform, numeric) from public, anon;
revoke all on function public.get_agent_platform_revenue_kpi_summary(date, public.creator_platform) from public, anon;
grant execute on function public.upsert_agent_platform_revenue_kpi(uuid, date, public.creator_platform, numeric) to authenticated;
grant execute on function public.get_agent_platform_revenue_kpi_summary(date, public.creator_platform) to authenticated;

commit;
