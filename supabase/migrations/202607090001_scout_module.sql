do $$
begin
  create type public.candidate_status as enum ('pending', 'accepted', 'rejected');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.creator_platform as enum ('tiktok', 'douyin');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.creator_type as enum ('5+1', 'online', 'offline', 'company');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.scout_candidates (
  id uuid primary key default gen_random_uuid(),
  scout_profile_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  gender text,
  age integer,
  source text,
  contact text,
  current_job text,
  remark text,
  status public.candidate_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scout_candidates_age_check check (age is null or (age >= 0 and age <= 120))
);

create table if not exists public.creator_profiles (
  id uuid primary key default gen_random_uuid(),
  joined_date date not null,
  platform public.creator_platform not null,
  platform_user_id text not null,
  platform_account text not null,
  region_id uuid references public.regions(id) on delete set null,
  creator_name text not null,
  scout_employee_id uuid references public.employees(id) on delete set null,
  scout_profile_id uuid references public.profiles(id) on delete set null,
  manager_employee_id uuid references public.employees(id) on delete set null,
  creator_type public.creator_type not null,
  bank_name text,
  bank_account text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint creator_profiles_platform_identity_unique unique (platform, platform_user_id),
  constraint creator_profiles_bank_required_check check (
    creator_type not in ('5+1', 'company')
    or (nullif(trim(coalesce(bank_name, '')), '') is not null and nullif(trim(coalesce(bank_account, '')), '') is not null)
  )
);

create index if not exists scout_candidates_scout_profile_id_idx on public.scout_candidates(scout_profile_id);
create index if not exists scout_candidates_status_idx on public.scout_candidates(status);
create index if not exists creator_profiles_joined_date_idx on public.creator_profiles(joined_date);
create index if not exists creator_profiles_platform_idx on public.creator_profiles(platform);
create index if not exists creator_profiles_region_id_idx on public.creator_profiles(region_id);
create index if not exists creator_profiles_scout_employee_id_idx on public.creator_profiles(scout_employee_id);
create index if not exists creator_profiles_scout_profile_id_idx on public.creator_profiles(scout_profile_id);
create index if not exists creator_profiles_manager_employee_id_idx on public.creator_profiles(manager_employee_id);
create index if not exists creator_profiles_creator_type_idx on public.creator_profiles(creator_type);

drop trigger if exists set_scout_candidates_updated_at on public.scout_candidates;
create trigger set_scout_candidates_updated_at
before update on public.scout_candidates
for each row execute function public.set_updated_at();

drop trigger if exists set_creator_profiles_updated_at on public.creator_profiles;
create trigger set_creator_profiles_updated_at
before update on public.creator_profiles
for each row execute function public.set_updated_at();

create or replace function public.set_creator_profiles_audit_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by = coalesce(new.created_by, auth.uid());
  end if;

  new.updated_by = auth.uid();
  return new;
end;
$$;

drop trigger if exists set_creator_profiles_audit_fields on public.creator_profiles;
create trigger set_creator_profiles_audit_fields
before insert or update on public.creator_profiles
for each row execute function public.set_creator_profiles_audit_fields();

alter table public.scout_candidates enable row level security;
alter table public.creator_profiles enable row level security;

drop policy if exists "Scouts can read own candidates" on public.scout_candidates;
create policy "Scouts can read own candidates"
on public.scout_candidates for select
to authenticated
using (
  scout_profile_id = auth.uid()
  and public.current_user_has_permission('scout-recruit-list', 'view')
);

drop policy if exists "Scouts can create own candidates" on public.scout_candidates;
create policy "Scouts can create own candidates"
on public.scout_candidates for insert
to authenticated
with check (
  scout_profile_id = auth.uid()
  and public.current_user_has_permission('scout-recruit-list', 'use')
);

drop policy if exists "Scouts can update own candidates" on public.scout_candidates;
create policy "Scouts can update own candidates"
on public.scout_candidates for update
to authenticated
using (
  scout_profile_id = auth.uid()
  and public.current_user_has_permission('scout-recruit-list', 'use')
)
with check (
  scout_profile_id = auth.uid()
  and public.current_user_has_permission('scout-recruit-list', 'use')
);

drop policy if exists "Users can read scoped creator profiles" on public.creator_profiles;
create policy "Users can read scoped creator profiles"
on public.creator_profiles for select
to authenticated
using (
  (
    scout_profile_id = auth.uid()
    and (
      public.current_user_has_permission('scout-recruiting-data', 'view')
      or public.current_user_has_permission('scout-streamer-stats', 'view')
    )
  )
  or (
    public.current_user_has_permission('management-streamer-stats', 'view')
    and public.current_user_can_access_region(region_id)
  )
  or (
    public.current_user_has_permission('management-recruiting-data', 'view')
    and public.current_user_can_access_region(region_id)
  )
);

drop policy if exists "Users can create creator profiles" on public.creator_profiles;
create policy "Users can create creator profiles"
on public.creator_profiles for insert
to authenticated
with check (
  (
    public.current_user_has_permission('scout-onboarding', 'use')
    and public.current_user_can_access_region(region_id)
  )
  or (
    public.current_user_has_permission('management-streamer-stats', 'use')
    and public.current_user_can_access_region(region_id)
  )
);

drop policy if exists "Users can update scoped creator profiles" on public.creator_profiles;
create policy "Users can update scoped creator profiles"
on public.creator_profiles for update
to authenticated
using (
  (
    scout_profile_id = auth.uid()
    and public.current_user_has_permission('scout-onboarding', 'use')
  )
  or (
    public.current_user_has_permission('management-streamer-stats', 'use')
    and public.current_user_can_access_region(region_id)
  )
)
with check (
  (
    scout_profile_id = auth.uid()
    and public.current_user_has_permission('scout-onboarding', 'use')
    and public.current_user_can_access_region(region_id)
  )
  or (
    public.current_user_has_permission('management-streamer-stats', 'use')
    and public.current_user_can_access_region(region_id)
  )
);

insert into public.permission_items (permission_key, parent_key, name, sort_order, is_reserved)
values
  ('scout', null, '星探', 10, false),
  ('scout-recruiting-data', 'scout', '招募数据', 11, false),
  ('scout-recruit-list', 'scout', '名单', 12, false),
  ('scout-onboarding', 'scout', '入公会', 13, false),
  ('scout-streamer-stats', 'scout', '主播统计', 14, false),
  ('management', null, '管理', 90, false),
  ('management-streamer-stats', 'management', '总主播统计', 96, false),
  ('management-recruiting-data', 'management', '总招募数据', 97, false)
on conflict (permission_key) do update
set
  parent_key = excluded.parent_key,
  name = excluded.name,
  sort_order = excluded.sort_order,
  is_reserved = excluded.is_reserved;
