alter table public.scout_candidates
  add column if not exists region_id uuid references public.regions(id) on delete set null,
  add column if not exists platform public.creator_platform,
  add column if not exists platform_user_id text,
  add column if not exists platform_account text,
  add column if not exists talent text,
  add column if not exists follow_status text default 'pending',
  add column if not exists next_follow_up_date date,
  add column if not exists stopped_reason text,
  add column if not exists stopped_at timestamptz;

alter table public.scout_candidates
  drop constraint if exists scout_candidates_follow_status_check;

alter table public.scout_candidates
  add constraint scout_candidates_follow_status_check
  check (
    follow_status is null
    or follow_status in ('pending', 'following', 'interview', 'ready_onboarding', 'stopped')
  );

create index if not exists scout_candidates_region_id_idx
on public.scout_candidates(region_id);

create index if not exists scout_candidates_platform_identity_idx
on public.scout_candidates(platform, platform_user_id);

create index if not exists scout_candidates_next_follow_up_date_idx
on public.scout_candidates(next_follow_up_date);
