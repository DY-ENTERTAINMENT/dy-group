begin;

-- Forward-only metadata. Existing rows deliberately remain NULL: ownership of
-- legacy rows is interpreted from is_cumulative_generated, never backfilled.
alter table public.creator_weekly_revenue_records
  add column if not exists revenue_entry_kind text null;
alter table public.creator_weekly_revenue_records
  add constraint creator_weekly_revenue_records_entry_kind_check check (
    revenue_entry_kind is null or revenue_entry_kind in ('direct', 'cumulative_generated', 'cumulative_manual_backfill')
  );

alter table public.creator_profiles
  add column if not exists pending_revenue_input_mode text null,
  add column if not exists revenue_input_mode_effective_date date null;
alter table public.creator_profiles
  add constraint creator_profiles_pending_revenue_input_mode_check check (
    pending_revenue_input_mode is null or pending_revenue_input_mode in ('direct', 'cumulative')
  );
alter table public.creator_profiles
  add constraint creator_profiles_revenue_input_mode_effective_date_check check (
    (pending_revenue_input_mode is null and revenue_input_mode_effective_date is null)
    or (pending_revenue_input_mode is not null and revenue_input_mode_effective_date is not null)
  );

alter table public.creator_revenue_cumulative_state
  add column if not exists calculation_resumes_week_start_date date null;

create or replace function public.creator_effective_revenue_input_mode(p_creator public.creator_profiles, p_data_date date)
returns text language sql stable set search_path = public, pg_temp as $$
  select case when p_creator.pending_revenue_input_mode is not null
                    and p_creator.revenue_input_mode_effective_date <= public.creator_weekly_revenue_period_start(p_data_date)
              then p_creator.pending_revenue_input_mode
              else coalesce(p_creator.revenue_input_mode, 'direct') end;
$$;

create or replace function public.creator_weekly_revenue_is_cumulative(p_record public.creator_weekly_revenue_records)
returns boolean language sql immutable as $$
  select p_record.revenue_entry_kind in ('cumulative_generated', 'cumulative_manual_backfill')
      or (p_record.revenue_entry_kind is null and coalesce(p_record.is_cumulative_generated, false));
$$;

-- Apply a due mode while holding the profile lock. The current period never
-- changes once it has a weekly record; settings RPC schedules that case.
create or replace function public.apply_due_creator_revenue_input_mode(p_creator_id uuid, p_data_date date)
returns public.creator_profiles language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.creator_profiles;
begin
  select * into c from public.creator_profiles where id = p_creator_id for update;
  if c.pending_revenue_input_mode is not null
     and c.revenue_input_mode_effective_date <= public.creator_weekly_revenue_period_start(p_data_date) then
    update public.creator_profiles set revenue_input_mode = c.pending_revenue_input_mode,
      pending_revenue_input_mode = null, revenue_input_mode_effective_date = null
    where id = c.id returning * into c;
  end if;
  return c;
end;
$$;

-- Schedule a mode only when the current canonical period is already immutable.
create or replace function public.save_creator_entity_revenue_settings(p_creator_entity_id uuid, p_profile_settings jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_today date := public.current_malaysia_business_date(); r record; v_start date; v_next date; v_has_weekly boolean;
begin
  if auth.uid() is null or not public.current_user_has_explicit_permission('agent-creator-revenue-settings','use') then raise exception 'Permission denied.'; end if;
  if not public.current_user_can_manage_creator_entity(p_creator_entity_id) then raise exception 'Creator access denied.'; end if;
  if p_profile_settings is null or jsonb_typeof(p_profile_settings) <> 'array' then raise exception 'Profile settings must be an array.'; end if;
  if exists (select 1 from jsonb_to_recordset(p_profile_settings) s(id uuid,revenue_cycle text,revenue_input_mode text) where s.revenue_cycle not in ('weekly','monthly','none') or s.revenue_input_mode not in ('direct','cumulative')) then raise exception 'Invalid revenue settings.'; end if;
  if (select count(*) from jsonb_to_recordset(p_profile_settings) s(id uuid,revenue_cycle text,revenue_input_mode text)) <> (select count(*) from public.creator_profiles where creator_entity_id=p_creator_entity_id and status='active' and membership_status='active') then raise exception 'All active platform profiles must be included.'; end if;
  v_start := public.creator_weekly_revenue_period_start(v_today);
  v_next := public.creator_weekly_revenue_period_start(public.creator_weekly_revenue_period_end(v_start) + 1);
  for r in select * from jsonb_to_recordset(p_profile_settings) s(id uuid,revenue_cycle text,revenue_input_mode text) loop
    select exists(select 1 from public.creator_weekly_revenue_records w where w.creator_profile_id=r.id and w.week_start_date=v_start) into v_has_weekly;
    if v_has_weekly and r.revenue_input_mode <> (select revenue_input_mode from public.creator_profiles where id=r.id) then
      update public.creator_profiles set revenue_cycle=r.revenue_cycle, pending_revenue_input_mode=r.revenue_input_mode, revenue_input_mode_effective_date=v_next where id=r.id and creator_entity_id=p_creator_entity_id;
    else
      update public.creator_profiles set revenue_cycle=r.revenue_cycle, revenue_input_mode=r.revenue_input_mode, pending_revenue_input_mode=null, revenue_input_mode_effective_date=null where id=r.id and creator_entity_id=p_creator_entity_id;
    end if;
  end loop;
end; $$;

-- Normal cumulative path retains its formula; only future row metadata and
-- scheduled-mode resolution are added.
create or replace function public.submit_creator_cumulative_revenue(
  p_creator_profile_id uuid, p_cumulative_amount numeric, p_data_date date, p_idempotency_key uuid, p_note text default null, p_source text default 'manual')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.creator_profiles; s public.creator_revenue_cumulative_state; ps public.creator_revenue_cumulative_period_state; e public.creator_revenue_cumulative_records; raw public.creator_revenue_cumulative_records; w public.creator_weekly_revenue_records; v_start date; v_end date; v_amount numeric; v_count integer; v_employee uuid:=public.current_user_employee_id();
begin
  if p_cumulative_amount is null or p_cumulative_amount<0 then raise exception 'Cumulative amount must be a non-negative number.'; end if;
  if p_data_date is null or p_idempotency_key is null then raise exception 'Data date and idempotency key are required.'; end if;
  if p_source<>'manual' then raise exception 'Only manual cumulative submissions are allowed by this RPC.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_creator_profile_id::text,0));
  select public.apply_due_creator_revenue_input_mode(p_creator_profile_id,p_data_date) into c; perform public.assert_creator_cumulative_revenue_access(c);
  if c.revenue_cycle<>'weekly' or c.revenue_input_mode<>'cumulative' then raise exception 'Cumulative calculation is only available for weekly cumulative creator profiles.'; end if;
  select * into e from public.creator_revenue_cumulative_records where creator_profile_id=c.id and idempotency_key=p_idempotency_key;
  if e.id is not null then select * into w from public.creator_weekly_revenue_records where id=e.related_weekly_revenue_record_id; return jsonb_build_object('idempotent',true,'entry_kind',e.entry_kind,'weekly_record',to_jsonb(w),'previous_cumulative_amount',e.previous_cumulative_amount,'calculated_period_amount',e.calculated_period_amount); end if;
  select * into s from public.creator_revenue_cumulative_state where creator_profile_id=c.id for update; if s.creator_profile_id is null then insert into public.creator_revenue_cumulative_state(creator_profile_id) values(c.id) returning * into s; end if;
  v_start:=public.creator_weekly_revenue_period_start(p_data_date); v_end:=public.creator_weekly_revenue_period_end(v_start);
  if not s.chain_active then insert into public.creator_revenue_cumulative_records(creator_profile_id,creator_entity_id,platform,platform_uid,cumulative_amount,data_date,week_start_date,entered_by_employee_id,source,entry_kind,idempotency_key,note) values(c.id,c.creator_entity_id,c.platform,c.platform_user_id,p_cumulative_amount,p_data_date,v_start,v_employee,p_source,'baseline',p_idempotency_key,nullif(btrim(coalesce(p_note,'')),'')) returning * into raw; update public.creator_revenue_cumulative_state set latest_cumulative_amount=p_cumulative_amount,latest_raw_record_id=raw.id,chain_active=true,chain_generation=chain_generation+1,updated_at=now() where creator_profile_id=c.id; return jsonb_build_object('idempotent',false,'entry_kind','baseline','weekly_record',null,'previous_cumulative_amount',null,'calculated_period_amount',null); end if;
  if s.calculation_resumes_week_start_date is not null and v_start<s.calculation_resumes_week_start_date then raise exception 'The new cumulative baseline starts calculating from the next period.'; end if;
  if p_data_date<(select data_date from public.creator_revenue_cumulative_records where id=s.latest_raw_record_id) then raise exception 'Data date cannot be earlier than the latest cumulative observation.'; end if;
  if p_cumulative_amount<s.latest_cumulative_amount then raise exception 'Cumulative amount cannot be lower than the previous cumulative amount. Ask a Super Admin to reset the baseline.'; end if;
  select * into ps from public.creator_revenue_cumulative_period_state where creator_profile_id=c.id and week_start_date=v_start and chain_generation=s.chain_generation and is_active for update;
  if ps.creator_profile_id is null then insert into public.creator_revenue_cumulative_period_state(creator_profile_id,week_start_date,chain_generation,opening_cumulative_amount,opening_raw_record_id) values(c.id,v_start,s.chain_generation,s.latest_cumulative_amount,s.latest_raw_record_id) returning * into ps; end if;
  v_amount:=p_cumulative_amount-ps.opening_cumulative_amount;
  if ps.weekly_revenue_record_id is not null then select * into w from public.creator_weekly_revenue_records q where q.id=ps.weekly_revenue_record_id and q.creator_profile_id=c.id and q.week_start_date=v_start and public.creator_weekly_revenue_is_cumulative(q) for update; if w.id is null then raise exception 'Cumulative weekly revenue ownership reference is invalid.'; end if; update public.creator_weekly_revenue_records set revenue_amount=v_amount,agent_note=nullif(btrim(coalesce(p_note,'')),''),status='submitted' where id=w.id returning * into w;
  else select count(*) into v_count from public.creator_weekly_revenue_records where creator_profile_id=c.id and week_start_date=v_start; if v_count>0 then raise exception 'A weekly revenue record already exists for this period and cannot be overwritten by cumulative mode.'; end if; insert into public.creator_weekly_revenue_records(creator_profile_id,week_start_date,week_end_date,revenue_amount,agent_note,status,source,is_cumulative_generated,revenue_entry_kind) values(c.id,v_start,v_end,v_amount,nullif(btrim(coalesce(p_note,'')),''),'submitted','manual',true,'cumulative_generated') returning * into w; update public.creator_revenue_cumulative_period_state set weekly_revenue_record_id=w.id,updated_at=now() where creator_profile_id=c.id and week_start_date=v_start and chain_generation=s.chain_generation; end if;
  insert into public.creator_revenue_cumulative_records(creator_profile_id,creator_entity_id,platform,platform_uid,cumulative_amount,previous_cumulative_amount,calculated_period_amount,data_date,week_start_date,entered_by_employee_id,source,entry_kind,related_weekly_revenue_record_id,idempotency_key,note) values(c.id,c.creator_entity_id,c.platform,c.platform_user_id,p_cumulative_amount,s.latest_cumulative_amount,v_amount,p_data_date,v_start,v_employee,p_source,'calculation',w.id,p_idempotency_key,nullif(btrim(coalesce(p_note,'')),'')) returning * into raw;
  update public.creator_revenue_cumulative_state set latest_cumulative_amount=p_cumulative_amount,latest_raw_record_id=raw.id,calculation_resumes_week_start_date=null,updated_at=now() where creator_profile_id=c.id;
  return jsonb_build_object('idempotent',false,'entry_kind','calculation','weekly_record',to_jsonb(w),'previous_cumulative_amount',s.latest_cumulative_amount,'calculated_period_amount',v_amount);
end; $$;

-- A reset never creates or reinterprets a current-period weekly. The next
-- canonical period is the earliest valid calculation period for its generation.
create or replace function public.reset_creator_cumulative_revenue_baseline(p_creator_profile_id uuid,p_new_baseline_amount numeric,p_data_date date,p_reason text,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.creator_profiles; s public.creator_revenue_cumulative_state; r public.creator_revenue_cumulative_records; v_start date; v_next date; v_reason text:=nullif(btrim(coalesce(p_reason,'')), '');
begin
 if auth.uid() is null or not public.current_user_is_super_admin() then raise exception 'Only Super Admin can reset a cumulative revenue baseline.'; end if;
 if p_new_baseline_amount is null or p_new_baseline_amount<0 or p_data_date is null or p_idempotency_key is null or v_reason is null then raise exception 'Reset requires a non-negative baseline, data date, idempotency key, and reason.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_creator_profile_id::text,0)); select * into c from public.creator_profiles where id=p_creator_profile_id for update; perform public.assert_creator_cumulative_revenue_access(c); if c.revenue_cycle<>'weekly' or public.creator_effective_revenue_input_mode(c,p_data_date)<>'cumulative' then raise exception 'Reset is only available for weekly cumulative creator profiles.'; end if;
 select * into r from public.creator_revenue_cumulative_records where creator_profile_id=c.id and idempotency_key=p_idempotency_key; if r.id is not null then return jsonb_build_object('idempotent',true,'entry_kind',r.entry_kind); end if;
 select * into s from public.creator_revenue_cumulative_state where creator_profile_id=c.id for update; if s.creator_profile_id is null then insert into public.creator_revenue_cumulative_state(creator_profile_id) values(c.id) returning * into s; end if;
 if p_data_date<(select data_date from public.creator_revenue_cumulative_records where id=s.latest_raw_record_id) then raise exception 'Reset data date cannot be earlier than the latest cumulative observation.'; end if;
 v_start:=public.creator_weekly_revenue_period_start(p_data_date); v_next:=public.creator_weekly_revenue_period_start(public.creator_weekly_revenue_period_end(v_start)+1);
 update public.creator_revenue_cumulative_period_state set is_active=false,updated_at=now() where creator_profile_id=c.id and is_active;
 insert into public.creator_revenue_cumulative_records(creator_profile_id,creator_entity_id,platform,platform_uid,cumulative_amount,previous_cumulative_amount,data_date,week_start_date,entered_by_employee_id,source,entry_kind,idempotency_key,note) values(c.id,c.creator_entity_id,c.platform,c.platform_user_id,p_new_baseline_amount,s.latest_cumulative_amount,p_data_date,v_start,public.current_user_employee_id(),'manual','reset',p_idempotency_key,v_reason) returning * into r;
 update public.creator_revenue_cumulative_state set latest_cumulative_amount=p_new_baseline_amount,latest_raw_record_id=r.id,chain_active=true,chain_generation=chain_generation+1,calculation_resumes_week_start_date=v_next,updated_at=now() where creator_profile_id=c.id;
 return jsonb_build_object('idempotent',false,'entry_kind','reset','calculation_resumes_week_start_date',v_next);
end; $$;

-- Atomic 1..N gap backfill. It is intentionally separate from the normal RPC.
create or replace function public.submit_creator_cumulative_revenue_with_backfills(p_creator_profile_id uuid,p_cumulative_amount numeric,p_data_date date,p_idempotency_key uuid,p_backfills jsonb,p_note text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.creator_profiles; s public.creator_revenue_cumulative_state; e public.creator_revenue_cumulative_records; raw public.creator_revenue_cumulative_records; ps public.creator_revenue_cumulative_period_state; w public.creator_weekly_revenue_records; x record; v_start date; v_end date; v_prev_start date; v_cursor date; v_expected jsonb:='[]'::jsonb; v_actual jsonb:=coalesce(p_backfills,'[]'::jsonb); v_sum numeric:=0; v_generated numeric; v_employee uuid:=public.current_user_employee_id();
begin
 if p_cumulative_amount is null or p_cumulative_amount<0 or p_data_date is null or p_idempotency_key is null or jsonb_typeof(v_actual)<>'array' then raise exception 'Cumulative amount, data date, idempotency key, and a backfill array are required.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_creator_profile_id::text,0)); select public.apply_due_creator_revenue_input_mode(p_creator_profile_id,p_data_date) into c; perform public.assert_creator_cumulative_revenue_access(c); if c.revenue_cycle<>'weekly' or c.revenue_input_mode<>'cumulative' then raise exception 'Cumulative calculation is only available for weekly cumulative creator profiles.'; end if;
 select * into e from public.creator_revenue_cumulative_records where creator_profile_id=c.id and idempotency_key=p_idempotency_key; if e.id is not null then select * into w from public.creator_weekly_revenue_records where id=e.related_weekly_revenue_record_id; return jsonb_build_object('idempotent',true,'entry_kind',e.entry_kind,'weekly_record',to_jsonb(w)); end if;
 select * into s from public.creator_revenue_cumulative_state where creator_profile_id=c.id for update; if s.creator_profile_id is null or not s.chain_active then raise exception 'Establish a cumulative baseline before using backfill.'; end if;
 if p_data_date<(select data_date from public.creator_revenue_cumulative_records where id=s.latest_raw_record_id) then raise exception 'Data date cannot be earlier than the latest cumulative observation.'; end if; if p_cumulative_amount<s.latest_cumulative_amount then raise exception 'Cumulative amount cannot be lower than the previous cumulative amount.'; end if;
 v_start:=public.creator_weekly_revenue_period_start(p_data_date); select week_start_date into v_prev_start from public.creator_revenue_cumulative_records where id=s.latest_raw_record_id; v_cursor:=public.creator_weekly_revenue_period_start(public.creator_weekly_revenue_period_end(v_prev_start)+1);
 while v_cursor<v_start loop v_expected:=v_expected || jsonb_build_array(to_jsonb(v_cursor)); v_cursor:=public.creator_weekly_revenue_period_start(public.creator_weekly_revenue_period_end(v_cursor)+1); end loop;
 if jsonb_array_length(v_expected)=0 then raise exception 'There are no missing periods for a backfill submission.'; end if;
 if (select count(*) from jsonb_array_elements(v_actual) b where not (b ? 'period_start' and b ? 'weekly_amount') or (b->>'period_start')::date <> public.creator_weekly_revenue_period_start((b->>'period_start')::date) or (b->>'weekly_amount')::numeric<0) <> jsonb_array_length(v_actual) then raise exception 'Each backfill requires a canonical period start and a non-negative weekly amount.'; end if;
 if (select count(distinct (b->>'period_start')::date) from jsonb_array_elements(v_actual) b) <> jsonb_array_length(v_actual) or (select jsonb_agg(to_jsonb((b->>'period_start')::date) order by (b->>'period_start')::date) from jsonb_array_elements(v_actual) b) is distinct from v_expected then raise exception 'Backfills must match every missing canonical period exactly once.'; end if;
 select coalesce(sum((b->>'weekly_amount')::numeric),0) into v_sum from jsonb_array_elements(v_actual) b; v_generated:=p_cumulative_amount-s.latest_cumulative_amount-v_sum; if v_generated<0 then raise exception 'Manual backfill total cannot exceed cumulative growth.'; end if;
 if exists(select 1 from jsonb_array_elements(v_actual) b join public.creator_weekly_revenue_records q on q.creator_profile_id=c.id and q.week_start_date=(b->>'period_start')::date) then raise exception 'A missing period already has weekly revenue and cannot be backfilled.'; end if;
 if exists(select 1 from public.creator_weekly_revenue_records q where q.creator_profile_id=c.id and q.week_start_date=v_start) then raise exception 'A weekly revenue record already exists for the current period.'; end if;
 for x in select (b->>'period_start')::date as start_date,(b->>'weekly_amount')::numeric as amount from jsonb_array_elements(v_actual) b loop insert into public.creator_weekly_revenue_records(creator_profile_id,week_start_date,week_end_date,revenue_amount,agent_note,status,source,is_cumulative_generated,revenue_entry_kind) values(c.id,x.start_date,public.creator_weekly_revenue_period_end(x.start_date),x.amount,nullif(btrim(coalesce(p_note,'')),''),'submitted','manual',false,'cumulative_manual_backfill'); end loop;
 insert into public.creator_revenue_cumulative_period_state(creator_profile_id,week_start_date,chain_generation,opening_cumulative_amount,opening_raw_record_id) values(c.id,v_start,s.chain_generation,s.latest_cumulative_amount,s.latest_raw_record_id) returning * into ps;
 insert into public.creator_weekly_revenue_records(creator_profile_id,week_start_date,week_end_date,revenue_amount,agent_note,status,source,is_cumulative_generated,revenue_entry_kind) values(c.id,v_start,public.creator_weekly_revenue_period_end(v_start),v_generated,nullif(btrim(coalesce(p_note,'')),''),'submitted','manual',true,'cumulative_generated') returning * into w;
 update public.creator_revenue_cumulative_period_state set weekly_revenue_record_id=w.id,updated_at=now() where creator_profile_id=c.id and week_start_date=v_start and chain_generation=s.chain_generation;
 insert into public.creator_revenue_cumulative_records(creator_profile_id,creator_entity_id,platform,platform_uid,cumulative_amount,previous_cumulative_amount,calculated_period_amount,data_date,week_start_date,entered_by_employee_id,source,entry_kind,related_weekly_revenue_record_id,idempotency_key,note) values(c.id,c.creator_entity_id,c.platform,c.platform_user_id,p_cumulative_amount,s.latest_cumulative_amount,v_generated,p_data_date,v_start,v_employee,'manual','calculation',w.id,p_idempotency_key,nullif(btrim(coalesce(p_note,'')),'')) returning * into raw;
 update public.creator_revenue_cumulative_state set latest_cumulative_amount=p_cumulative_amount,latest_raw_record_id=raw.id,calculation_resumes_week_start_date=null,updated_at=now() where creator_profile_id=c.id;
 return jsonb_build_object('idempotent',false,'entry_kind','calculation','weekly_record',to_jsonb(w),'previous_cumulative_amount',s.latest_cumulative_amount,'calculated_period_amount',v_generated,'backfill_count',jsonb_array_length(v_actual));
end; $$;

create or replace function public.list_creator_cumulative_missing_periods(p_creator_profile_id uuid, p_data_date date)
returns table(period_start date, period_end date)
language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.creator_profiles; s public.creator_revenue_cumulative_state; v_latest_start date; v_current_start date; v_cursor date;
begin
  if p_data_date is null then raise exception 'Data date is required.'; end if;
  select * into c from public.creator_profiles where id=p_creator_profile_id; perform public.assert_creator_cumulative_revenue_access(c);
  select * into s from public.creator_revenue_cumulative_state where creator_profile_id=c.id;
  if s.creator_profile_id is null or not s.chain_active then return; end if;
  select week_start_date into v_latest_start from public.creator_revenue_cumulative_records where id=s.latest_raw_record_id;
  v_current_start:=public.creator_weekly_revenue_period_start(p_data_date);
  v_cursor:=public.creator_weekly_revenue_period_start(public.creator_weekly_revenue_period_end(v_latest_start)+1);
  while v_cursor<v_current_start loop period_start:=v_cursor; period_end:=public.creator_weekly_revenue_period_end(v_cursor); return next; v_cursor:=public.creator_weekly_revenue_period_start(period_end+1); end loop;
end; $$;

-- Future direct rows are explicit and manual backfills are never editable via direct.
create or replace function public.save_direct_creator_weekly_revenue(p_creator_profile_id uuid,p_data_date date,p_revenue_amount numeric,p_agent_note text,p_idempotency_key uuid)
returns public.creator_weekly_revenue_records language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.creator_profiles; r public.creator_weekly_revenue_direct_save_requests; w public.creator_weekly_revenue_records; v_start date; v_end date;
begin
 if auth.uid() is null or p_creator_profile_id is null or p_data_date is null or p_idempotency_key is null or p_revenue_amount is null or p_revenue_amount<0 then raise exception 'Valid creator, date, idempotency key, and non-negative revenue are required.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_creator_profile_id::text,0)); select public.apply_due_creator_revenue_input_mode(p_creator_profile_id,p_data_date) into c;
 if c.id is null or c.status<>'active' or c.membership_status<>'active' or c.revenue_cycle<>'weekly' or c.revenue_input_mode<>'direct' then raise exception 'Direct weekly revenue is only available for active weekly direct creator profiles.'; end if;
 if not exists(select 1 from public.creator_entities e where e.id=c.creator_entity_id and e.status='active') then raise exception 'Creator entity is not active for current revenue actions.'; end if;
 if not public.current_user_has_permission('agent-revenue-data','use') or c.manager_employee_id is distinct from public.current_user_employee_id() or not public.current_user_can_access_region(c.region_id) then raise exception 'No permission to save direct weekly revenue for this creator.'; end if;
 select * into r from public.creator_weekly_revenue_direct_save_requests where creator_profile_id=c.id and idempotency_key=p_idempotency_key; if r.id is not null then select * into w from public.creator_weekly_revenue_records where id=r.weekly_revenue_record_id; return w; end if;
 v_start:=public.creator_weekly_revenue_period_start(p_data_date); v_end:=public.creator_weekly_revenue_period_end(v_start); select * into w from public.creator_weekly_revenue_records where creator_profile_id=c.id and week_start_date=v_start for update;
 if w.id is not null and public.creator_weekly_revenue_is_cumulative(w) then raise exception 'This period already has cumulative revenue and cannot be overwritten by direct input.'; end if;
 if w.id is null then insert into public.creator_weekly_revenue_records(creator_profile_id,week_start_date,week_end_date,revenue_amount,agent_note,status,source,is_cumulative_generated,revenue_entry_kind) values(c.id,v_start,v_end,p_revenue_amount,nullif(btrim(coalesce(p_agent_note,'')),''),'submitted','manual',false,'direct') returning * into w; else update public.creator_weekly_revenue_records set revenue_amount=p_revenue_amount,agent_note=nullif(btrim(coalesce(p_agent_note,'')),''),status='submitted' where id=w.id returning * into w; end if;
 insert into public.creator_weekly_revenue_direct_save_requests(creator_profile_id,requested_by_profile_id,idempotency_key,weekly_revenue_record_id) values(c.id,auth.uid(),p_idempotency_key,w.id); return w;
end; $$;

-- Internal definer helpers are callable only from controlled definer RPCs.
drop function if exists public.list_personal_manager_weekly_revenue_profiles();
create function public.list_personal_manager_weekly_revenue_profiles()
returns table (id uuid,creator_entity_id uuid,joined_date date,platform public.creator_platform,platform_user_id text,platform_account text,platform_public_id text,region_id uuid,region_code text,region_name text,creator_name text,scout_employee_id uuid,scout_profile_id uuid,scout_full_name text,scout_nickname text,manager_employee_id uuid,manager_full_name text,manager_nickname text,secondary_manager_employee_id uuid,secondary_manager_display_name text,creator_type public.creator_type,status text,membership_status text,is_priority boolean,revenue_cycle text,revenue_input_mode text,pending_revenue_input_mode text,revenue_input_mode_effective_date date,effective_revenue_input_mode text,bank_account_name text,bank_name text,bank_account text,created_at timestamptz,updated_at timestamptz)
language sql stable security definer set search_path=public,pg_temp as $$
 select c.id,c.creator_entity_id,c.joined_date,c.platform,c.platform_user_id,c.platform_account,c.platform_public_id,c.region_id,r.code,r.name,c.creator_name,c.scout_employee_id,c.scout_profile_id,s.full_name,s.nickname,c.manager_employee_id,m.full_name,m.nickname,sm.employee_id,sm.display_name,c.creator_type,c.status,c.membership_status,e.is_priority,coalesce(c.revenue_cycle,'weekly'),coalesce(c.revenue_input_mode,'direct'),c.pending_revenue_input_mode,c.revenue_input_mode_effective_date,public.creator_effective_revenue_input_mode(c,public.current_malaysia_business_date()),case when c.manager_employee_id=public.current_user_employee_id() then c.bank_account_name else null end,case when c.manager_employee_id=public.current_user_employee_id() then c.bank_name else null end,case when c.manager_employee_id=public.current_user_employee_id() then c.bank_account else null end,c.created_at,c.updated_at
 from public.creator_profiles c join public.creator_entities e on e.id=c.creator_entity_id and e.status='active' left join public.regions r on r.id=c.region_id left join public.employees s on s.id=c.scout_employee_id left join public.employees m on m.id=c.manager_employee_id left join lateral (select a.employee_id,coalesce(nullif(btrim(x.nickname),''),x.full_name) display_name from public.creator_collaborator_assignments a join public.employees x on x.id=a.employee_id where a.creator_entity_id=c.creator_entity_id and a.assignment_type='manager' and a.assignment_role='secondary' and a.status='active' limit 1) sm on true
 where auth.uid() is not null and public.current_user_has_permission('agent-revenue-data','use') and public.current_user_can_access_region(c.region_id) and c.status='active' and c.membership_status='active' and c.manager_employee_id=public.current_user_employee_id() order by c.joined_date desc,c.id;
$$;
revoke all on function public.list_personal_manager_weekly_revenue_profiles() from public,anon;
grant execute on function public.list_personal_manager_weekly_revenue_profiles() to authenticated;
create or replace function public.get_creator_cumulative_revenue_context(p_creator_profile_id uuid,p_data_date date)
returns table(latest_cumulative_amount numeric,chain_active boolean,latest_data_date date,current_week_start_date date,opening_cumulative_amount numeric,estimated_period_amount numeric)
language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.creator_profiles; s public.creator_revenue_cumulative_state; p public.creator_revenue_cumulative_period_state;
begin
 if p_data_date is null then raise exception 'Data date is required.'; end if;
 select * into c from public.creator_profiles where id=p_creator_profile_id; perform public.assert_creator_cumulative_revenue_access(c);
 if c.revenue_cycle<>'weekly' or public.creator_effective_revenue_input_mode(c,p_data_date)<>'cumulative' then raise exception 'Cumulative calculation is only available for weekly cumulative creator profiles.'; end if;
 select * into s from public.creator_revenue_cumulative_state where creator_profile_id=c.id;
 select * into p from public.creator_revenue_cumulative_period_state where creator_profile_id=c.id and week_start_date=public.creator_weekly_revenue_period_start(p_data_date) and chain_generation=coalesce(s.chain_generation,0) and is_active;
 return query select s.latest_cumulative_amount,coalesce(s.chain_active,false),(select r.data_date from public.creator_revenue_cumulative_records r where r.id=s.latest_raw_record_id),public.creator_weekly_revenue_period_start(p_data_date),p.opening_cumulative_amount,case when p.opening_cumulative_amount is null or s.latest_cumulative_amount is null then null else s.latest_cumulative_amount-p.opening_cumulative_amount end;
end; $$;
revoke all on function public.apply_due_creator_revenue_input_mode(uuid,date) from public,anon,authenticated;
revoke all on function public.creator_effective_revenue_input_mode(public.creator_profiles,date) from public,anon,authenticated;
revoke all on function public.submit_creator_cumulative_revenue_with_backfills(uuid,numeric,date,uuid,jsonb,text) from public,anon;
grant execute on function public.submit_creator_cumulative_revenue_with_backfills(uuid,numeric,date,uuid,jsonb,text) to authenticated;
revoke all on function public.list_creator_cumulative_missing_periods(uuid,date) from public,anon;
grant execute on function public.list_creator_cumulative_missing_periods(uuid,date) to authenticated;
commit;
