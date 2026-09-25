begin;

-- Existing generations deliberately remain legacy_unknown. In particular, a
-- numeric zero never implies that the generation was intentionally zero-start.
alter table public.creator_revenue_cumulative_state
  add column if not exists baseline_calculation_policy text not null default 'legacy_unknown',
  add column if not exists baseline_effective_week_start_date date null,
  add constraint creator_revenue_cumulative_state_baseline_policy_check check
    (baseline_calculation_policy in ('zero_start_current_period', 'ordinary_next_period', 'legacy_unknown'));

-- The old signature is removed so an older client cannot create an ambiguous reset.
drop function if exists public.reset_creator_cumulative_revenue_baseline(uuid,numeric,date,text,uuid);
drop function if exists public.get_creator_cumulative_revenue_context(uuid,date);

create function public.reset_creator_cumulative_revenue_baseline(
  p_creator_profile_id uuid, p_new_baseline_amount numeric, p_baseline_calculation_policy text,
  p_data_date date, p_reason text, p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.creator_profiles; s public.creator_revenue_cumulative_state; r public.creator_revenue_cumulative_records;
  v_start date; v_effective date; v_baseline numeric; v_reason text:=nullif(btrim(coalesce(p_reason,'')), '');
begin
  if auth.uid() is null or not public.current_user_is_super_admin() then raise exception 'Only Super Admin can reset a cumulative revenue baseline.'; end if;
  if p_baseline_calculation_policy not in ('zero_start_current_period','ordinary_next_period') then raise exception 'A valid explicit baseline calculation policy is required.'; end if;
  if p_data_date is null or p_idempotency_key is null or v_reason is null then raise exception 'Reset requires data date, idempotency key, and reason.'; end if;
  if p_baseline_calculation_policy='ordinary_next_period' and (p_new_baseline_amount is null or p_new_baseline_amount<0) then raise exception 'An ordinary baseline requires a non-negative current cumulative amount.'; end if;
  v_baseline:=case when p_baseline_calculation_policy='zero_start_current_period' then 0 else p_new_baseline_amount end;
  perform pg_advisory_xact_lock(hashtextextended(p_creator_profile_id::text,0));
  select * into c from public.creator_profiles where id=p_creator_profile_id for update; perform public.assert_creator_cumulative_revenue_access(c);
  if c.revenue_cycle<>'weekly' or public.creator_effective_revenue_input_mode(c,p_data_date)<>'cumulative' then raise exception 'Reset is only available for weekly cumulative creator profiles.'; end if;
  select * into r from public.creator_revenue_cumulative_records where creator_profile_id=c.id and idempotency_key=p_idempotency_key;
  if r.id is not null then return jsonb_build_object('idempotent',true,'entry_kind',r.entry_kind); end if;
  select * into s from public.creator_revenue_cumulative_state where creator_profile_id=c.id for update;
  if s.creator_profile_id is null then insert into public.creator_revenue_cumulative_state(creator_profile_id) values(c.id) returning * into s; end if;
  if p_data_date<(select data_date from public.creator_revenue_cumulative_records where id=s.latest_raw_record_id) then raise exception 'Reset data date cannot be earlier than the latest cumulative observation.'; end if;
  v_start:=public.creator_weekly_revenue_period_start(p_data_date);
  v_effective:=case when p_baseline_calculation_policy='zero_start_current_period' then v_start else public.creator_weekly_revenue_period_start(public.creator_weekly_revenue_period_end(v_start)+1) end;
  update public.creator_revenue_cumulative_period_state set is_active=false,updated_at=now() where creator_profile_id=c.id and is_active;
  insert into public.creator_revenue_cumulative_records(creator_profile_id,creator_entity_id,platform,platform_uid,cumulative_amount,previous_cumulative_amount,data_date,week_start_date,entered_by_employee_id,source,entry_kind,idempotency_key,note)
  values(c.id,c.creator_entity_id,c.platform,c.platform_user_id,v_baseline,s.latest_cumulative_amount,p_data_date,v_start,public.current_user_employee_id(),'manual','reset',p_idempotency_key,v_reason) returning * into r;
  update public.creator_revenue_cumulative_state set latest_cumulative_amount=v_baseline,latest_raw_record_id=r.id,chain_active=true,chain_generation=chain_generation+1,calculation_resumes_week_start_date=v_effective,baseline_calculation_policy=p_baseline_calculation_policy,baseline_effective_week_start_date=v_effective,updated_at=now() where creator_profile_id=c.id;
  return jsonb_build_object('idempotent',false,'entry_kind','reset','baseline_calculation_policy',p_baseline_calculation_policy,'baseline_effective_week_start_date',v_effective);
end; $$;

-- Initialization intentionally keeps the pre-existing agent access model; reset
-- remains Super Admin only. Both paths require an explicit policy.
create function public.initialize_creator_cumulative_revenue_baseline(
  p_creator_profile_id uuid, p_new_baseline_amount numeric, p_baseline_calculation_policy text,
  p_data_date date, p_idempotency_key uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.creator_profiles; s public.creator_revenue_cumulative_state; r public.creator_revenue_cumulative_records; v_start date; v_effective date; v_baseline numeric;
begin
 if p_baseline_calculation_policy not in ('zero_start_current_period','ordinary_next_period') then raise exception 'A valid explicit baseline calculation policy is required.'; end if;
 if p_data_date is null or p_idempotency_key is null then raise exception 'Data date and idempotency key are required.'; end if;
 if p_baseline_calculation_policy='ordinary_next_period' and (p_new_baseline_amount is null or p_new_baseline_amount<0) then raise exception 'An ordinary baseline requires a non-negative current cumulative amount.'; end if;
 v_baseline:=case when p_baseline_calculation_policy='zero_start_current_period' then 0 else p_new_baseline_amount end;
 perform pg_advisory_xact_lock(hashtextextended(p_creator_profile_id::text,0)); select * into c from public.creator_profiles where id=p_creator_profile_id for update; perform public.assert_creator_cumulative_revenue_access(c);
 if c.revenue_cycle<>'weekly' or public.creator_effective_revenue_input_mode(c,p_data_date)<>'cumulative' then raise exception 'Initialization is only available for weekly cumulative creator profiles.'; end if;
 select * into r from public.creator_revenue_cumulative_records where creator_profile_id=c.id and idempotency_key=p_idempotency_key; if r.id is not null then return jsonb_build_object('idempotent',true,'entry_kind',r.entry_kind); end if;
 select * into s from public.creator_revenue_cumulative_state where creator_profile_id=c.id for update; if s.creator_profile_id is not null and s.chain_active then raise exception 'A cumulative baseline already exists. Ask a Super Admin to reset it.'; end if;
 if s.creator_profile_id is null then insert into public.creator_revenue_cumulative_state(creator_profile_id) values(c.id) returning * into s; end if;
 v_start:=public.creator_weekly_revenue_period_start(p_data_date); v_effective:=case when p_baseline_calculation_policy='zero_start_current_period' then v_start else public.creator_weekly_revenue_period_start(public.creator_weekly_revenue_period_end(v_start)+1) end;
 insert into public.creator_revenue_cumulative_records(creator_profile_id,creator_entity_id,platform,platform_uid,cumulative_amount,data_date,week_start_date,entered_by_employee_id,source,entry_kind,idempotency_key,note) values(c.id,c.creator_entity_id,c.platform,c.platform_user_id,v_baseline,p_data_date,v_start,public.current_user_employee_id(),'manual','baseline',p_idempotency_key,nullif(btrim(coalesce(p_note,'')),'')) returning * into r;
 update public.creator_revenue_cumulative_state set latest_cumulative_amount=v_baseline,latest_raw_record_id=r.id,chain_active=true,chain_generation=chain_generation+1,calculation_resumes_week_start_date=v_effective,baseline_calculation_policy=p_baseline_calculation_policy,baseline_effective_week_start_date=v_effective,updated_at=now() where creator_profile_id=c.id;
 return jsonb_build_object('idempotent',false,'entry_kind','baseline','baseline_calculation_policy',p_baseline_calculation_policy,'baseline_effective_week_start_date',v_effective);
end; $$;

create or replace function public.submit_creator_cumulative_revenue(p_creator_profile_id uuid,p_cumulative_amount numeric,p_data_date date,p_idempotency_key uuid,p_note text default null,p_source text default 'manual')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.creator_profiles; s public.creator_revenue_cumulative_state; ps public.creator_revenue_cumulative_period_state; e public.creator_revenue_cumulative_records; raw public.creator_revenue_cumulative_records; w public.creator_weekly_revenue_records; v_start date; v_end date; v_amount numeric; v_count integer; v_employee uuid:=public.current_user_employee_id(); v_effective date; v_mature boolean;
begin
 if p_cumulative_amount is null or p_cumulative_amount<0 then raise exception 'Cumulative amount must be a non-negative number.'; end if;
 if p_data_date is null or p_idempotency_key is null then raise exception 'Data date and idempotency key are required.'; end if; if p_source<>'manual' then raise exception 'Only manual cumulative submissions are allowed by this RPC.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_creator_profile_id::text,0)); select * into c from public.apply_due_creator_revenue_input_mode(p_creator_profile_id,p_data_date); perform public.assert_creator_cumulative_revenue_access(c);
 if c.revenue_cycle<>'weekly' or c.revenue_input_mode<>'cumulative' then raise exception 'Cumulative calculation is only available for weekly cumulative creator profiles.'; end if;
 select * into e from public.creator_revenue_cumulative_records where creator_profile_id=c.id and idempotency_key=p_idempotency_key; if e.id is not null then select * into w from public.creator_weekly_revenue_records where id=e.related_weekly_revenue_record_id; return jsonb_build_object('idempotent',true,'entry_kind',e.entry_kind,'weekly_record',to_jsonb(w),'previous_cumulative_amount',e.previous_cumulative_amount,'calculated_period_amount',e.calculated_period_amount); end if;
 select * into s from public.creator_revenue_cumulative_state where creator_profile_id=c.id for update; if s.creator_profile_id is null then insert into public.creator_revenue_cumulative_state(creator_profile_id) values(c.id) returning * into s; end if;
 v_start:=public.creator_weekly_revenue_period_start(p_data_date); v_end:=public.creator_weekly_revenue_period_end(v_start);
 if not s.chain_active then raise exception 'Cumulative baseline must be initialized before submitting revenue.'; end if;
 select exists(select 1 from public.creator_revenue_cumulative_period_state ps join public.creator_weekly_revenue_records qw on qw.id=ps.weekly_revenue_record_id where ps.creator_profile_id=c.id and ps.chain_generation=s.chain_generation and ps.is_active and public.creator_weekly_revenue_is_cumulative(qw)) into v_mature;
 if s.baseline_calculation_policy='legacy_unknown' and not v_mature then raise exception 'This legacy cumulative baseline requires a Super Admin reset.'; end if;
 v_effective:=case when s.baseline_calculation_policy in ('zero_start_current_period','ordinary_next_period') then s.baseline_effective_week_start_date else s.calculation_resumes_week_start_date end;
 if v_effective is not null and v_start<v_effective then raise exception 'The new cumulative baseline starts calculating from the next period.'; end if;
 if p_data_date<(select data_date from public.creator_revenue_cumulative_records where id=s.latest_raw_record_id) then raise exception 'Data date cannot be earlier than the latest cumulative observation.'; end if; if p_cumulative_amount<s.latest_cumulative_amount then raise exception 'Cumulative amount cannot be lower than the previous cumulative amount. Ask a Super Admin to reset the baseline.'; end if;
 select * into ps from public.creator_revenue_cumulative_period_state where creator_profile_id=c.id and week_start_date=v_start and chain_generation=s.chain_generation and is_active for update; if ps.creator_profile_id is null then insert into public.creator_revenue_cumulative_period_state(creator_profile_id,week_start_date,chain_generation,opening_cumulative_amount,opening_raw_record_id) values(c.id,v_start,s.chain_generation,s.latest_cumulative_amount,s.latest_raw_record_id) returning * into ps; end if;
 v_amount:=p_cumulative_amount-ps.opening_cumulative_amount;
 if ps.weekly_revenue_record_id is not null then select * into w from public.creator_weekly_revenue_records q where q.id=ps.weekly_revenue_record_id and q.creator_profile_id=c.id and q.week_start_date=v_start and public.creator_weekly_revenue_is_cumulative(q) for update; if w.id is null then raise exception 'Cumulative weekly revenue ownership reference is invalid.'; end if; update public.creator_weekly_revenue_records set revenue_amount=v_amount,agent_note=nullif(btrim(coalesce(p_note,'')),''),status='submitted' where id=w.id returning * into w;
 else select count(*) into v_count from public.creator_weekly_revenue_records where creator_profile_id=c.id and week_start_date=v_start; if v_count>0 then raise exception 'A weekly revenue record already exists for this period and cannot be overwritten by cumulative mode.'; end if; insert into public.creator_weekly_revenue_records(creator_profile_id,week_start_date,week_end_date,revenue_amount,agent_note,status,source,is_cumulative_generated,revenue_entry_kind) values(c.id,v_start,v_end,v_amount,nullif(btrim(coalesce(p_note,'')),''),'submitted','manual',true,'cumulative_generated') returning * into w; update public.creator_revenue_cumulative_period_state set weekly_revenue_record_id=w.id,updated_at=now() where creator_profile_id=c.id and week_start_date=v_start and chain_generation=s.chain_generation; end if;
 insert into public.creator_revenue_cumulative_records(creator_profile_id,creator_entity_id,platform,platform_uid,cumulative_amount,previous_cumulative_amount,calculated_period_amount,data_date,week_start_date,entered_by_employee_id,source,entry_kind,related_weekly_revenue_record_id,idempotency_key,note) values(c.id,c.creator_entity_id,c.platform,c.platform_user_id,p_cumulative_amount,s.latest_cumulative_amount,v_amount,p_data_date,v_start,v_employee,p_source,'calculation',w.id,p_idempotency_key,nullif(btrim(coalesce(p_note,'')),'')) returning * into raw;
 update public.creator_revenue_cumulative_state set latest_cumulative_amount=p_cumulative_amount,latest_raw_record_id=raw.id,calculation_resumes_week_start_date=null,updated_at=now() where creator_profile_id=c.id;
 return jsonb_build_object('idempotent',false,'entry_kind','calculation','weekly_record',to_jsonb(w),'previous_cumulative_amount',s.latest_cumulative_amount,'calculated_period_amount',v_amount);
end; $$;

create or replace function public.list_creator_cumulative_missing_periods(p_creator_profile_id uuid,p_data_date date)
returns table(period_start date,period_end date) language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.creator_profiles; s public.creator_revenue_cumulative_state; v_current date; v_cursor date; v_mature boolean;
begin
 if p_data_date is null then raise exception 'Data date is required.'; end if; select * into c from public.creator_profiles where id=p_creator_profile_id; perform public.assert_creator_cumulative_revenue_access(c); select * into s from public.creator_revenue_cumulative_state where creator_profile_id=c.id;
 if s.creator_profile_id is null or not s.chain_active then return; end if;
 select exists(select 1 from public.creator_revenue_cumulative_period_state ps join public.creator_weekly_revenue_records qw on qw.id=ps.weekly_revenue_record_id where ps.creator_profile_id=c.id and ps.chain_generation=s.chain_generation and ps.is_active and public.creator_weekly_revenue_is_cumulative(qw)) into v_mature;
 if s.baseline_calculation_policy='legacy_unknown' and not v_mature then return; end if;
 v_current:=public.creator_weekly_revenue_period_start(p_data_date); select week_start_date into v_cursor from public.creator_revenue_cumulative_records where id=s.latest_raw_record_id; v_cursor:=case when s.baseline_calculation_policy in ('zero_start_current_period','ordinary_next_period') then s.baseline_effective_week_start_date else public.creator_weekly_revenue_period_start(public.creator_weekly_revenue_period_end(v_cursor)+1) end;
 while v_cursor<v_current loop if not exists(select 1 from public.creator_weekly_revenue_records w where w.creator_profile_id=c.id and w.week_start_date=v_cursor) then period_start:=v_cursor; period_end:=public.creator_weekly_revenue_period_end(v_cursor); return next; end if; v_cursor:=public.creator_weekly_revenue_period_start(public.creator_weekly_revenue_period_end(v_cursor)+1); end loop;
end; $$;

create or replace function public.submit_creator_cumulative_revenue_with_backfills(p_creator_profile_id uuid,p_cumulative_amount numeric,p_data_date date,p_idempotency_key uuid,p_backfills jsonb,p_note text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.creator_profiles; s public.creator_revenue_cumulative_state; e public.creator_revenue_cumulative_records; raw public.creator_revenue_cumulative_records; ps public.creator_revenue_cumulative_period_state; w public.creator_weekly_revenue_records; x record; v_start date; v_prev_start date; v_cursor date; v_expected jsonb:='[]'::jsonb; v_actual jsonb:=coalesce(p_backfills,'[]'::jsonb); v_sum numeric:=0; v_generated numeric; v_employee uuid:=public.current_user_employee_id(); v_mature boolean;
begin
 if p_cumulative_amount is null or p_cumulative_amount<0 or p_data_date is null or p_idempotency_key is null or jsonb_typeof(v_actual)<>'array' then raise exception 'Cumulative amount, data date, idempotency key, and a backfill array are required.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_creator_profile_id::text,0)); select * into c from public.apply_due_creator_revenue_input_mode(p_creator_profile_id,p_data_date); perform public.assert_creator_cumulative_revenue_access(c); if c.revenue_cycle<>'weekly' or c.revenue_input_mode<>'cumulative' then raise exception 'Cumulative calculation is only available for weekly cumulative creator profiles.'; end if;
 select * into e from public.creator_revenue_cumulative_records where creator_profile_id=c.id and idempotency_key=p_idempotency_key; if e.id is not null then select * into w from public.creator_weekly_revenue_records where id=e.related_weekly_revenue_record_id; return jsonb_build_object('idempotent',true,'entry_kind',e.entry_kind,'weekly_record',to_jsonb(w)); end if;
 select * into s from public.creator_revenue_cumulative_state where creator_profile_id=c.id for update; if s.creator_profile_id is null or not s.chain_active then raise exception 'Establish a cumulative baseline before using backfill.'; end if;
 select exists(select 1 from public.creator_revenue_cumulative_period_state psm join public.creator_weekly_revenue_records qw on qw.id=psm.weekly_revenue_record_id where psm.creator_profile_id=c.id and psm.chain_generation=s.chain_generation and psm.is_active and public.creator_weekly_revenue_is_cumulative(qw)) into v_mature; if s.baseline_calculation_policy='legacy_unknown' and not v_mature then raise exception 'This legacy cumulative baseline requires a Super Admin reset.'; end if;
 v_start:=public.creator_weekly_revenue_period_start(p_data_date); if (case when s.baseline_calculation_policy in ('zero_start_current_period','ordinary_next_period') then s.baseline_effective_week_start_date else s.calculation_resumes_week_start_date end) is not null and v_start<(case when s.baseline_calculation_policy in ('zero_start_current_period','ordinary_next_period') then s.baseline_effective_week_start_date else s.calculation_resumes_week_start_date end) then raise exception 'The new cumulative baseline starts calculating from the next period.'; end if;
 if p_data_date<(select data_date from public.creator_revenue_cumulative_records where id=s.latest_raw_record_id) then raise exception 'Data date cannot be earlier than the latest cumulative observation.'; end if; if p_cumulative_amount<s.latest_cumulative_amount then raise exception 'Cumulative amount cannot be lower than the previous cumulative amount.'; end if;
 select week_start_date into v_prev_start from public.creator_revenue_cumulative_records where id=s.latest_raw_record_id; v_cursor:=case when s.baseline_calculation_policy in ('zero_start_current_period','ordinary_next_period') then greatest(s.baseline_effective_week_start_date,public.creator_weekly_revenue_period_start(public.creator_weekly_revenue_period_end(v_prev_start)+1)) else public.creator_weekly_revenue_period_start(public.creator_weekly_revenue_period_end(v_prev_start)+1) end;
 while v_cursor<v_start loop v_expected:=v_expected || jsonb_build_array(to_jsonb(v_cursor)); v_cursor:=public.creator_weekly_revenue_period_start(public.creator_weekly_revenue_period_end(v_cursor)+1); end loop;
 if jsonb_array_length(v_expected)=0 then raise exception 'There are no missing periods for a backfill submission.'; end if;
 if (select count(*) from jsonb_array_elements(v_actual) b where not (b ? 'period_start' and b ? 'weekly_amount') or (b->>'period_start')::date <> public.creator_weekly_revenue_period_start((b->>'period_start')::date) or (b->>'weekly_amount')::numeric<0) <> jsonb_array_length(v_actual) then raise exception 'Each backfill requires a canonical period start and a non-negative weekly amount.'; end if;
 if (select count(distinct (b->>'period_start')::date) from jsonb_array_elements(v_actual) b) <> jsonb_array_length(v_actual) or (select jsonb_agg(to_jsonb((b->>'period_start')::date) order by (b->>'period_start')::date) from jsonb_array_elements(v_actual) b) is distinct from v_expected then raise exception 'Backfills must match every missing canonical period exactly once.'; end if;
 select coalesce(sum((b->>'weekly_amount')::numeric),0) into v_sum from jsonb_array_elements(v_actual) b; v_generated:=p_cumulative_amount-s.latest_cumulative_amount-v_sum; if v_generated<0 then raise exception 'Manual backfill total cannot exceed cumulative growth.'; end if;
 if exists(select 1 from jsonb_array_elements(v_actual) b join public.creator_weekly_revenue_records q on q.creator_profile_id=c.id and q.week_start_date=(b->>'period_start')::date) then raise exception 'A missing period already has weekly revenue and cannot be backfilled.'; end if; if exists(select 1 from public.creator_weekly_revenue_records q where q.creator_profile_id=c.id and q.week_start_date=v_start) then raise exception 'A weekly revenue record already exists for the current period.'; end if;
 for x in select (b->>'period_start')::date as start_date,(b->>'weekly_amount')::numeric as amount from jsonb_array_elements(v_actual) b loop insert into public.creator_weekly_revenue_records(creator_profile_id,week_start_date,week_end_date,revenue_amount,agent_note,status,source,is_cumulative_generated,revenue_entry_kind) values(c.id,x.start_date,public.creator_weekly_revenue_period_end(x.start_date),x.amount,nullif(btrim(coalesce(p_note,'')),''),'submitted','manual',false,'cumulative_manual_backfill'); end loop;
 insert into public.creator_revenue_cumulative_period_state(creator_profile_id,week_start_date,chain_generation,opening_cumulative_amount,opening_raw_record_id) values(c.id,v_start,s.chain_generation,s.latest_cumulative_amount,s.latest_raw_record_id) returning * into ps; insert into public.creator_weekly_revenue_records(creator_profile_id,week_start_date,week_end_date,revenue_amount,agent_note,status,source,is_cumulative_generated,revenue_entry_kind) values(c.id,v_start,public.creator_weekly_revenue_period_end(v_start),v_generated,nullif(btrim(coalesce(p_note,'')) ,''),'submitted','manual',true,'cumulative_generated') returning * into w;
 update public.creator_revenue_cumulative_period_state set weekly_revenue_record_id=w.id,updated_at=now() where creator_profile_id=c.id and week_start_date=v_start and chain_generation=s.chain_generation; insert into public.creator_revenue_cumulative_records(creator_profile_id,creator_entity_id,platform,platform_uid,cumulative_amount,previous_cumulative_amount,calculated_period_amount,data_date,week_start_date,entered_by_employee_id,source,entry_kind,related_weekly_revenue_record_id,idempotency_key,note) values(c.id,c.creator_entity_id,c.platform,c.platform_user_id,p_cumulative_amount,s.latest_cumulative_amount,v_generated,p_data_date,v_start,v_employee,'manual','calculation',w.id,p_idempotency_key,nullif(btrim(coalesce(p_note,'')),'')) returning * into raw; update public.creator_revenue_cumulative_state set latest_cumulative_amount=p_cumulative_amount,latest_raw_record_id=raw.id,calculation_resumes_week_start_date=null,updated_at=now() where creator_profile_id=c.id;
 return jsonb_build_object('idempotent',false,'entry_kind','calculation','weekly_record',to_jsonb(w),'previous_cumulative_amount',s.latest_cumulative_amount,'calculated_period_amount',v_generated,'backfill_count',jsonb_array_length(v_actual));
end; $$;

create or replace function public.get_creator_cumulative_revenue_context(p_creator_profile_id uuid,p_data_date date)
returns table(latest_cumulative_amount numeric,chain_active boolean,latest_data_date date,current_week_start_date date,opening_cumulative_amount numeric,estimated_period_amount numeric,baseline_calculation_policy text,baseline_effective_week_start_date date,can_calculate_selected_period boolean,requires_baseline_initialization boolean,requires_baseline_reset boolean)
language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.creator_profiles; s public.creator_revenue_cumulative_state; p public.creator_revenue_cumulative_period_state; v_start date; v_can boolean; v_mature boolean;
begin
 if p_data_date is null then raise exception 'Data date is required.'; end if; select * into c from public.creator_profiles where id=p_creator_profile_id; perform public.assert_creator_cumulative_revenue_access(c); if c.revenue_cycle<>'weekly' or public.creator_effective_revenue_input_mode(c,p_data_date)<>'cumulative' then raise exception 'Cumulative calculation is only available for weekly cumulative creator profiles.'; end if;
 select * into s from public.creator_revenue_cumulative_state where creator_profile_id=c.id; v_start:=public.creator_weekly_revenue_period_start(p_data_date); select * into p from public.creator_revenue_cumulative_period_state where creator_profile_id=c.id and week_start_date=v_start and chain_generation=coalesce(s.chain_generation,0) and is_active;
 select exists(select 1 from public.creator_revenue_cumulative_period_state psm join public.creator_weekly_revenue_records qw on qw.id=psm.weekly_revenue_record_id where psm.creator_profile_id=c.id and psm.chain_generation=coalesce(s.chain_generation,0) and psm.is_active and public.creator_weekly_revenue_is_cumulative(qw)) into v_mature;
 v_can:=coalesce(s.chain_active,false) and ((s.baseline_calculation_policy='legacy_unknown' and v_mature and (s.calculation_resumes_week_start_date is null or v_start>=s.calculation_resumes_week_start_date)) or (s.baseline_calculation_policy in ('zero_start_current_period','ordinary_next_period') and v_start>=s.baseline_effective_week_start_date));
 return query select s.latest_cumulative_amount,coalesce(s.chain_active,false),(select r.data_date from public.creator_revenue_cumulative_records r where r.id=s.latest_raw_record_id),v_start,p.opening_cumulative_amount,case when p.opening_cumulative_amount is null or s.latest_cumulative_amount is null then null else s.latest_cumulative_amount-p.opening_cumulative_amount end,coalesce(s.baseline_calculation_policy,'legacy_unknown'),coalesce(s.baseline_effective_week_start_date,s.calculation_resumes_week_start_date),coalesce(v_can,false),not coalesce(s.chain_active,false),coalesce(s.chain_active,false) and s.baseline_calculation_policy='legacy_unknown' and not v_mature;
end; $$;

revoke all on function public.reset_creator_cumulative_revenue_baseline(uuid,numeric,text,date,text,uuid) from public,anon;
grant execute on function public.reset_creator_cumulative_revenue_baseline(uuid,numeric,text,date,text,uuid) to authenticated;
revoke all on function public.initialize_creator_cumulative_revenue_baseline(uuid,numeric,text,date,uuid,text) from public,anon;
grant execute on function public.initialize_creator_cumulative_revenue_baseline(uuid,numeric,text,date,uuid,text) to authenticated;
revoke all on function public.submit_creator_cumulative_revenue(uuid,numeric,date,uuid,text,text) from public,anon;
grant execute on function public.submit_creator_cumulative_revenue(uuid,numeric,date,uuid,text,text) to authenticated;
revoke all on function public.list_creator_cumulative_missing_periods(uuid,date) from public,anon;
grant execute on function public.list_creator_cumulative_missing_periods(uuid,date) to authenticated;
revoke all on function public.submit_creator_cumulative_revenue_with_backfills(uuid,numeric,date,uuid,jsonb,text) from public,anon;
grant execute on function public.submit_creator_cumulative_revenue_with_backfills(uuid,numeric,date,uuid,jsonb,text) to authenticated;
revoke all on function public.get_creator_cumulative_revenue_context(uuid,date) from public,anon;
grant execute on function public.get_creator_cumulative_revenue_context(uuid,date) to authenticated;
commit;
