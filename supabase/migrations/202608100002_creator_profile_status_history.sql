create table if not exists public.creator_profile_status_history (
  id uuid primary key default gen_random_uuid(),
  creator_profile_id uuid not null references public.creator_profiles(id) on delete restrict,
  from_status text,
  to_status text not null,
  reason text,
  changed_by uuid references public.profiles(id) on delete set null default auth.uid(),
  changed_at timestamptz not null default now(),
  constraint creator_profile_status_history_from_status_check
    check (from_status is null or from_status in ('active', 'invalid')),
  constraint creator_profile_status_history_to_status_check
    check (to_status in ('active', 'invalid')),
  constraint creator_profile_status_history_invalid_reason_check
    check (
      to_status <> 'invalid'
      or nullif(trim(coalesce(reason, '')), '') is not null
    )
);

create index if not exists creator_profile_status_history_creator_changed_idx
on public.creator_profile_status_history(creator_profile_id, changed_at desc);
