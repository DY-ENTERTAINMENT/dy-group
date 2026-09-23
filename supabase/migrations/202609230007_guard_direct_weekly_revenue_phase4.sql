begin;

-- Direct weekly saves are serialized per Profile.  This ledger only records a
-- completed request/result pair; it is deliberately separate from cumulative
-- raw observations so neither workflow can reinterpret the other's history.
create table if not exists public.creator_weekly_revenue_direct_save_requests (
  id uuid primary key default gen_random_uuid(),
  creator_profile_id uuid not null references public.creator_profiles(id) on delete restrict,
  requested_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  idempotency_key uuid not null,
  weekly_revenue_record_id uuid references public.creator_weekly_revenue_records(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint creator_weekly_revenue_direct_save_requests_profile_idempotency_key_key
    unique (creator_profile_id, idempotency_key)
);

alter table public.creator_weekly_revenue_direct_save_requests enable row level security;
revoke all on table public.creator_weekly_revenue_direct_save_requests from public, anon, authenticated;

create or replace function public.save_direct_creator_weekly_revenue(
  p_creator_profile_id uuid,
  p_data_date date,
  p_revenue_amount numeric,
  p_agent_note text,
  p_idempotency_key uuid
)
returns public.creator_weekly_revenue_records
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_employee_id uuid := public.current_user_employee_id();
  target_creator public.creator_profiles;
  target_entity public.creator_entities;
  existing_request public.creator_weekly_revenue_direct_save_requests;
  existing_record public.creator_weekly_revenue_records;
  result_record public.creator_weekly_revenue_records;
  weekly_record_count integer;
  period_start date;
  period_end date;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  if current_employee_id is null then
    raise exception 'Current employee profile was not found.';
  end if;

  if p_creator_profile_id is null or p_data_date is null or p_idempotency_key is null then
    raise exception 'Creator profile, data date, and idempotency key are required.';
  end if;

  if p_revenue_amount is null or p_revenue_amount < 0 then
    raise exception 'Revenue amount must be a non-negative number.';
  end if;

  -- Same lock key as the cumulative workflow: direct and cumulative writes for
  -- one Profile cannot interleave, including when neither workflow has state.
  perform pg_advisory_xact_lock(hashtextextended(p_creator_profile_id::text, 0));

  select * into target_creator
  from public.creator_profiles
  where id = p_creator_profile_id
  for update;

  if target_creator.id is null
     or target_creator.status <> 'active'
     or target_creator.membership_status <> 'active' then
    raise exception 'Active creator profile not found.';
  end if;

  select * into target_entity
  from public.creator_entities
  where id = target_creator.creator_entity_id
    and status = 'active';

  if target_entity.id is null then
    raise exception 'Creator entity is not active for current revenue actions.';
  end if;

  -- NULL remains the Phase 1-compatible legacy default: weekly/direct.
  if coalesce(target_creator.revenue_cycle, 'weekly') <> 'weekly'
     or coalesce(target_creator.revenue_input_mode, 'direct') <> 'direct' then
    raise exception 'Direct weekly revenue is only available for weekly direct creator profiles.';
  end if;

  if not public.current_user_has_permission('agent-revenue-data', 'use')
     or target_creator.manager_employee_id is distinct from current_employee_id
     or not public.current_user_can_access_region(target_creator.region_id) then
    raise exception 'No permission to save direct weekly revenue for this creator.';
  end if;

  -- Reauthorize before replaying an idempotent result. A request key is not a
  -- capability: the original authenticated actor must still be eligible and
  -- must match the actor that created the request.
  select * into existing_request
  from public.creator_weekly_revenue_direct_save_requests
  where creator_profile_id = p_creator_profile_id
    and idempotency_key = p_idempotency_key;

  if existing_request.id is not null then
    if existing_request.requested_by_profile_id is distinct from auth.uid() then
      raise exception 'This idempotency key belongs to a different user.';
    end if;

    if existing_request.weekly_revenue_record_id is null then
      raise exception 'This direct save was cancelled. Please start a new save request.';
    end if;

    select * into result_record
    from public.creator_weekly_revenue_records
    where id = existing_request.weekly_revenue_record_id;

    if result_record.id is null then
      raise exception 'The previous direct save result is no longer available. Please start a new save request.';
    end if;

    return result_record;
  end if;

  -- The server owns period normalization; callers cannot choose a mismatched
  -- period end date or bypass the canonical weekly period helper.
  period_start := public.creator_weekly_revenue_period_start(p_data_date);
  period_end := public.creator_weekly_revenue_period_end(period_start);

  select count(*) into weekly_record_count
  from public.creator_weekly_revenue_records
  where creator_profile_id = target_creator.id
    and week_start_date = period_start;

  if weekly_record_count > 1 then
    raise exception '该主播此周期存在多条历史流水记录，请联系管理员处理后再填写。';
  end if;

  if weekly_record_count = 1 then
    select * into existing_record
    from public.creator_weekly_revenue_records
    where creator_profile_id = target_creator.id
      and week_start_date = period_start
    for update;

    if existing_record.is_cumulative_generated then
      raise exception '该主播此周期已存在累计计算流水，不能使用直接填写覆盖。';
    end if;

    -- Preserve existing direct-edit behavior: its amount/note may change and
    -- it becomes submitted again, while attribution/source remain immutable.
    update public.creator_weekly_revenue_records
    set revenue_amount = p_revenue_amount,
        agent_note = nullif(btrim(coalesce(p_agent_note, '')), ''),
        status = 'submitted'
    where id = existing_record.id
    returning * into result_record;
  else
    -- Existing BEFORE INSERT triggers own snapshots, status bookkeeping, and
    -- manager attribution. Client input never supplies those trusted fields.
    insert into public.creator_weekly_revenue_records (
      creator_profile_id,
      week_start_date,
      week_end_date,
      revenue_amount,
      agent_note,
      status,
      source,
      is_cumulative_generated
    ) values (
      target_creator.id,
      period_start,
      period_end,
      p_revenue_amount,
      nullif(btrim(coalesce(p_agent_note, '')), ''),
      'submitted',
      'manual',
      false
    ) returning * into result_record;
  end if;

  insert into public.creator_weekly_revenue_direct_save_requests (
    creator_profile_id,
    requested_by_profile_id,
    idempotency_key,
    weekly_revenue_record_id
  ) values (
    target_creator.id,
    auth.uid(),
    p_idempotency_key,
    result_record.id
  );

  return result_record;
end;
$$;

-- The legacy update RPC did not validate Entity/membership/settings and would
-- bypass the new duplicate guard. Direct edits now use the guarded save RPC.
revoke all on function public.update_own_creator_weekly_revenue_record(uuid, numeric, text) from public;
revoke all on function public.update_own_creator_weekly_revenue_record(uuid, numeric, text) from anon;
revoke all on function public.update_own_creator_weekly_revenue_record(uuid, numeric, text) from authenticated;

-- Direct clients must use the RPC. SECURITY DEFINER cumulative/direct paths
-- retain their own controlled table writes; no RLS policy permits a client
-- INSERT directly into the weekly table.
drop policy if exists "Agents can create own weekly revenue records"
  on public.creator_weekly_revenue_records;
revoke insert on table public.creator_weekly_revenue_records from authenticated;

revoke all on function public.save_direct_creator_weekly_revenue(uuid, date, numeric, text, uuid) from public;
revoke all on function public.save_direct_creator_weekly_revenue(uuid, date, numeric, text, uuid) from anon;
revoke all on function public.save_direct_creator_weekly_revenue(uuid, date, numeric, text, uuid) from authenticated;
grant execute on function public.save_direct_creator_weekly_revenue(uuid, date, numeric, text, uuid) to authenticated;

commit;
