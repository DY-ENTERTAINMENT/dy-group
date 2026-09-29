begin;

-- Phase 1 is intentionally additive. Existing creator revenue storage, write
-- paths, historical data, and entity merge behavior are not changed.
insert into public.permission_items (permission_key, parent_key, name, sort_order, is_active, is_reserved)
values ('agent-monthly-kpi', 'agent', '主播月度 KPI', 28, true, false)
on conflict (permission_key) do update set parent_key = excluded.parent_key, name = excluded.name, sort_order = excluded.sort_order, is_active = true, is_reserved = false;

create table public.creator_monthly_kpis (
  id uuid primary key default gen_random_uuid(),
  creator_entity_id uuid not null references public.creator_entities(id) on delete restrict,
  target_month date not null,
  live_hours_target numeric(10,2) not null check (live_hours_target >= 0),
  live_days_target integer not null check (live_days_target >= 0),
  created_by_employee_id uuid references public.employees(id) on delete set null,
  updated_by_employee_id uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint creator_monthly_kpis_month_start_check check (target_month = date_trunc('month', target_month)::date),
  constraint creator_monthly_kpis_entity_month_unique unique (creator_entity_id, target_month)
);

create table public.creator_monthly_kpi_revenue_targets (
  id uuid primary key default gen_random_uuid(),
  creator_monthly_kpi_id uuid not null references public.creator_monthly_kpis(id) on delete restrict,
  platform public.creator_platform not null,
  revenue_target numeric(14,2) not null check (revenue_target >= 0),
  created_by_employee_id uuid references public.employees(id) on delete set null,
  updated_by_employee_id uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint creator_monthly_kpi_revenue_targets_kpi_platform_unique unique (creator_monthly_kpi_id, platform)
);

create table public.creator_monthly_kpi_weekly_updates (
  id uuid primary key default gen_random_uuid(),
  creator_monthly_kpi_id uuid not null references public.creator_monthly_kpis(id) on delete restrict,
  week_start_date date not null,
  live_hours_cumulative numeric(10,2) not null check (live_hours_cumulative >= 0),
  live_days_cumulative integer not null check (live_days_cumulative >= 0),
  update_kind text not null check (update_kind in ('reported', 'confirmed_no_change')),
  updated_by_employee_id uuid references public.employees(id) on delete set null,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  constraint creator_monthly_kpi_weekly_updates_idempotency_unique unique (creator_monthly_kpi_id, idempotency_key)
);

create index creator_monthly_kpis_month_entity_idx on public.creator_monthly_kpis(target_month, creator_entity_id);
create index creator_monthly_kpi_revenue_targets_kpi_platform_idx on public.creator_monthly_kpi_revenue_targets(creator_monthly_kpi_id, platform);
create index creator_monthly_kpi_weekly_updates_latest_idx on public.creator_monthly_kpi_weekly_updates(creator_monthly_kpi_id, week_start_date, created_at desc);

create trigger set_creator_monthly_kpis_updated_at before update on public.creator_monthly_kpis for each row execute function public.set_updated_at();
create trigger set_creator_monthly_kpi_revenue_targets_updated_at before update on public.creator_monthly_kpi_revenue_targets for each row execute function public.set_updated_at();

create or replace function public.prevent_creator_monthly_kpi_weekly_updates_changes()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  raise exception 'Creator monthly KPI weekly updates are append-only.';
end;
$$;
create trigger prevent_creator_monthly_kpi_weekly_updates_changes
before update or delete on public.creator_monthly_kpi_weekly_updates
for each row execute function public.prevent_creator_monthly_kpi_weekly_updates_changes();

alter table public.creator_monthly_kpis enable row level security;
alter table public.creator_monthly_kpi_revenue_targets enable row level security;
alter table public.creator_monthly_kpi_weekly_updates enable row level security;
revoke all on public.creator_monthly_kpis, public.creator_monthly_kpi_revenue_targets, public.creator_monthly_kpi_weekly_updates from public, anon, authenticated;

create or replace function public.creator_monthly_kpi_week_start(p_date date)
returns date language sql immutable strict set search_path = public, pg_temp as $$
  select p_date - (extract(isodow from p_date)::integer - 1)
$$;

create or replace function public.current_user_can_manage_creator_monthly_kpi(p_creator_entity_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.current_user_is_super_admin() or exists (
    select 1 from public.creator_entities entity
    where entity.id = p_creator_entity_id
      and entity.status = 'active'
      and entity.manager_employee_id = public.current_user_employee_id()
      and public.current_user_can_access_region(entity.region_id)
      and public.current_user_has_explicit_permission('agent-monthly-kpi', 'use')
  )
$$;

create or replace function public.current_user_can_view_creator_monthly_kpi(p_creator_entity_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.current_user_is_super_admin() or exists (
    select 1 from public.creator_entities entity
    where entity.id = p_creator_entity_id
      and entity.status = 'active'
      and entity.manager_employee_id = public.current_user_employee_id()
      and public.current_user_can_access_region(entity.region_id)
      and public.current_user_has_explicit_permission('agent-monthly-kpi', 'view')
  )
$$;

create or replace function public.list_creator_monthly_kpi_manager_options()
returns table(id uuid, display_name text)
language sql stable security definer set search_path = public, pg_temp as $$
  select employee.id, coalesce(nullif(btrim(employee.nickname), ''), employee.full_name)
  from public.employees employee
  where public.current_user_is_super_admin()
    and employee.deleted_at is null
    and exists (select 1 from public.creator_entities entity where entity.status = 'active' and entity.manager_employee_id = employee.id)
  order by coalesce(nullif(btrim(employee.nickname), ''), employee.full_name), employee.id
$$;

create or replace function public.list_creator_monthly_kpi_cards(
  p_month date, p_search text default null, p_status text default null, p_manager_employee_id uuid default null
)
returns table(
  creator_entity_id uuid, creator_name text, manager_employee_id uuid, manager_name text,
  live_hours_target numeric, live_days_target integer, live_hours_current numeric, live_days_current integer,
  week_updated boolean, last_updated_at timestamptz, platforms jsonb
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_month date := date_trunc('month', p_month)::date; v_current_week date := public.creator_monthly_kpi_week_start(public.current_malaysia_business_date());
begin
  if auth.uid() is null or not (public.current_user_is_super_admin() or public.current_user_has_explicit_permission('agent-monthly-kpi', 'view')) then raise exception 'Permission denied.'; end if;
  if p_month is null or p_month <> v_month or p_status is not null and p_status not in ('pending','updated','achieved') then raise exception 'Invalid KPI card filter.' using errcode = '22023'; end if;
  if p_manager_employee_id is not null and not public.current_user_is_super_admin() then raise exception 'Only Super Admin may filter by manager.'; end if;
  return query
  with canonical_revenue as (
    select ranked.* from (
      select record.*, row_number() over (partition by record.creator_profile_id, record.week_start_date order by record.updated_at desc nulls last, record.submitted_at desc nulls last, record.created_at desc nulls last, record.id desc) as rn
      from public.creator_weekly_revenue_records record
      where record.status in ('submitted','confirmed') and record.week_start_date >= v_month and record.week_start_date < (v_month + interval '1 month')::date
    ) ranked where ranked.rn = 1
  ), scoped as (
    select entity.*, kpi.id as kpi_id, kpi.live_hours_target, kpi.live_days_target
    from public.creator_entities entity
    left join public.creator_monthly_kpis kpi on kpi.creator_entity_id = entity.id and kpi.target_month = v_month
    where entity.status = 'active'
      and public.current_user_can_view_creator_monthly_kpi(entity.id)
      and (p_manager_employee_id is null or entity.manager_employee_id = p_manager_employee_id)
      and (nullif(btrim(coalesce(p_search,'')), '') is null or exists (
        select 1 from public.creator_profiles profile
        where profile.creator_entity_id = entity.id and profile.status = 'active' and profile.membership_status = 'active'
          and concat_ws(' ', profile.creator_name, profile.platform_account, profile.platform_user_id, profile.platform_public_id) ilike '%' || btrim(p_search) || '%'
      ))
  ), prepared as (
    select scoped.*, latest.week_start_date as latest_week_start, latest.live_hours_cumulative, latest.live_days_cumulative, latest.created_at as latest_created_at,
      exists(select 1 from public.creator_monthly_kpi_weekly_updates week_update where week_update.creator_monthly_kpi_id = scoped.kpi_id and week_update.week_start_date = v_current_week) as is_week_updated,
      coalesce((select jsonb_agg(jsonb_build_object('platform', profile.platform, 'platform_account', profile.platform_account, 'platform_user_id', profile.platform_user_id, 'revenue_target', target.revenue_target, 'revenue_current', coalesce(revenue.total, 0)) order by profile.platform)
        from public.creator_profiles profile
        left join public.creator_monthly_kpi_revenue_targets target on target.creator_monthly_kpi_id = scoped.kpi_id and target.platform = profile.platform
        left join lateral (select coalesce(sum(record.revenue_amount), 0) as total from canonical_revenue record where record.creator_profile_id = profile.id) revenue on true
        where profile.creator_entity_id = scoped.id and profile.status = 'active' and profile.membership_status = 'active'), '[]'::jsonb) as platform_rows
    from scoped
    left join lateral (select update_row.* from public.creator_monthly_kpi_weekly_updates update_row where update_row.creator_monthly_kpi_id = scoped.kpi_id order by update_row.week_start_date desc, update_row.created_at desc limit 1) latest on true
  )
  select prepared.id, prepared.display_name, prepared.manager_employee_id, coalesce(nullif(btrim(manager.nickname), ''), manager.full_name),
    prepared.live_hours_target, prepared.live_days_target, coalesce(prepared.live_hours_cumulative, 0), coalesce(prepared.live_days_cumulative, 0), prepared.is_week_updated, prepared.latest_created_at, prepared.platform_rows
  from prepared left join public.employees manager on manager.id = prepared.manager_employee_id
  where (p_status is null or (p_status = 'pending' and not prepared.is_week_updated) or (p_status = 'updated' and prepared.is_week_updated) or (p_status = 'achieved' and prepared.live_hours_target is not null and prepared.live_hours_cumulative >= prepared.live_hours_target and prepared.live_days_cumulative >= prepared.live_days_target and not exists (select 1 from jsonb_array_elements(prepared.platform_rows) platform where (platform->>'revenue_target') is null or (platform->>'revenue_current')::numeric < (platform->>'revenue_target')::numeric)))
  order by prepared.display_name, prepared.id;
end;
$$;

create or replace function public.get_creator_monthly_kpi_history(p_creator_entity_id uuid, p_month date)
returns table(id uuid, week_start_date date, live_hours_cumulative numeric, live_days_cumulative integer, update_kind text, updated_by_name text, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select update_row.id, update_row.week_start_date, update_row.live_hours_cumulative, update_row.live_days_cumulative, update_row.update_kind, coalesce(nullif(btrim(employee.nickname), ''), employee.full_name), update_row.created_at
  from public.creator_monthly_kpis kpi join public.creator_monthly_kpi_weekly_updates update_row on update_row.creator_monthly_kpi_id = kpi.id left join public.employees employee on employee.id = update_row.updated_by_employee_id
  where kpi.creator_entity_id = p_creator_entity_id and kpi.target_month = date_trunc('month', p_month)::date and public.current_user_can_view_creator_monthly_kpi(kpi.creator_entity_id)
  order by update_row.week_start_date, update_row.created_at;
$$;

create or replace function public.save_creator_monthly_kpi_targets(p_month date, p_targets jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare item jsonb; target_kpi public.creator_monthly_kpis; v_entity uuid; v_hours numeric; v_days integer; v_platforms jsonb; v_employee uuid := public.current_user_employee_id();
begin
  if p_month is null or p_month <> date_trunc('month', p_month)::date or p_month < date_trunc('month', public.current_malaysia_business_date())::date then raise exception 'Historical KPI months cannot be changed.'; end if;
  if jsonb_typeof(p_targets) <> 'array' or jsonb_array_length(p_targets) = 0 then raise exception 'At least one KPI target is required.'; end if;
  for item in select value from jsonb_array_elements(p_targets) loop
    v_entity := (item->>'creator_entity_id')::uuid; v_hours := (item->>'live_hours_target')::numeric; v_days := (item->>'live_days_target')::integer; v_platforms := item->'platform_targets';
    if v_hours < 0 or v_days < 0 or jsonb_typeof(v_platforms) <> 'array' or not public.current_user_can_manage_creator_monthly_kpi(v_entity) then raise exception 'Invalid KPI target or creator access denied.'; end if;
    if (select count(*) from jsonb_to_recordset(v_platforms) value(platform public.creator_platform, revenue_target numeric)) <> (select count(*) from public.creator_profiles profile where profile.creator_entity_id = v_entity and profile.status = 'active' and profile.membership_status = 'active') or exists (select 1 from jsonb_to_recordset(v_platforms) value(platform public.creator_platform, revenue_target numeric) where value.revenue_target < 0) or exists (select 1 from jsonb_to_recordset(v_platforms) value(platform public.creator_platform, revenue_target numeric) where not exists (select 1 from public.creator_profiles profile where profile.creator_entity_id = v_entity and profile.platform = value.platform and profile.status = 'active' and profile.membership_status = 'active')) then raise exception 'Platform KPI targets must exactly match active platforms.'; end if;
    insert into public.creator_monthly_kpis(creator_entity_id, target_month, live_hours_target, live_days_target, created_by_employee_id, updated_by_employee_id) values(v_entity, p_month, v_hours, v_days, v_employee, v_employee) on conflict (creator_entity_id, target_month) do update set live_hours_target = excluded.live_hours_target, live_days_target = excluded.live_days_target, updated_by_employee_id = excluded.updated_by_employee_id returning * into target_kpi;
    insert into public.creator_monthly_kpi_revenue_targets(creator_monthly_kpi_id, platform, revenue_target, created_by_employee_id, updated_by_employee_id) select target_kpi.id, value.platform, value.revenue_target, v_employee, v_employee from jsonb_to_recordset(v_platforms) value(platform public.creator_platform, revenue_target numeric) on conflict (creator_monthly_kpi_id, platform) do update set revenue_target = excluded.revenue_target, updated_by_employee_id = excluded.updated_by_employee_id;
  end loop;
end;
$$;

create or replace function public.copy_creator_monthly_kpi_targets(p_source_month date, p_target_month date)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare copied_count integer := 0; existing_count integer := 0; source record; new_kpi public.creator_monthly_kpis; v_employee uuid := public.current_user_employee_id();
begin
  if p_source_month is null or p_target_month is null or p_source_month <> date_trunc('month', p_source_month)::date or p_target_month <> date_trunc('month', p_target_month)::date or p_target_month < date_trunc('month', public.current_malaysia_business_date())::date then raise exception 'Invalid source or target KPI month.'; end if;
  for source in select kpi.* from public.creator_monthly_kpis kpi where kpi.target_month = p_source_month and public.current_user_can_manage_creator_monthly_kpi(kpi.creator_entity_id) loop
    if exists(select 1 from public.creator_monthly_kpis target where target.creator_entity_id = source.creator_entity_id and target.target_month = p_target_month) then existing_count := existing_count + 1; continue; end if;
    insert into public.creator_monthly_kpis(creator_entity_id, target_month, live_hours_target, live_days_target, created_by_employee_id, updated_by_employee_id) values(source.creator_entity_id, p_target_month, source.live_hours_target, source.live_days_target, v_employee, v_employee) on conflict (creator_entity_id, target_month) do nothing returning * into new_kpi;
    if new_kpi.id is null then existing_count := existing_count + 1; continue; end if;
    insert into public.creator_monthly_kpi_revenue_targets(creator_monthly_kpi_id, platform, revenue_target, created_by_employee_id, updated_by_employee_id) select new_kpi.id, target.platform, target.revenue_target, v_employee, v_employee from public.creator_monthly_kpi_revenue_targets target where target.creator_monthly_kpi_id = source.id;
    copied_count := copied_count + 1;
  end loop;
  return jsonb_build_object('copied', copied_count, 'skipped_existing', existing_count, 'skipped_no_source', 0);
end;
$$;

create or replace function public.save_creator_monthly_kpi_weekly_update(p_creator_entity_id uuid, p_month date, p_live_hours_cumulative numeric, p_live_days_cumulative integer, p_update_kind text, p_idempotency_key uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare target_kpi public.creator_monthly_kpis; v_week date := public.creator_monthly_kpi_week_start(public.current_malaysia_business_date());
begin
  if p_month is null or p_month <> date_trunc('month', public.current_malaysia_business_date())::date or p_live_hours_cumulative is null or p_live_hours_cumulative < 0 or p_live_days_cumulative is null or p_live_days_cumulative < 0 or p_update_kind not in ('reported','confirmed_no_change') or p_idempotency_key is null then raise exception 'Weekly KPI updates are only allowed for the current MYT month.'; end if;
  select * into target_kpi from public.creator_monthly_kpis where creator_entity_id = p_creator_entity_id and target_month = p_month;
  if target_kpi.id is null or not public.current_user_can_manage_creator_monthly_kpi(p_creator_entity_id) then raise exception 'Creator KPI not found or access denied.'; end if;
  insert into public.creator_monthly_kpi_weekly_updates(creator_monthly_kpi_id, week_start_date, live_hours_cumulative, live_days_cumulative, update_kind, updated_by_employee_id, idempotency_key) values(target_kpi.id, v_week, p_live_hours_cumulative, p_live_days_cumulative, p_update_kind, public.current_user_employee_id(), p_idempotency_key) on conflict (creator_monthly_kpi_id, idempotency_key) do nothing;
end;
$$;

revoke all on function public.creator_monthly_kpi_week_start(date), public.current_user_can_manage_creator_monthly_kpi(uuid), public.current_user_can_view_creator_monthly_kpi(uuid), public.prevent_creator_monthly_kpi_weekly_updates_changes() from public, anon, authenticated;
revoke all on function public.list_creator_monthly_kpi_cards(date, text, text, uuid), public.list_creator_monthly_kpi_manager_options(), public.get_creator_monthly_kpi_history(uuid, date), public.save_creator_monthly_kpi_targets(date, jsonb), public.copy_creator_monthly_kpi_targets(date, date), public.save_creator_monthly_kpi_weekly_update(uuid, date, numeric, integer, text, uuid) from public, anon;
grant execute on function public.list_creator_monthly_kpi_cards(date, text, text, uuid), public.list_creator_monthly_kpi_manager_options(), public.get_creator_monthly_kpi_history(uuid, date), public.save_creator_monthly_kpi_targets(date, jsonb), public.copy_creator_monthly_kpi_targets(date, date), public.save_creator_monthly_kpi_weekly_update(uuid, date, numeric, integer, text, uuid) to authenticated;

commit;
