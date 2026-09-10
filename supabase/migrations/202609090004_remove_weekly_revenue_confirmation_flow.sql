begin;

-- Keep the historical confirmation fields and records intact. Existing weekly
-- revenue edits are performed only through the controlled RPC below.
drop policy if exists "Agents can update own unconfirmed weekly revenue records"
  on public.creator_weekly_revenue_records;

drop policy if exists "Agents can update own weekly revenue records"
  on public.creator_weekly_revenue_records;

revoke update on public.creator_weekly_revenue_records from authenticated;

create or replace function public.update_own_creator_weekly_revenue_record(
  p_record_id uuid,
  p_revenue_amount numeric,
  p_agent_note text
)
returns public.creator_weekly_revenue_records
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_employee_id uuid := public.current_user_employee_id();
  target_record public.creator_weekly_revenue_records;
  updated_record public.creator_weekly_revenue_records;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  if current_employee_id is null then
    raise exception 'Current employee profile was not found.';
  end if;

  if not public.current_user_has_permission('agent-revenue-data', 'use') then
    raise exception 'No permission to update creator weekly revenue.';
  end if;

  if p_revenue_amount is null or p_revenue_amount < 0 then
    raise exception 'Revenue amount must be a non-negative number.';
  end if;

  select wr.*
  into target_record
  from public.creator_weekly_revenue_records wr
  where wr.id = p_record_id
  for update;

  if target_record.id is null then
    raise exception 'Weekly revenue record not found.';
  end if;

  if not exists (
    select 1
    from public.creator_profiles cp
    where cp.id = target_record.creator_profile_id
      and cp.manager_employee_id = current_employee_id
  ) then
    raise exception 'No permission to update this creator weekly revenue.';
  end if;

  update public.creator_weekly_revenue_records
  set revenue_amount = p_revenue_amount,
      agent_note = nullif(btrim(coalesce(p_agent_note, '')), ''),
      status = 'submitted'
  where id = p_record_id
  returning * into updated_record;

  return updated_record;
end;
$$;

revoke all on function public.update_own_creator_weekly_revenue_record(uuid, numeric, text) from public;
revoke all on function public.update_own_creator_weekly_revenue_record(uuid, numeric, text) from anon;
revoke all on function public.update_own_creator_weekly_revenue_record(uuid, numeric, text) from authenticated;
grant execute on function public.update_own_creator_weekly_revenue_record(uuid, numeric, text) to authenticated;

commit;
