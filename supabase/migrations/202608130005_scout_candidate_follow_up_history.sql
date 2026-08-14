create table if not exists public.scout_candidate_follow_up_history (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.scout_candidates(id) on delete restrict,
  scout_profile_id uuid not null references public.profiles(id) on delete restrict,
  action_type text not null,
  from_follow_status text,
  to_follow_status text not null,
  previous_next_follow_up_date date,
  next_follow_up_date date,
  note text,
  stopped_reason text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint scout_candidate_follow_up_history_action_type_check
    check (action_type in ('follow_up', 'stopped', 'reopened')),
  constraint scout_candidate_follow_up_history_from_status_check
    check (
      from_follow_status is null
      or from_follow_status in ('pending', 'following', 'interview', 'ready_onboarding', 'stopped')
    ),
  constraint scout_candidate_follow_up_history_to_status_check
    check (to_follow_status in ('pending', 'following', 'interview', 'ready_onboarding', 'stopped')),
  constraint scout_candidate_follow_up_history_stopped_reason_check
    check (
      action_type <> 'stopped'
      or nullif(btrim(coalesce(stopped_reason, '')), '') is not null
    )
);

create index if not exists scout_candidate_follow_up_history_candidate_created_idx
on public.scout_candidate_follow_up_history(candidate_id, created_at desc);

create index if not exists scout_candidate_follow_up_history_scout_created_idx
on public.scout_candidate_follow_up_history(scout_profile_id, created_at desc);

alter table public.scout_candidate_follow_up_history enable row level security;

revoke all on public.scout_candidate_follow_up_history from public;
revoke all on public.scout_candidate_follow_up_history from authenticated;
grant select on public.scout_candidate_follow_up_history to authenticated;

drop policy if exists "Scouts can read own follow up history" on public.scout_candidate_follow_up_history;
create policy "Scouts can read own follow up history"
on public.scout_candidate_follow_up_history
for select
to authenticated
using (
  scout_profile_id = auth.uid()
  and public.current_user_has_permission('scout-recruit-list', 'view')
);

revoke update on public.scout_candidates from public;
revoke update on public.scout_candidates from authenticated;
revoke insert on public.scout_candidates from public;
revoke insert on public.scout_candidates from authenticated;
grant insert (
  scout_profile_id,
  name,
  gender,
  age,
  source,
  contact,
  current_job,
  remark,
  status,
  platform,
  platform_user_id,
  platform_account,
  talent
) on public.scout_candidates to authenticated;
grant update (
  name,
  gender,
  age,
  source,
  contact,
  current_job,
  remark,
  status,
  platform,
  platform_user_id,
  platform_account,
  talent
) on public.scout_candidates to authenticated;

create or replace function public.add_scout_candidate_follow_up(
  p_candidate_id uuid,
  p_to_follow_status text,
  p_note text default null,
  p_next_follow_up_date date default null,
  p_stopped_reason text default null
)
returns public.scout_candidates
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid;
  v_candidate public.scout_candidates%rowtype;
  v_updated_candidate public.scout_candidates%rowtype;
  v_current_status text;
  v_to_status text;
  v_action_type text;
  v_note text;
  v_stopped_reason text;
  v_next_follow_up_date date;
  v_now timestamptz := now();
begin
  v_profile_id := auth.uid();

  if v_profile_id is null then
    raise exception 'Authentication is required.'
      using errcode = '28000';
  end if;

  if not public.current_user_has_permission('scout-recruit-list', 'use') then
    raise exception 'Permission denied.'
      using errcode = '42501';
  end if;

  v_to_status := nullif(btrim(coalesce(p_to_follow_status, '')), '');
  if v_to_status is null or v_to_status not in ('pending', 'following', 'interview', 'ready_onboarding', 'stopped') then
    raise exception 'Unsupported follow status: %', p_to_follow_status
      using errcode = '22023';
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  v_stopped_reason := nullif(btrim(coalesce(p_stopped_reason, '')), '');

  select *
  into v_candidate
  from public.scout_candidates
  where id = p_candidate_id
    and scout_profile_id = v_profile_id
  for update;

  if not found then
    raise exception 'Candidate not found or inaccessible.'
      using errcode = '42501';
  end if;

  v_current_status := coalesce(v_candidate.follow_status, 'pending');

  if v_current_status = 'stopped' then
    if v_to_status not in ('pending', 'following') then
      raise exception 'Stopped candidates can only be reopened to pending or following.'
        using errcode = '22023';
    end if;

    v_action_type := 'reopened';
    v_next_follow_up_date := p_next_follow_up_date;
    v_stopped_reason := null;
  elsif v_to_status = 'stopped' then
    if v_stopped_reason is null then
      raise exception 'Stopped reason is required.'
        using errcode = '23514';
    end if;

    v_action_type := 'stopped';
    v_next_follow_up_date := null;
  else
    v_action_type := 'follow_up';
    v_next_follow_up_date := p_next_follow_up_date;
    v_stopped_reason := null;
  end if;

  insert into public.scout_candidate_follow_up_history (
    candidate_id,
    scout_profile_id,
    action_type,
    from_follow_status,
    to_follow_status,
    previous_next_follow_up_date,
    next_follow_up_date,
    note,
    stopped_reason,
    created_by,
    created_at
  )
  values (
    v_candidate.id,
    v_profile_id,
    v_action_type,
    v_current_status,
    v_to_status,
    v_candidate.next_follow_up_date,
    v_next_follow_up_date,
    v_note,
    case when v_action_type = 'stopped' then v_stopped_reason else null end,
    v_profile_id,
    v_now
  );

  update public.scout_candidates
  set
    follow_status = v_to_status,
    next_follow_up_date = v_next_follow_up_date,
    stopped_reason = case when v_action_type = 'stopped' then v_stopped_reason else null end,
    stopped_at = case when v_action_type = 'stopped' then v_now else null end
  where id = v_candidate.id
  returning * into v_updated_candidate;

  return v_updated_candidate;
end;
$$;

revoke all on function public.add_scout_candidate_follow_up(uuid, text, text, date, text) from public;
grant execute on function public.add_scout_candidate_follow_up(uuid, text, text, date, text) to authenticated;
