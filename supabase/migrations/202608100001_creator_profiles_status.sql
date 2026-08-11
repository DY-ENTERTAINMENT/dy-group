alter table public.creator_profiles
add column if not exists status text not null default 'active';

alter table public.creator_profiles
drop constraint if exists creator_profiles_status_check;

alter table public.creator_profiles
add constraint creator_profiles_status_check
check (status in ('active', 'invalid'));
