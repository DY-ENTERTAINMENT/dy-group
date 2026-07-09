do $$
begin
  create type public.creator_adjustment_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.creator_adjustment_type as enum ('to_online', 'to_company', 'to_5_1', 'change_manager', 'change_scout', 'change_bank', 'special');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.design_request_status as enum ('unclaimed', 'in_progress', 'confirming', 'revision', 'ok', 'completed', 'cancelled');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.design_request_type as enum ('banner', 'standee', 'poster', 'special');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.print_method as enum ('print', 'no_print', 'self_print');
exception when duplicate_object then null;
end $$;

create table if not exists public.creator_revenue_records (
  id uuid primary key default gen_random_uuid(),
  creator_profile_id uuid not null references public.creator_profiles(id) on delete cascade,
  revenue_month text not null,
  revenue_date date not null,
  revenue_amount numeric(14,2) not null default 0,
  kpi_days numeric(8,2) not null default 0,
  kpi_hours numeric(8,2) not null default 0,
  kpi_revenue numeric(14,2) not null default 0,
  achieved_days numeric(8,2) not null default 0,
  achieved_hours numeric(8,2) not null default 0,
  achieved_revenue numeric(14,2) not null default 0,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint creator_revenue_records_month_check check (revenue_month ~ '^\d{4}-\d{2}$'),
  constraint creator_revenue_records_unique unique (creator_profile_id, revenue_date)
);

create table if not exists public.creator_adjustment_requests (
  id uuid primary key default gen_random_uuid(),
  requester_profile_id uuid not null references public.profiles(id) on delete cascade,
  requester_employee_id uuid references public.employees(id) on delete set null,
  creator_profile_id uuid references public.creator_profiles(id) on delete set null,
  platform public.creator_platform not null,
  platform_user_id text,
  request_type public.creator_adjustment_type not null,
  effective_date date,
  full_name text,
  bank_name text,
  bank_account text,
  target_nickname text,
  target_email text,
  content text,
  status public.creator_adjustment_status not null default 'pending',
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.designer_requests (
  id uuid primary key default gen_random_uuid(),
  agent_profile_id uuid not null references public.profiles(id) on delete cascade,
  agent_employee_id uuid references public.employees(id) on delete set null,
  designer_profile_id uuid references public.profiles(id) on delete set null,
  designer_employee_id uuid references public.employees(id) on delete set null,
  request_type public.design_request_type not null,
  status public.design_request_status not null default 'unclaimed',
  platform public.creator_platform,
  platform_user_id text,
  creator_name text,
  platform_account text,
  fan_nickname text,
  fan_level text,
  design_content text,
  design_elements text,
  print_method public.print_method,
  special_content text,
  reference_urls text[] not null default '{}',
  design_urls text[] not null default '{}',
  revision_note text,
  accepted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists creator_revenue_records_month_idx on public.creator_revenue_records(revenue_month);
create index if not exists creator_revenue_records_creator_idx on public.creator_revenue_records(creator_profile_id);
create index if not exists creator_adjustment_requests_requester_idx on public.creator_adjustment_requests(requester_profile_id);
create index if not exists creator_adjustment_requests_status_idx on public.creator_adjustment_requests(status);
create index if not exists designer_requests_agent_idx on public.designer_requests(agent_profile_id);
create index if not exists designer_requests_designer_idx on public.designer_requests(designer_profile_id);
create index if not exists designer_requests_status_idx on public.designer_requests(status);

create or replace function public.current_user_employee_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.id
  from public.employees e
  where e.profile_id = auth.uid()
    and e.deleted_at is null
  limit 1
$$;

create or replace function public.sync_creator_adjustment_request()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_creator public.creator_profiles;
  target_employee public.employees;
begin
  if new.requester_employee_id is null then
    new.requester_employee_id := public.current_user_employee_id();
  end if;

  if new.creator_profile_id is null and new.platform_user_id is not null then
    select * into target_creator
    from public.creator_profiles cp
    where cp.platform = new.platform
      and cp.platform_user_id = new.platform_user_id
    limit 1;

    if target_creator.id is not null then
      new.creator_profile_id := target_creator.id;
    end if;
  end if;

  if tg_op = 'UPDATE' and new.status = 'approved' and old.status is distinct from 'approved' and new.creator_profile_id is not null then
    if new.request_type = 'to_online' then
      update public.creator_profiles set creator_type = 'online' where id = new.creator_profile_id;
    elsif new.request_type = 'to_company' then
      update public.creator_profiles set creator_type = 'company', bank_name = new.bank_name, bank_account = new.bank_account where id = new.creator_profile_id;
    elsif new.request_type = 'to_5_1' then
      update public.creator_profiles set creator_type = '5+1', bank_name = new.bank_name, bank_account = new.bank_account where id = new.creator_profile_id;
    elsif new.request_type = 'change_bank' then
      update public.creator_profiles set bank_name = new.bank_name, bank_account = new.bank_account where id = new.creator_profile_id;
    elsif new.request_type = 'change_manager' then
      select * into target_employee from public.employees where lower(email) = lower(coalesce(new.target_email, '')) and deleted_at is null limit 1;
      update public.creator_profiles set manager_employee_id = target_employee.id where id = new.creator_profile_id and target_employee.id is not null;
    elsif new.request_type = 'change_scout' then
      select * into target_employee from public.employees where lower(email) = lower(coalesce(new.target_email, '')) and deleted_at is null limit 1;
      update public.creator_profiles set scout_employee_id = target_employee.id, scout_profile_id = target_employee.profile_id where id = new.creator_profile_id and target_employee.id is not null;
    end if;
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists sync_creator_adjustment_request on public.creator_adjustment_requests;
create trigger sync_creator_adjustment_request
before insert or update on public.creator_adjustment_requests
for each row execute function public.sync_creator_adjustment_request();

drop trigger if exists set_creator_revenue_records_updated_at on public.creator_revenue_records;
create trigger set_creator_revenue_records_updated_at before update on public.creator_revenue_records for each row execute function public.set_updated_at();

drop trigger if exists set_creator_adjustment_requests_updated_at on public.creator_adjustment_requests;
create trigger set_creator_adjustment_requests_updated_at before update on public.creator_adjustment_requests for each row execute function public.set_updated_at();

drop trigger if exists set_designer_requests_updated_at on public.designer_requests;
create trigger set_designer_requests_updated_at before update on public.designer_requests for each row execute function public.set_updated_at();

alter table public.creator_revenue_records enable row level security;
alter table public.creator_adjustment_requests enable row level security;
alter table public.designer_requests enable row level security;

create policy "Agents and managers can read revenue records"
on public.creator_revenue_records for select to authenticated
using (
  exists (
    select 1 from public.creator_profiles cp
    where cp.id = creator_profile_id
      and (
        (cp.manager_employee_id = public.current_user_employee_id() and public.current_user_has_permission('agent-revenue-data', 'view'))
        or (public.current_user_has_permission('management-revenue-data', 'view') and public.current_user_can_access_region(cp.region_id))
      )
  )
);

create policy "Managers can write revenue records"
on public.creator_revenue_records for all to authenticated
using (public.current_user_has_permission('management-revenue-data', 'use'))
with check (public.current_user_has_permission('management-revenue-data', 'use'));

create policy "Agents can read own adjustment requests"
on public.creator_adjustment_requests for select to authenticated
using (requester_profile_id = auth.uid() or public.current_user_has_permission('management-streamer-stats', 'view'));

create policy "Agents can create own adjustment requests"
on public.creator_adjustment_requests for insert to authenticated
with check (requester_profile_id = auth.uid() and public.current_user_has_permission('agent-adjustment-requests', 'use'));

create policy "Managers can review adjustment requests"
on public.creator_adjustment_requests for update to authenticated
using (public.current_user_has_permission('management-streamer-stats', 'use'))
with check (public.current_user_has_permission('management-streamer-stats', 'use'));

create policy "Design requests are visible by workflow"
on public.designer_requests for select to authenticated
using (
  agent_profile_id = auth.uid()
  or designer_profile_id = auth.uid()
  or (status = 'unclaimed' and public.current_user_has_permission('designer-intake', 'view'))
);

create policy "Agents can create design requests"
on public.designer_requests for insert to authenticated
with check (agent_profile_id = auth.uid() and public.current_user_has_permission('agent-design-requests', 'use'));

create policy "Design workflow participants can update requests"
on public.designer_requests for update to authenticated
using (
  agent_profile_id = auth.uid()
  or designer_profile_id = auth.uid()
  or (status = 'unclaimed' and public.current_user_has_permission('designer-intake', 'use'))
)
with check (
  agent_profile_id = auth.uid()
  or designer_profile_id = auth.uid()
  or public.current_user_has_permission('designer-intake', 'use')
);

insert into public.permission_items (permission_key, parent_key, name, sort_order, is_reserved)
values
  ('agent', null, '经纪人', 20, false),
  ('agent-revenue-data', 'agent', '流水数据', 21, false),
  ('agent-creator-data', 'agent', '主播数据', 22, false),
  ('agent-adjustment-requests', 'agent', '主播资料调整申请', 23, false),
  ('agent-design-requests', 'agent', '美工申请', 24, false),
  ('designer', null, '美工', 30, false),
  ('designer-intake', 'designer', '接单', 31, false),
  ('designer-progress', 'designer', '进度', 32, false),
  ('management-revenue-data', 'management', '总流水数据', 95, false)
on conflict (permission_key) do update
set parent_key = excluded.parent_key,
    name = excluded.name,
    sort_order = excluded.sort_order,
    is_reserved = excluded.is_reserved;
