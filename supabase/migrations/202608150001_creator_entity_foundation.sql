-- Phase 1 creator entity foundation.
-- creator_profiles.status = profile data validity (active / invalid).
-- creator_profiles.membership_status = platform guild relationship (active / exited).
-- invalid is not the same as exited:
--   invalid means the platform profile data should be excluded as invalid/test/wrong data.
--   exited means the platform membership has ended while the historical profile remains valid.
-- This migration only establishes backward-compatible foundation structures.
-- It does not change existing business queries, statistics, RLS policies, revenue logic,
-- adjustment request logic, or creator profile status history behavior.

create table if not exists public.creator_entities (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  region_id uuid references public.regions(id) on delete set null,
  scout_employee_id uuid references public.employees(id) on delete set null,
  scout_profile_id uuid references public.profiles(id) on delete set null,
  manager_employee_id uuid references public.employees(id) on delete set null,
  status text not null default 'active',
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint creator_entities_status_check
    check (status in ('active', 'invalid'))
);

alter table public.creator_entities enable row level security;

create index if not exists creator_entities_region_id_idx
on public.creator_entities(region_id);

create index if not exists creator_entities_scout_employee_id_idx
on public.creator_entities(scout_employee_id);

create index if not exists creator_entities_manager_employee_id_idx
on public.creator_entities(manager_employee_id);

create index if not exists creator_entities_status_idx
on public.creator_entities(status);

drop trigger if exists set_creator_entities_updated_at on public.creator_entities;
create trigger set_creator_entities_updated_at
before update on public.creator_entities
for each row execute function public.set_updated_at();

alter table public.creator_profiles
add column if not exists creator_entity_id uuid references public.creator_entities(id) on delete restrict,
add column if not exists membership_status text not null default 'active',
add column if not exists exited_date date,
add column if not exists exited_reason text;

alter table public.creator_profiles
drop constraint if exists creator_profiles_membership_status_check;

alter table public.creator_profiles
add constraint creator_profiles_membership_status_check
check (membership_status in ('active', 'exited'));

alter table public.creator_profiles
drop constraint if exists creator_profiles_membership_exit_date_check;

alter table public.creator_profiles
add constraint creator_profiles_membership_exit_date_check
check (
  (membership_status = 'active' and exited_date is null)
  or (membership_status = 'exited' and exited_date is not null)
);

create index if not exists creator_profiles_creator_entity_id_idx
on public.creator_profiles(creator_entity_id);

create index if not exists creator_profiles_entity_platform_membership_idx
on public.creator_profiles(creator_entity_id, platform, membership_status);

create unique index if not exists creator_profiles_one_active_platform_per_entity_idx
on public.creator_profiles(creator_entity_id, platform)
where creator_entity_id is not null
  and membership_status = 'active';
