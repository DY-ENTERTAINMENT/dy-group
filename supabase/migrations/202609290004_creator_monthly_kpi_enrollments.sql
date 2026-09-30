begin;

-- Additive only: intentionally no historical enrollment backfill.
create table public.creator_monthly_kpi_enrollments (
  id uuid primary key default gen_random_uuid(),
  creator_entity_id uuid not null references public.creator_entities(id) on delete restrict,
  target_month date not null,
  status text not null check (status in ('required', 'not_required')),
  created_by_employee_id uuid references public.employees(id) on delete set null,
  updated_by_employee_id uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint creator_monthly_kpi_enrollments_month_start_check check (target_month = date_trunc('month', target_month)::date),
  constraint creator_monthly_kpi_enrollments_entity_month_unique unique (creator_entity_id, target_month)
);
create index creator_monthly_kpi_enrollments_month_entity_idx on public.creator_monthly_kpi_enrollments(target_month, creator_entity_id);
create trigger set_creator_monthly_kpi_enrollments_updated_at before update on public.creator_monthly_kpi_enrollments for each row execute function public.set_updated_at();
alter table public.creator_monthly_kpi_enrollments enable row level security;
revoke all on public.creator_monthly_kpi_enrollments from public, anon, authenticated;

create or replace function public.save_creator_monthly_kpi_enrollments(p_month date, p_enrollments jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare item jsonb; v_entity uuid; v_status text; v_employee uuid := public.current_user_employee_id();
begin
  if p_month is null or p_month <> date_trunc('month', p_month)::date or p_month < date_trunc('month', public.current_malaysia_business_date())::date then
    raise exception 'Historical KPI months cannot be changed.';
  end if;
  if jsonb_typeof(p_enrollments) <> 'array' then raise exception 'Enrollment list must be an array.'; end if;
  for item in select value from jsonb_array_elements(p_enrollments) loop
    v_entity := (item->>'creator_entity_id')::uuid; v_status := item->>'status';
    if v_status not in ('required', 'not_required') or not public.current_user_can_manage_creator_monthly_kpi(v_entity) then
      raise exception 'Invalid KPI enrollment or creator access denied.';
    end if;
    insert into public.creator_monthly_kpi_enrollments(creator_entity_id,target_month,status,created_by_employee_id,updated_by_employee_id)
    values(v_entity,p_month,v_status,v_employee,v_employee)
    on conflict (creator_entity_id,target_month) do update set status=excluded.status,updated_by_employee_id=excluded.updated_by_employee_id;
  end loop;
end;
$$;

-- Preserve the existing signature; enforce the canonical REQUIRED state before target writes.
create or replace function public.save_creator_monthly_kpi_targets(p_month date, p_targets jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare item jsonb; target_kpi public.creator_monthly_kpis; v_entity uuid; v_hours numeric; v_days integer; v_platforms jsonb; v_employee uuid := public.current_user_employee_id();
begin
  if p_month is null or p_month <> date_trunc('month', p_month)::date or p_month < date_trunc('month', public.current_malaysia_business_date())::date then raise exception 'Historical KPI months cannot be changed.'; end if;
  if jsonb_typeof(p_targets) <> 'array' or jsonb_array_length(p_targets)=0 then raise exception 'At least one KPI target is required.'; end if;
  for item in select value from jsonb_array_elements(p_targets) loop
    v_entity := (item->>'creator_entity_id')::uuid; v_hours := (item->>'live_hours_target')::numeric; v_days := (item->>'live_days_target')::integer; v_platforms := item->'platform_targets';
    if v_hours < 0 or v_days < 0 or jsonb_typeof(v_platforms)<>'array' or not public.current_user_can_manage_creator_monthly_kpi(v_entity) or not exists(select 1 from public.creator_monthly_kpi_enrollments e where e.creator_entity_id=v_entity and e.target_month=p_month and e.status='required') then raise exception 'KPI target requires a required enrollment and creator access.'; end if;
    if (select count(*) from jsonb_to_recordset(v_platforms) x(platform public.creator_platform,revenue_target numeric)) <> (select count(*) from public.creator_profiles p where p.creator_entity_id=v_entity and p.status='active' and p.membership_status='active') or exists(select 1 from jsonb_to_recordset(v_platforms) x(platform public.creator_platform,revenue_target numeric) where x.revenue_target<0) or exists(select 1 from jsonb_to_recordset(v_platforms) x(platform public.creator_platform,revenue_target numeric) where not exists(select 1 from public.creator_profiles p where p.creator_entity_id=v_entity and p.platform=x.platform and p.status='active' and p.membership_status='active')) then raise exception 'Platform KPI targets must exactly match active platforms.'; end if;
    insert into public.creator_monthly_kpis(creator_entity_id,target_month,live_hours_target,live_days_target,created_by_employee_id,updated_by_employee_id) values(v_entity,p_month,v_hours,v_days,v_employee,v_employee) on conflict(creator_entity_id,target_month) do update set live_hours_target=excluded.live_hours_target,live_days_target=excluded.live_days_target,updated_by_employee_id=excluded.updated_by_employee_id returning * into target_kpi;
    insert into public.creator_monthly_kpi_revenue_targets(creator_monthly_kpi_id,platform,revenue_target,created_by_employee_id,updated_by_employee_id) select target_kpi.id,x.platform,x.revenue_target,v_employee,v_employee from jsonb_to_recordset(v_platforms) x(platform public.creator_platform,revenue_target numeric) on conflict(creator_monthly_kpi_id,platform) do update set revenue_target=excluded.revenue_target,updated_by_employee_id=excluded.updated_by_employee_id;
  end loop;
end;
$$;

create or replace function public.save_creator_monthly_kpi_weekly_update(p_creator_entity_id uuid,p_month date,p_live_hours_cumulative numeric,p_live_days_cumulative integer,p_update_kind text,p_idempotency_key uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare target_kpi public.creator_monthly_kpis; v_week date:=public.creator_monthly_kpi_week_start(public.current_malaysia_business_date());
begin
  if p_month is null or p_month<>date_trunc('month',public.current_malaysia_business_date())::date or p_live_hours_cumulative is null or p_live_hours_cumulative<0 or p_live_days_cumulative is null or p_live_days_cumulative<0 or p_update_kind not in ('reported','confirmed_no_change') or p_idempotency_key is null then raise exception 'Weekly KPI updates are only allowed for the current MYT month.'; end if;
  select * into target_kpi from public.creator_monthly_kpis where creator_entity_id=p_creator_entity_id and target_month=p_month;
  if target_kpi.id is null or not public.current_user_can_manage_creator_monthly_kpi(p_creator_entity_id) or not exists(select 1 from public.creator_monthly_kpi_enrollments e where e.creator_entity_id=p_creator_entity_id and e.target_month=p_month and e.status='required') then raise exception 'Required creator KPI not found or access denied.'; end if;
  insert into public.creator_monthly_kpi_weekly_updates(creator_monthly_kpi_id,week_start_date,live_hours_cumulative,live_days_cumulative,update_kind,updated_by_employee_id,idempotency_key) values(target_kpi.id,v_week,p_live_hours_cumulative,p_live_days_cumulative,p_update_kind,public.current_user_employee_id(),p_idempotency_key) on conflict(creator_monthly_kpi_id,idempotency_key) do nothing;
end;
$$;

create or replace function public.copy_creator_monthly_kpi_targets(p_source_month date,p_target_month date)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare copied_count integer:=0; existing_count integer:=0; source record; new_kpi public.creator_monthly_kpis; v_employee uuid:=public.current_user_employee_id();
begin
  if p_source_month is null or p_target_month is null or p_source_month<>date_trunc('month',p_source_month)::date or p_target_month<>date_trunc('month',p_target_month)::date or p_target_month<date_trunc('month',public.current_malaysia_business_date())::date then raise exception 'Invalid source or target KPI month.'; end if;
  for source in select k.* from public.creator_monthly_kpis k join public.creator_monthly_kpi_enrollments e on e.creator_entity_id=k.creator_entity_id and e.target_month=k.target_month and e.status='required' where k.target_month=p_source_month and public.current_user_can_manage_creator_monthly_kpi(k.creator_entity_id) loop
    if exists(select 1 from public.creator_monthly_kpi_enrollments e where e.creator_entity_id=source.creator_entity_id and e.target_month=p_target_month) then existing_count:=existing_count+1; continue; end if;
    insert into public.creator_monthly_kpi_enrollments(creator_entity_id,target_month,status,created_by_employee_id,updated_by_employee_id) values(source.creator_entity_id,p_target_month,'required',v_employee,v_employee);
    insert into public.creator_monthly_kpis(creator_entity_id,target_month,live_hours_target,live_days_target,created_by_employee_id,updated_by_employee_id) values(source.creator_entity_id,p_target_month,source.live_hours_target,source.live_days_target,v_employee,v_employee) returning * into new_kpi;
    insert into public.creator_monthly_kpi_revenue_targets(creator_monthly_kpi_id,platform,revenue_target,created_by_employee_id,updated_by_employee_id) select new_kpi.id,t.platform,t.revenue_target,v_employee,v_employee from public.creator_monthly_kpi_revenue_targets t where t.creator_monthly_kpi_id=source.id;
    copied_count:=copied_count+1;
  end loop;
  return jsonb_build_object('copied',copied_count,'skipped_existing',existing_count,'skipped_no_source',0);
end;
$$;

-- PostgreSQL cannot replace a function when its RETURNS TABLE shape changes.
-- Repository review found only the frontend RPC caller; no SQL view/function dependency.
drop function if exists public.list_creator_monthly_kpi_cards(date, text, text, uuid);
create function public.list_creator_monthly_kpi_cards(
  p_month date, p_search text default null, p_status text default null, p_manager_employee_id uuid default null
)
returns table(
  creator_entity_id uuid, creator_name text, manager_employee_id uuid, manager_name text,
  live_hours_target numeric, live_days_target integer, live_hours_current numeric, live_days_current integer,
  week_updated boolean, last_updated_at timestamptz, platforms jsonb, kpi_enrollment_status text
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_month date:=date_trunc('month',p_month)::date; v_current_week date:=public.creator_monthly_kpi_week_start(public.current_malaysia_business_date());
begin
  if auth.uid() is null or not (public.current_user_is_super_admin() or public.current_user_has_explicit_permission('agent-monthly-kpi','view')) then raise exception 'Permission denied.'; end if;
  if p_month is null or p_month<>v_month or p_status is not null and p_status not in ('pending','updated','achieved') then raise exception 'Invalid KPI card filter.' using errcode='22023'; end if;
  if p_manager_employee_id is not null and not public.current_user_is_super_admin() then raise exception 'Only Super Admin may filter by manager.'; end if;
  return query with canonical_revenue as (
    select ranked.* from (select r.*,row_number() over(partition by r.creator_profile_id,r.week_start_date order by r.updated_at desc nulls last,r.submitted_at desc nulls last,r.created_at desc nulls last,r.id desc) rn from public.creator_weekly_revenue_records r where r.status in ('submitted','confirmed') and r.week_start_date>=v_month and r.week_start_date<(v_month+interval '1 month')::date) ranked where ranked.rn=1
  ), scoped as (
    select e.*,k.id kpi_id,k.live_hours_target,k.live_days_target,en.status enrollment_status from public.creator_entities e left join public.creator_monthly_kpis k on k.creator_entity_id=e.id and k.target_month=v_month left join public.creator_monthly_kpi_enrollments en on en.creator_entity_id=e.id and en.target_month=v_month
    where e.status='active' and public.current_user_can_view_creator_monthly_kpi(e.id) and (p_manager_employee_id is null or e.manager_employee_id=p_manager_employee_id) and (nullif(btrim(coalesce(p_search,'')),'') is null or exists(select 1 from public.creator_profiles p where p.creator_entity_id=e.id and p.status='active' and p.membership_status='active' and concat_ws(' ',p.creator_name,p.platform_account,p.platform_user_id,p.platform_public_id) ilike '%'||btrim(p_search)||'%'))
  ), prepared as (
    select s.*,latest.live_hours_cumulative,latest.live_days_cumulative,latest.created_at latest_created_at,case when s.enrollment_status='required' then exists(select 1 from public.creator_monthly_kpi_weekly_updates w where w.creator_monthly_kpi_id=s.kpi_id and w.week_start_date=v_current_week) else false end is_week_updated,coalesce((select jsonb_agg(jsonb_build_object('platform',p.platform,'platform_account',p.platform_account,'platform_user_id',p.platform_user_id,'revenue_target',t.revenue_target,'revenue_current',coalesce(revenue.total,0)) order by p.platform) from public.creator_profiles p left join public.creator_monthly_kpi_revenue_targets t on t.creator_monthly_kpi_id=s.kpi_id and t.platform=p.platform left join lateral(select coalesce(sum(r.revenue_amount),0) total from canonical_revenue r where r.creator_profile_id=p.id) revenue on true where p.creator_entity_id=s.id and p.status='active' and p.membership_status='active'),'[]'::jsonb) platform_rows from scoped s left join lateral(select w.* from public.creator_monthly_kpi_weekly_updates w where w.creator_monthly_kpi_id=s.kpi_id order by w.week_start_date desc,w.created_at desc limit 1) latest on true
  )
  select p.id,p.display_name,p.manager_employee_id,coalesce(nullif(btrim(m.nickname),''),m.full_name),p.live_hours_target,p.live_days_target,coalesce(p.live_hours_cumulative,0),coalesce(p.live_days_cumulative,0),p.is_week_updated,p.latest_created_at,p.platform_rows,p.enrollment_status from prepared p left join public.employees m on m.id=p.manager_employee_id
  where p_status is null or (p_status='pending' and p.enrollment_status='required' and not p.is_week_updated) or (p_status='updated' and p.enrollment_status='required' and p.is_week_updated) or (p_status='achieved' and p.enrollment_status='required' and p.live_hours_target is not null and p.live_hours_cumulative>=p.live_hours_target and p.live_days_cumulative>=p.live_days_target and not exists(select 1 from jsonb_array_elements(p.platform_rows) x where (x->>'revenue_target') is null or (x->>'revenue_current')::numeric<(x->>'revenue_target')::numeric))
  order by p.display_name,p.id;
end;
$$;

revoke all on function public.save_creator_monthly_kpi_enrollments(date,jsonb) from public,anon;
grant execute on function public.save_creator_monthly_kpi_enrollments(date,jsonb) to authenticated;
revoke all on function public.list_creator_monthly_kpi_cards(date,text,text,uuid) from public,anon;
grant execute on function public.list_creator_monthly_kpi_cards(date,text,text,uuid) to authenticated;
commit;
