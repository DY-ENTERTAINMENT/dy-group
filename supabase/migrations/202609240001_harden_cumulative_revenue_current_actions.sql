begin;

-- Current cumulative actions must use the Profile's current active Entity,
-- rather than a historical raw-record Entity snapshot. This helper is shared
-- by context and submit paths; reset retains its Super Admin gate below.
create or replace function public.assert_creator_cumulative_revenue_access(
  p_creator_profile public.creator_profiles,
  p_allow_super_admin boolean default true
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_id uuid := public.current_user_employee_id();
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  if p_creator_profile.id is null
     or p_creator_profile.status <> 'active'
     or p_creator_profile.membership_status <> 'active' then
    raise exception 'Active creator profile not found.';
  end if;

  if not exists (
    select 1
    from public.creator_entities entity
    where entity.id = p_creator_profile.creator_entity_id
      and entity.status = 'active'
  ) then
    raise exception 'Creator entity is not active for current cumulative revenue actions.';
  end if;

  if p_allow_super_admin and public.current_user_is_super_admin() then
    return;
  end if;

  if public.current_user_has_permission('agent-revenue-data', 'use')
     and p_creator_profile.manager_employee_id = v_employee_id
     and public.current_user_can_access_region(p_creator_profile.region_id) then
    return;
  end if;

  if public.current_user_has_permission('management-revenue-data', 'use')
     and public.current_user_can_access_region(p_creator_profile.region_id) then
    return;
  end if;

  raise exception 'No permission to manage this creator cumulative revenue.';
end;
$$;

create or replace function public.submit_creator_cumulative_revenue(
  p_creator_profile_id uuid,
  p_cumulative_amount numeric,
  p_data_date date,
  p_idempotency_key uuid,
  p_note text default null,
  p_source text default 'manual'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c public.creator_profiles;
  s public.creator_revenue_cumulative_state;
  period_state public.creator_revenue_cumulative_period_state;
  v_employee_id uuid := public.current_user_employee_id();
  v_week_start date;
  v_week_end date;
  v_existing_raw public.creator_revenue_cumulative_records;
  v_raw public.creator_revenue_cumulative_records;
  v_weekly public.creator_weekly_revenue_records;
  v_weekly_count integer;
  v_period_amount numeric;
begin
  if p_cumulative_amount is null or p_cumulative_amount < 0 then
    raise exception 'Cumulative amount must be a non-negative number.';
  end if;

  if p_data_date is null or p_idempotency_key is null then
    raise exception 'Data date and idempotency key are required.';
  end if;

  -- This authenticated RPC is the Phase 2 manual entry point. Future imports
  -- must use a separately controlled server-side entry point, not a client-
  -- supplied audit source.
  if p_source <> 'manual' then
    raise exception 'Only manual cumulative submissions are allowed by this RPC.';
  end if;

  -- Match the direct-save lock exactly so direct/cumulative writes for one
  -- Profile serialize. All mutable current-action eligibility is re-read only
  -- after this lock is held.
  perform pg_advisory_xact_lock(hashtextextended(p_creator_profile_id::text, 0));

  select * into c
  from public.creator_profiles
  where id = p_creator_profile_id
  for update;

  perform public.assert_creator_cumulative_revenue_access(c);

  -- Keep Phase 2's existing NULL behavior while moving settings validation
  -- inside the Profile lock.
  if c.revenue_cycle <> 'weekly' or c.revenue_input_mode <> 'cumulative' then
    raise exception 'Cumulative calculation is only available for weekly cumulative creator profiles.';
  end if;

  select * into v_existing_raw
  from public.creator_revenue_cumulative_records
  where creator_profile_id = p_creator_profile_id
    and idempotency_key = p_idempotency_key;

  if v_existing_raw.id is not null then
    select * into v_weekly
    from public.creator_weekly_revenue_records
    where id = v_existing_raw.related_weekly_revenue_record_id;

    return jsonb_build_object(
      'idempotent', true,
      'entry_kind', v_existing_raw.entry_kind,
      'weekly_record', to_jsonb(v_weekly),
      'previous_cumulative_amount', v_existing_raw.previous_cumulative_amount,
      'calculated_period_amount', v_existing_raw.calculated_period_amount
    );
  end if;

  select * into s
  from public.creator_revenue_cumulative_state
  where creator_profile_id = p_creator_profile_id
  for update;

  if s.creator_profile_id is null then
    insert into public.creator_revenue_cumulative_state(creator_profile_id)
    values (p_creator_profile_id)
    returning * into s;
  end if;

  v_week_start := public.creator_weekly_revenue_period_start(p_data_date);
  v_week_end := public.creator_weekly_revenue_period_end(v_week_start);

  if not s.chain_active then
    insert into public.creator_revenue_cumulative_records(
      creator_profile_id, creator_entity_id, platform, platform_uid,
      cumulative_amount, data_date, week_start_date, entered_by_employee_id,
      source, entry_kind, idempotency_key, note
    ) values (
      c.id, c.creator_entity_id, c.platform, c.platform_user_id,
      p_cumulative_amount, p_data_date, v_week_start, v_employee_id,
      p_source, 'baseline', p_idempotency_key, nullif(btrim(coalesce(p_note, '')), '')
    ) returning * into v_raw;

    update public.creator_revenue_cumulative_state
    set latest_cumulative_amount = p_cumulative_amount,
        latest_raw_record_id = v_raw.id,
        chain_active = true,
        chain_generation = chain_generation + 1,
        updated_at = now()
    where creator_profile_id = c.id
    returning * into s;

    return jsonb_build_object(
      'idempotent', false,
      'entry_kind', 'baseline',
      'weekly_record', null,
      'previous_cumulative_amount', null,
      'calculated_period_amount', null
    );
  end if;

  if p_data_date < (
    select r.data_date
    from public.creator_revenue_cumulative_records r
    where r.id = s.latest_raw_record_id
  ) then
    raise exception 'Data date cannot be earlier than the latest cumulative observation.';
  end if;

  if p_cumulative_amount < s.latest_cumulative_amount then
    raise exception 'Cumulative amount cannot be lower than the previous cumulative amount. Ask a Super Admin to reset the baseline.';
  end if;

  select * into period_state
  from public.creator_revenue_cumulative_period_state
  where creator_profile_id = c.id
    and week_start_date = v_week_start
    and chain_generation = s.chain_generation
    and is_active
  for update;

  if period_state.creator_profile_id is null then
    insert into public.creator_revenue_cumulative_period_state(
      creator_profile_id, week_start_date, chain_generation,
      opening_cumulative_amount, opening_raw_record_id
    ) values (
      c.id, v_week_start, s.chain_generation,
      s.latest_cumulative_amount, s.latest_raw_record_id
    ) returning * into period_state;
  end if;

  v_period_amount := p_cumulative_amount - period_state.opening_cumulative_amount;

  if period_state.weekly_revenue_record_id is not null then
    select * into v_weekly
    from public.creator_weekly_revenue_records
    where id = period_state.weekly_revenue_record_id
      and creator_profile_id = c.id
      and week_start_date = v_week_start
      and is_cumulative_generated = true
    for update;

    if v_weekly.id is null then
      raise exception 'Cumulative weekly revenue ownership reference is invalid. Ask an administrator to resolve it.';
    end if;

    update public.creator_weekly_revenue_records
    set revenue_amount = v_period_amount,
        agent_note = nullif(btrim(coalesce(p_note, '')), ''),
        status = 'submitted'
    where id = v_weekly.id
    returning * into v_weekly;
  else
    select count(*) into v_weekly_count
    from public.creator_weekly_revenue_records
    where creator_profile_id = c.id
      and week_start_date = v_week_start;

    if v_weekly_count > 1 then
      raise exception 'Multiple weekly revenue records already exist for this creator and period. Ask an administrator to resolve the historical duplicate.';
    end if;

    if v_weekly_count = 1 then
      raise exception 'A direct weekly revenue record already exists for this period and cannot be overwritten by cumulative mode.';
    end if;

    insert into public.creator_weekly_revenue_records(
      creator_profile_id, week_start_date, week_end_date, revenue_amount,
      agent_note, status, source, is_cumulative_generated
    ) values (
      c.id, v_week_start, v_week_end, v_period_amount,
      nullif(btrim(coalesce(p_note, '')), ''), 'submitted', 'manual', true
    ) returning * into v_weekly;

    update public.creator_revenue_cumulative_period_state
    set weekly_revenue_record_id = v_weekly.id,
        updated_at = now()
    where creator_profile_id = period_state.creator_profile_id
      and week_start_date = period_state.week_start_date
      and chain_generation = period_state.chain_generation;
  end if;

  insert into public.creator_revenue_cumulative_records(
    creator_profile_id, creator_entity_id, platform, platform_uid,
    cumulative_amount, previous_cumulative_amount, calculated_period_amount,
    data_date, week_start_date, entered_by_employee_id, source, entry_kind,
    related_weekly_revenue_record_id, idempotency_key, note
  ) values (
    c.id, c.creator_entity_id, c.platform, c.platform_user_id,
    p_cumulative_amount, s.latest_cumulative_amount, v_period_amount,
    p_data_date, v_week_start, v_employee_id, p_source, 'calculation',
    v_weekly.id, p_idempotency_key, nullif(btrim(coalesce(p_note, '')), '')
  ) returning * into v_raw;

  update public.creator_revenue_cumulative_state
  set latest_cumulative_amount = p_cumulative_amount,
      latest_raw_record_id = v_raw.id,
      updated_at = now()
  where creator_profile_id = c.id;

  return jsonb_build_object(
    'idempotent', false,
    'entry_kind', 'calculation',
    'weekly_record', to_jsonb(v_weekly),
    'previous_cumulative_amount', s.latest_cumulative_amount,
    'calculated_period_amount', v_period_amount
  );
end;
$$;

create or replace function public.reset_creator_cumulative_revenue_baseline(
  p_creator_profile_id uuid,
  p_new_baseline_amount numeric,
  p_data_date date,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c public.creator_profiles;
  s public.creator_revenue_cumulative_state;
  r public.creator_revenue_cumulative_records;
  v_employee_id uuid := public.current_user_employee_id();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null or not public.current_user_is_super_admin() then
    raise exception 'Only Super Admin can reset a cumulative revenue baseline.';
  end if;

  if p_new_baseline_amount is null
     or p_new_baseline_amount < 0
     or p_data_date is null
     or p_idempotency_key is null
     or v_reason is null then
    raise exception 'Reset requires a non-negative baseline, data date, idempotency key, and reason.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_creator_profile_id::text, 0));

  select * into c
  from public.creator_profiles
  where id = p_creator_profile_id
  for update;

  -- The reset remains Super Admin-only, but is still a current cumulative
  -- action and therefore requires the current Profile/Entity/membership guard.
  perform public.assert_creator_cumulative_revenue_access(c);

  select * into r
  from public.creator_revenue_cumulative_records
  where creator_profile_id = c.id
    and idempotency_key = p_idempotency_key;

  if r.id is not null then
    return jsonb_build_object('idempotent', true, 'entry_kind', r.entry_kind);
  end if;

  select * into s
  from public.creator_revenue_cumulative_state
  where creator_profile_id = c.id
  for update;

  if s.creator_profile_id is null then
    insert into public.creator_revenue_cumulative_state(creator_profile_id)
    values(c.id)
    returning * into s;
  end if;

  if p_data_date < (
    select raw.data_date
    from public.creator_revenue_cumulative_records raw
    where raw.id = s.latest_raw_record_id
  ) then
    raise exception 'Reset data date cannot be earlier than the latest cumulative observation.';
  end if;

  update public.creator_revenue_cumulative_period_state
  set is_active = false,
      updated_at = now()
  where creator_profile_id = c.id
    and is_active;

  insert into public.creator_revenue_cumulative_records(
    creator_profile_id, creator_entity_id, platform, platform_uid,
    cumulative_amount, previous_cumulative_amount, data_date, week_start_date,
    entered_by_employee_id, source, entry_kind, idempotency_key, note
  ) values (
    c.id, c.creator_entity_id, c.platform, c.platform_user_id,
    p_new_baseline_amount, s.latest_cumulative_amount, p_data_date,
    public.creator_weekly_revenue_period_start(p_data_date), v_employee_id,
    'manual', 'reset', p_idempotency_key, v_reason
  ) returning * into r;

  update public.creator_revenue_cumulative_state
  set latest_cumulative_amount = p_new_baseline_amount,
      latest_raw_record_id = r.id,
      chain_active = true,
      chain_generation = chain_generation + 1,
      updated_at = now()
  where creator_profile_id = c.id;

  return jsonb_build_object('idempotent', false, 'entry_kind', 'reset');
end;
$$;

revoke all on function public.assert_creator_cumulative_revenue_access(public.creator_profiles, boolean) from public, anon, authenticated;
revoke all on function public.submit_creator_cumulative_revenue(uuid, numeric, date, uuid, text, text) from public, anon;
revoke all on function public.reset_creator_cumulative_revenue_baseline(uuid, numeric, date, text, uuid) from public, anon;
grant execute on function public.submit_creator_cumulative_revenue(uuid, numeric, date, uuid, text, text) to authenticated;
grant execute on function public.reset_creator_cumulative_revenue_baseline(uuid, numeric, date, text, uuid) to authenticated;

commit;
