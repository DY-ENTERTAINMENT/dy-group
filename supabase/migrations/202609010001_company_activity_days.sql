begin;

create table if not exists public.company_activity_days (
  id uuid primary key default gen_random_uuid(),
  activity_name text not null,
  activity_date date not null,
  region_id uuid references public.regions(id) on delete set null,
  attendance_exempt boolean not null default true,
  notes text,
  status text not null default 'active' check (status in ('active', 'voided')),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_activity_days_name_check check (length(trim(activity_name)) > 0)
);

create index if not exists company_activity_days_date_idx on public.company_activity_days(activity_date);
create index if not exists company_activity_days_region_idx on public.company_activity_days(region_id);
create unique index if not exists company_activity_days_active_date_region_idx on public.company_activity_days(activity_date, coalesce(region_id, '00000000-0000-0000-0000-000000000000'::uuid)) where status = 'active';

create or replace function public.prevent_company_activity_overlap() returns trigger language plpgsql as $$
begin
  perform pg_advisory_xact_lock((new.activity_date - date '2000-01-01')::bigint);
  if new.status = 'active' and exists (select 1 from public.company_activity_days x where x.id <> new.id and x.status = 'active' and x.activity_date = new.activity_date and (x.region_id is null or new.region_id is null)) then
    raise exception '同一天的公司活动区域范围不能重叠。';
  end if;
  return new;
end; $$;
drop trigger if exists prevent_company_activity_overlap on public.company_activity_days;
create trigger prevent_company_activity_overlap before insert or update on public.company_activity_days for each row execute function public.prevent_company_activity_overlap();
drop trigger if exists set_company_activity_days_updated_at on public.company_activity_days;
create trigger set_company_activity_days_updated_at before update on public.company_activity_days for each row execute function public.set_updated_at();

create or replace function public.get_attendance_company_activity_days(
  p_start_date date,
  p_end_date date,
  p_region_id uuid default null
)
returns table (
  id uuid,
  activity_date date,
  region_id uuid,
  attendance_exempt boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_start_date is null or p_end_date is null then
    raise exception 'Start date and end date are required.';
  end if;

  if p_start_date > p_end_date then
    raise exception 'Start date must be before or equal to end date.';
  end if;

  if not public.current_user_has_permission('attendance-management', 'view') then
    raise exception 'No permission to view attendance company activities.';
  end if;

  if p_region_id is not null and not public.current_user_can_access_region(p_region_id) then
    raise exception 'No permission to view attendance company activities in this region.';
  end if;

  return query
  select
    activity.id,
    activity.activity_date,
    activity.region_id,
    activity.attendance_exempt
  from public.company_activity_days activity
  where activity.status = 'active'
    and activity.attendance_exempt = true
    and activity.activity_date between p_start_date and p_end_date
    and (p_region_id is null or activity.region_id is null or activity.region_id = p_region_id)
    and (
      activity.region_id is null
      or activity.region_id in (select public.current_user_authorized_region_ids())
    )
  order by activity.activity_date, activity.id;
end;
$$;

revoke all on function public.get_attendance_company_activity_days(date, date, uuid) from public;
grant execute on function public.get_attendance_company_activity_days(date, date, uuid) to authenticated;

alter table public.company_activity_days enable row level security;
drop policy if exists "Users can read scoped company activities" on public.company_activity_days;
create policy "Users can read scoped company activities" on public.company_activity_days for select to authenticated using (
  public.current_user_is_super_admin()
  or (region_id is not null and public.current_user_can_access_region(region_id))
);
drop policy if exists "Users can manage company activities" on public.company_activity_days;
create policy "Users can manage company activities" on public.company_activity_days for all to authenticated using (
  public.current_user_is_super_admin()
  or (
    public.current_user_has_permission('public-holidays', 'use')
    and region_id is not null
    and public.current_user_can_access_region(region_id)
  )
) with check (
  public.current_user_is_super_admin()
  or (
    public.current_user_has_permission('public-holidays', 'use')
    and region_id is not null
    and public.current_user_can_access_region(region_id)
  )
);

commit;
