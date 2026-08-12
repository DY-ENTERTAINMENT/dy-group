begin;

create table if not exists public.region_permission_settings (
  id uuid primary key default gen_random_uuid(),
  region_id uuid not null references public.regions(id) on delete cascade,
  permission_key text not null references public.permission_items(permission_key) on delete cascade,
  can_view boolean not null default false,
  can_use boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint region_permission_settings_unique unique (region_id, permission_key),
  constraint region_permission_settings_use_requires_view check (can_view or not can_use)
);

create index if not exists region_permission_settings_permission_key_idx
on public.region_permission_settings(permission_key);

drop trigger if exists set_region_permission_settings_updated_at
on public.region_permission_settings;
create trigger set_region_permission_settings_updated_at
before update on public.region_permission_settings
for each row execute function public.set_updated_at();

insert into public.permission_items (permission_key, parent_key, name, sort_order, is_reserved)
values
  ('replacement-leave', null, 'Replacement Leave', 46, false),
  ('work-time-adjustment-employee', null, 'Work Time Adjustment Employee', 47, false)
on conflict (permission_key) do nothing;

insert into public.region_permission_settings (
  region_id,
  permission_key,
  can_view,
  can_use
)
select
  r.id,
  feature.permission_key,
  case when r.code = 'KCH' then true else false end as can_view,
  case when r.code = 'KCH' then true else false end as can_use
from public.regions r
cross join (
  values
    ('replacement-leave'),
    ('work-time-adjustment-employee')
) as feature(permission_key)
where r.code in ('KCH', 'KL')
on conflict (region_id, permission_key) do nothing;

create or replace function public.current_user_has_region_feature_permission(
  p_permission_key text,
  p_action text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  current_region_id uuid;
begin
  if p_action is null or p_action not in ('view', 'use') then
    raise exception 'Unsupported permission action: %', p_action
      using errcode = '22023';
  end if;

  select e.region_id
  into current_region_id
  from public.profiles p
  join public.employees e
    on e.profile_id = p.id
    and e.deleted_at is null
  where p.id = auth.uid()
    and p.status = 'approved'
  limit 1;

  if current_region_id is null then
    return false;
  end if;

  return exists (
    select 1
    from public.region_permission_settings rps
    join public.permission_items pi
      on pi.permission_key = rps.permission_key
      and pi.is_active = true
    where rps.region_id = current_region_id
      and rps.permission_key = p_permission_key
      and case
        when p_action = 'view' then rps.can_view
        else rps.can_view and rps.can_use
      end
  );
end;
$$;

revoke all on function public.current_user_has_region_feature_permission(text, text) from public;
grant execute on function public.current_user_has_region_feature_permission(text, text) to authenticated, service_role;

alter table public.region_permission_settings enable row level security;

drop policy if exists "Super admins can read all region permission settings"
on public.region_permission_settings;
create policy "Super admins can read all region permission settings"
on public.region_permission_settings
for select
to authenticated
using (public.current_user_is_super_admin());

drop policy if exists "Employees can read own region permission settings"
on public.region_permission_settings;
create policy "Employees can read own region permission settings"
on public.region_permission_settings
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    join public.employees e
      on e.profile_id = p.id
      and e.deleted_at is null
    where p.id = auth.uid()
      and p.status = 'approved'
      and e.region_id = region_permission_settings.region_id
  )
);

drop policy if exists "Super admins can create region permission settings"
on public.region_permission_settings;
create policy "Super admins can create region permission settings"
on public.region_permission_settings
for insert
to authenticated
with check (public.current_user_is_super_admin());

drop policy if exists "Super admins can update region permission settings"
on public.region_permission_settings;
create policy "Super admins can update region permission settings"
on public.region_permission_settings
for update
to authenticated
using (public.current_user_is_super_admin())
with check (public.current_user_is_super_admin());

drop policy if exists "Super admins can delete region permission settings"
on public.region_permission_settings;
create policy "Super admins can delete region permission settings"
on public.region_permission_settings
for delete
to authenticated
using (public.current_user_is_super_admin());

commit;
