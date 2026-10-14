-- Phase E: no historical data backfill. Requires the reviewed Phase D migration.
begin;
create table public.creator_revenue_cycle_history (
  creator_profile_id uuid not null references public.creator_profiles(id) on delete restrict,
  effective_month date not null check (effective_month=date_trunc('month',effective_month)::date),
  revenue_cycle text not null check(revenue_cycle in ('weekly','monthly','none')),
  source text not null check(source in ('creation','verified_baseline','immediate')),
  evidence text, created_by uuid references public.profiles(id), created_at timestamptz not null default now(),
  primary key(creator_profile_id,effective_month)
);
create table public.creator_revenue_cycle_audit (
  id uuid primary key default gen_random_uuid(), creator_profile_id uuid not null references public.creator_profiles(id) on delete restrict,
  effective_month date not null, old_cycle text, new_cycle text not null,
  action text not null, evidence text, actor_id uuid references public.profiles(id), created_at timestamptz not null default now()
);
create table public.creator_monthly_revenue_records (
  id uuid primary key default gen_random_uuid(), creator_profile_id uuid not null references public.creator_profiles(id) on delete restrict,
  revenue_month date not null check(revenue_month=date_trunc('month',revenue_month)::date),
  platform public.creator_platform not null, revenue_unit text not null,
  revenue_amount numeric(14,2) not null check(revenue_amount>=0 and revenue_amount<1000000000000),
  manager_employee_id_attribution uuid references public.employees(id), agent_note text, version integer not null default 1 check(version>0),
  created_by uuid not null references public.profiles(id), updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(creator_profile_id,revenue_month),
  check((platform='tiktok' and revenue_unit='diamond') or (platform='douyin' and revenue_unit='yinlang'))
);
create table public.creator_monthly_revenue_audit (
  id uuid primary key default gen_random_uuid(), record_id uuid not null references public.creator_monthly_revenue_records(id) on delete restrict,
  old_value jsonb, new_value jsonb not null, actor_id uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
create table public.creator_monthly_revenue_requests (
  actor_id uuid not null references public.profiles(id), idempotency_key uuid not null,
  payload jsonb not null, result jsonb not null, created_at timestamptz not null default now(), primary key(actor_id,idempotency_key)
);
alter table public.creator_revenue_cycle_history enable row level security;
alter table public.creator_revenue_cycle_audit enable row level security;
alter table public.creator_monthly_revenue_records enable row level security;
alter table public.creator_monthly_revenue_audit enable row level security;
alter table public.creator_monthly_revenue_requests enable row level security;
revoke all on public.creator_revenue_cycle_history,public.creator_revenue_cycle_audit,public.creator_monthly_revenue_records,public.creator_monthly_revenue_audit,public.creator_monthly_revenue_requests from public,anon,authenticated;

create function public.creator_effective_revenue_cycle(p_profile_id uuid,p_month date)
returns text language sql stable security definer set search_path=public,pg_temp as $$
 select revenue_cycle from public.creator_revenue_cycle_history
 where creator_profile_id=p_profile_id and effective_month<=date_trunc('month',p_month)::date
 order by effective_month desc limit 1;
$$;
-- Operational compatibility only: never write a verified historical baseline.
-- Only profiles with NO history and an explicit current weekly setting qualify.
create function public.creator_weekly_compatible_cycle(p_profile_id uuid,p_month date)
returns text language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(public.creator_effective_revenue_cycle(p_profile_id,p_month),
   case when c.revenue_cycle='weekly' and not exists (
     select 1 from public.creator_revenue_cycle_history h where h.creator_profile_id=c.id
   ) then 'weekly' end)
 from public.creator_profiles c where c.id=p_profile_id;
$$;
create function public.can_access_monthly_revenue(p_profile_id uuid,p_action text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select auth.uid() is not null and p_action in ('view','use') and exists(
 select 1 from public.creator_profiles c join public.creator_entities e on e.id=c.creator_entity_id
 where c.id=p_profile_id and c.status='active' and c.membership_status='active' and e.status='active'
 and public.current_user_can_access_region(c.region_id)
 and case when p_action='use' then
   public.current_user_has_permission('agent-revenue-data','use')
   and (public.current_user_is_super_admin() or c.manager_employee_id=public.current_user_employee_id())
 else (public.current_user_has_permission('agent-revenue-data','view')
       and (public.current_user_is_super_admin() or c.manager_employee_id=public.current_user_employee_id()))
   or public.current_user_has_permission('management-revenue-data','view') end);
$$;
create function public.initialize_creator_revenue_cycle_baseline(p_profile_id uuid,p_effective_month date,p_cycle text,p_evidence text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.creator_profiles;
begin
 if auth.uid() is null or not public.current_user_has_explicit_permission('agent-creator-revenue-settings','use') then raise exception 'CYCLE_PERMISSION_DENIED' using errcode='42501'; end if;
 if p_effective_month is null or p_effective_month<>date_trunc('month',p_effective_month)::date or p_effective_month<date_trunc('month',public.current_malaysia_business_date())::date
 or p_cycle is null or p_cycle not in ('weekly','monthly','none') or length(btrim(coalesce(p_evidence,'')))<20 then raise exception 'BASELINE_VERIFICATION_REQUIRED' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_profile_id::text,0));
 select * into c from public.creator_profiles where id=p_profile_id for update;
 if c.id is null or not public.current_user_can_manage_creator_entity(c.creator_entity_id) or not public.current_user_can_access_region(c.region_id) then raise exception 'CYCLE_SCOPE_DENIED' using errcode='42501'; end if;
 if exists(select 1 from public.creator_revenue_cycle_history where creator_profile_id=p_profile_id) then raise exception 'BASELINE_ALREADY_EXISTS' using errcode='23505'; end if;
 insert into public.creator_revenue_cycle_history values(p_profile_id,p_effective_month,p_cycle,'verified_baseline',p_evidence,auth.uid(),now());
 insert into public.creator_revenue_cycle_audit(creator_profile_id,effective_month,new_cycle,action,evidence,actor_id) values(p_profile_id,p_effective_month,p_cycle,'verified_baseline',p_evidence,auth.uid());
end; $$;

-- All existing UPDATE paths (including generic creator updates) pass this gate.
-- Current-month changes are immediate; earlier verified months remain immutable.
create function public.track_creator_revenue_cycle()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_month date; v_old text;
begin
 if tg_op='INSERT' then
   v_month:=greatest(date_trunc('month',public.current_malaysia_business_date())::date,date_trunc('month',new.joined_date)::date); -- Observed creation, never inferred past history.
   insert into public.creator_revenue_cycle_history(creator_profile_id,effective_month,revenue_cycle,source,created_by)
     values(new.id,v_month,new.revenue_cycle,'creation',auth.uid());
   insert into public.creator_revenue_cycle_audit(creator_profile_id,effective_month,new_cycle,action,actor_id) values(new.id,v_month,new.revenue_cycle,'creation',auth.uid());
 elsif new.revenue_cycle is distinct from old.revenue_cycle then
   if auth.uid() is null or not public.current_user_has_explicit_permission('agent-creator-revenue-settings','use') or not public.current_user_can_manage_creator_entity(new.creator_entity_id) or not public.current_user_can_access_region(new.region_id) then raise exception 'CYCLE_PERMISSION_DENIED' using errcode='42501'; end if;
   -- The UPDATE already holds the profile row lock; avoid inverse lock order.
   if not exists(select 1 from public.creator_revenue_cycle_history where creator_profile_id=new.id and effective_month<=date_trunc('month',public.current_malaysia_business_date())::date) then raise exception 'CYCLE_BASELINE_REQUIRED' using errcode='55000'; end if;
   v_month:=date_trunc('month',public.current_malaysia_business_date())::date;
   v_old:=public.creator_effective_revenue_cycle(new.id,v_month);
   insert into public.creator_revenue_cycle_history(creator_profile_id,effective_month,revenue_cycle,source,created_by) values(new.id,v_month,new.revenue_cycle,'immediate',auth.uid())
     on conflict(creator_profile_id,effective_month) do update set revenue_cycle=excluded.revenue_cycle,source='immediate',created_by=excluded.created_by,created_at=now();
   insert into public.creator_revenue_cycle_audit(creator_profile_id,effective_month,old_cycle,new_cycle,action,actor_id)
     values(new.id,v_month,v_old,new.revenue_cycle,'immediate_change',auth.uid());
 end if;
 return new;
end; $$;
create trigger track_creator_revenue_cycle after insert or update of revenue_cycle on public.creator_profiles for each row execute function public.track_creator_revenue_cycle();

create function public.list_creator_revenue_month_context(p_profile_ids uuid[],p_month date)
returns table(creator_profile_id uuid,effective_cycle text,cycle_source text,monthly_record jsonb,can_write boolean)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 if p_month is null or p_month<>date_trunc('month',p_month)::date or p_profile_ids is null or cardinality(p_profile_ids)>500 then raise exception 'INVALID_MONTH_OR_IDS' using errcode='22023'; end if;
 return query select c.id,public.creator_weekly_compatible_cycle(c.id,p_month),
   case when public.creator_effective_revenue_cycle(c.id,p_month) is not null then 'VERIFIED' when public.creator_weekly_compatible_cycle(c.id,p_month)='weekly' then 'LEGACY_CURRENT_WEEKLY' else 'LEGACY_UNKNOWN' end,
   case when m.id is null then null else to_jsonb(m) end,public.can_access_monthly_revenue(c.id,'use')
 from public.creator_profiles c left join public.creator_monthly_revenue_records m on m.creator_profile_id=c.id and m.revenue_month=p_month
 where c.id=any(p_profile_ids) and public.can_access_monthly_revenue(c.id,'view');
end; $$;
create function public.save_creator_monthly_revenue(p_profile_id uuid,p_month date,p_amount numeric,p_note text,p_expected_version integer,p_idempotency_key uuid)
returns public.creator_monthly_revenue_records language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.creator_profiles; old_row public.creator_monthly_revenue_records; saved public.creator_monthly_revenue_records; request public.creator_monthly_revenue_requests; v_payload jsonb;
begin
 if not public.can_access_monthly_revenue(p_profile_id,'use') then raise exception 'MONTHLY_PERMISSION_DENIED' using errcode='42501'; end if;
 if p_month is null or p_month<>date_trunc('month',p_month)::date or p_amount is null or p_amount<0 or p_amount>=1000000000000 or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<>round(p_amount,2)
 or p_expected_version is null or p_expected_version<0 or p_idempotency_key is null or length(coalesce(p_note,''))>2000 then raise exception 'MONTHLY_INVALID_INPUT' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_idempotency_key::text,0));
 v_payload:=jsonb_build_object('profile',p_profile_id,'month',p_month,'amount',p_amount,'note',p_note,'expected_version',p_expected_version);
 select * into request from public.creator_monthly_revenue_requests where actor_id=auth.uid() and idempotency_key=p_idempotency_key;
 if request.actor_id is not null then
   if request.payload<>v_payload then raise exception 'IDEMPOTENCY_PAYLOAD_CONFLICT' using errcode='23505'; end if;
   return jsonb_populate_record(null::public.creator_monthly_revenue_records,request.result);
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_profile_id::text,0));
 select * into c from public.creator_profiles where id=p_profile_id for update;
 if not public.can_access_monthly_revenue(p_profile_id,'use') then raise exception 'MONTHLY_PERMISSION_DENIED' using errcode='42501'; end if;
 if public.creator_effective_revenue_cycle(p_profile_id,p_month) is distinct from 'monthly' then raise exception 'MONTHLY_CYCLE_NOT_APPLICABLE' using errcode='55000'; end if;
 if c.platform not in ('tiktok','douyin') then raise exception 'INVALID_PLATFORM' using errcode='22023'; end if;
 select * into old_row from public.creator_monthly_revenue_records where creator_profile_id=p_profile_id and revenue_month=p_month for update;
 if coalesce(old_row.version,0)<>p_expected_version then raise exception 'MONTHLY_VERSION_CONFLICT' using errcode='40001'; end if;
 if old_row.id is null then
   insert into public.creator_monthly_revenue_records(creator_profile_id,revenue_month,platform,revenue_unit,revenue_amount,agent_note,manager_employee_id_attribution,created_by,updated_by)
   values(p_profile_id,p_month,c.platform,case when c.platform='tiktok' then 'diamond' else 'yinlang' end,p_amount,nullif(btrim(coalesce(p_note,'')),''),c.manager_employee_id,auth.uid(),auth.uid()) returning * into saved;
 else
   update public.creator_monthly_revenue_records set revenue_amount=p_amount,agent_note=nullif(btrim(coalesce(p_note,'')),''),version=version+1,updated_by=auth.uid(),updated_at=now() where id=old_row.id returning * into saved;
 end if;
 insert into public.creator_monthly_revenue_audit(record_id,old_value,new_value,actor_id) values(saved.id,case when old_row.id is null then null else to_jsonb(old_row) end,to_jsonb(saved),auth.uid());
 insert into public.creator_monthly_revenue_requests(actor_id,idempotency_key,payload,result) values(auth.uid(),p_idempotency_key,v_payload,to_jsonb(saved));
 return saved;
end; $$;

-- Defense in depth covers all legacy weekly RPC and direct-table write paths.
create function public.guard_weekly_effective_cycle()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='UPDATE' and (new.creator_profile_id<>old.creator_profile_id or new.week_start_date<>old.week_start_date) then raise exception 'WEEKLY_IDENTITY_IMMUTABLE' using errcode='22023'; end if;
 -- Serialize with cycle edits; existing RPC/RLS remains the permission gate.
 perform 1 from public.creator_profiles where id=new.creator_profile_id for update;
 if public.creator_weekly_compatible_cycle(new.creator_profile_id,new.week_start_date) is distinct from 'weekly' then raise exception 'WEEKLY_CYCLE_NOT_APPLICABLE_OR_LEGACY' using errcode='55000'; end if;
 return new;
end; $$;
create trigger guard_weekly_effective_cycle before insert or update on public.creator_weekly_revenue_records for each row execute function public.guard_weekly_effective_cycle();

revoke all on function public.creator_weekly_compatible_cycle(uuid,date),public.creator_effective_revenue_cycle(uuid,date),public.can_access_monthly_revenue(uuid,text),public.track_creator_revenue_cycle(),public.guard_weekly_effective_cycle() from public,anon,authenticated;
revoke all on function public.initialize_creator_revenue_cycle_baseline(uuid,date,text,text),public.list_creator_revenue_month_context(uuid[],date),public.save_creator_monthly_revenue(uuid,date,numeric,text,integer,uuid) from public,anon;
grant execute on function public.initialize_creator_revenue_cycle_baseline(uuid,date,text,text),public.list_creator_revenue_month_context(uuid[],date),public.save_creator_monthly_revenue(uuid,date,numeric,text,integer,uuid) to authenticated;

-- Preserve direct weekly guard/permission/formula; resolve its selected month.
create or replace function public.save_direct_creator_weekly_revenue(p_creator_profile_id uuid,p_data_date date,p_revenue_amount numeric,p_agent_note text,p_idempotency_key uuid)
returns public.creator_weekly_revenue_records language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.creator_profiles; r public.creator_weekly_revenue_direct_save_requests; w public.creator_weekly_revenue_records; v_start date; v_end date;
begin
 if auth.uid() is null or p_creator_profile_id is null or p_data_date is null or p_idempotency_key is null or p_revenue_amount is null or p_revenue_amount<0 then raise exception 'Valid creator, date, idempotency key, and non-negative revenue are required.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_creator_profile_id::text,0)); select * into c from public.apply_due_creator_revenue_input_mode(p_creator_profile_id,p_data_date);
 if c.id is null or c.status<>'active' or c.membership_status<>'active' or public.creator_weekly_compatible_cycle(c.id,date_trunc('month',p_data_date)::date) is distinct from 'weekly' or c.revenue_input_mode<>'direct' then raise exception 'Direct weekly revenue is only available for active weekly direct creator profiles.'; end if;
 if not exists(select 1 from public.creator_entities e where e.id=c.creator_entity_id and e.status='active') then raise exception 'Creator entity is not active for current revenue actions.'; end if;
 if not public.current_user_has_permission('agent-revenue-data','use') or (not public.current_user_is_super_admin() and c.manager_employee_id is distinct from public.current_user_employee_id()) or not public.current_user_can_access_region(c.region_id) then raise exception 'No permission to save direct weekly revenue for this creator.'; end if;
 select * into r from public.creator_weekly_revenue_direct_save_requests where creator_profile_id=c.id and idempotency_key=p_idempotency_key; if r.id is not null then select * into w from public.creator_weekly_revenue_records where id=r.weekly_revenue_record_id; return w; end if;
 v_start:=public.creator_weekly_revenue_period_start(p_data_date); v_end:=public.creator_weekly_revenue_period_end(v_start); select * into w from public.creator_weekly_revenue_records where creator_profile_id=c.id and week_start_date=v_start for update;
 if w.id is not null and public.creator_weekly_revenue_is_cumulative(w) then raise exception 'This period already has cumulative revenue and cannot be overwritten by direct input.'; end if;
 if w.id is null then insert into public.creator_weekly_revenue_records(creator_profile_id,week_start_date,week_end_date,revenue_amount,agent_note,status,source,is_cumulative_generated,revenue_entry_kind) values(c.id,v_start,v_end,p_revenue_amount,nullif(btrim(coalesce(p_agent_note,'')),''),'submitted','manual',false,'direct') returning * into w; else update public.creator_weekly_revenue_records set revenue_amount=p_revenue_amount,agent_note=nullif(btrim(coalesce(p_agent_note,'')),''),status='submitted' where id=w.id returning * into w; end if;
 insert into public.creator_weekly_revenue_direct_save_requests(creator_profile_id,requested_by_profile_id,idempotency_key,weekly_revenue_record_id) values(c.id,auth.uid(),p_idempotency_key,w.id); return w;
end; $$;
-- Appended inside the Phase E transaction. Old v2 contracts remain unchanged.
create function public.list_agent_revenue_profiles_e(p_limit integer default 500,p_offset integer default 0)
returns table(profile jsonb) language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null or not public.current_user_has_permission('agent-revenue-data','view') then raise exception 'ROSTER_PERMISSION_DENIED' using errcode='42501'; end if;
 if p_limit not between 1 and 500 or p_offset<0 then raise exception 'INVALID_PAGINATION' using errcode='22023'; end if;
 return query select jsonb_build_object('id',c.id,'creator_entity_id',c.creator_entity_id,'joined_date',c.joined_date,'platform',c.platform,'platform_user_id',c.platform_user_id,'platform_account',c.platform_account,'platform_public_id',c.platform_public_id,'region_id',c.region_id,'region_code',r.code,'region_name',r.name,'creator_name',c.creator_name,'manager_employee_id',c.manager_employee_id,'manager_full_name',m.full_name,'manager_nickname',m.nickname,'scout_employee_id',c.scout_employee_id,'scout_profile_id',c.scout_profile_id,'creator_type',c.creator_type,'status',c.status,'membership_status',c.membership_status,'is_priority',e.is_priority,'revenue_cycle',c.revenue_cycle,'revenue_input_mode',c.revenue_input_mode,'effective_revenue_input_mode',c.revenue_input_mode,'created_at',c.created_at,'updated_at',c.updated_at)
 from public.creator_profiles c join public.creator_entities e on e.id=c.creator_entity_id
 left join public.regions r on r.id=c.region_id left join public.employees m on m.id=c.manager_employee_id
 where public.can_access_monthly_revenue(c.id,'view') and (public.current_user_is_super_admin() or c.manager_employee_id=public.current_user_employee_id())
 order by c.joined_date desc,c.id limit p_limit offset p_offset;
end; $$;
create function public.list_management_revenue_records_e(p_start_date date,p_end_date date,p_manager_employee_id uuid default null,p_platform text default null,p_creator_type text default null,p_region_id uuid default null,p_status text default null,p_limit integer default 500,p_offset integer default 0,p_revenue_cycle text default null)
returns table(record jsonb) language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null or not public.current_user_has_permission('management-revenue-data','view') then raise exception 'REPORT_PERMISSION_DENIED' using errcode='42501'; end if;
 if p_start_date is null or p_end_date is null or p_end_date<p_start_date or p_end_date-p_start_date>731 or p_limit is null or p_limit not between 1 and 500 or p_offset is null or p_offset<0
 or (p_platform is not null and p_platform not in ('tiktok','douyin')) or (p_creator_type is not null and p_creator_type not in ('5+1','non_5_1'))
 or (p_status is not null and p_status not in ('pending','confirmed')) or (p_revenue_cycle is not null and p_revenue_cycle not in ('weekly','monthly','none')) then raise exception 'INVALID_REPORT_FILTERS' using errcode='22023'; end if;
 return query with profiles as (
 select c.*,e.is_priority,r.code region_code,r.name region_name,m.full_name manager_name,m.nickname manager_nickname
 from public.creator_profiles c join public.creator_entities e on e.id=c.creator_entity_id left join public.regions r on r.id=c.region_id left join public.employees m on m.id=c.manager_employee_id
 where c.status='active' and c.membership_status='active' and e.status='active' and public.current_user_can_access_region(c.region_id)
 and (p_region_id is null or c.region_id=p_region_id) and (p_platform is null or c.platform::text=p_platform)
 and (p_creator_type is null or (p_creator_type='5+1' and c.creator_type::text='5+1') or (p_creator_type='non_5_1' and c.creator_type::text<>'5+1'))
 ), months as (select generate_series(date_trunc('month',p_start_date)::date,date_trunc('month',p_end_date)::date,interval '1 month')::date as revenue_period_month), scoped as (
 select p.*,months.revenue_period_month as revenue_period_month,public.creator_weekly_compatible_cycle(p.id,months.revenue_period_month) cycle from profiles p cross join months
 ), rows as (
 select s.*,w.id record_id,w.revenue_amount amount,w.revenue_unit unit,w.week_start_date starts,w.week_end_date ends,w.status::text record_status,w.agent_note note,w.created_at record_created,w.updated_at record_updated,coalesce(w.manager_employee_id_attribution,s.manager_employee_id) reporting_manager,'weekly' kind
 from scoped s left join lateral (select distinct on (wr.creator_profile_id,wr.week_start_date) wr.* from public.creator_weekly_revenue_records wr where wr.creator_profile_id=s.id and wr.week_start_date between greatest(p_start_date,s.revenue_period_month) and least(p_end_date,(s.revenue_period_month+interval '1 month - 1 day')::date) and wr.status in ('submitted','confirmed') order by wr.creator_profile_id,wr.week_start_date,wr.updated_at desc,wr.id desc) w on true
 where s.cycle='weekly' or s.cycle is null
 union all
 select s.*,mr.id,mr.revenue_amount,mr.revenue_unit,s.revenue_period_month,(s.revenue_period_month+interval '1 month - 1 day')::date,'submitted',mr.agent_note,mr.created_at,mr.updated_at,coalesce(mr.manager_employee_id_attribution,s.manager_employee_id),'monthly'
 from scoped s left join public.creator_monthly_revenue_records mr on mr.creator_profile_id=s.id and mr.revenue_month=s.revenue_period_month where s.cycle='monthly'
 union all
 select s.*,null::uuid,0::numeric,null::text,null::date,null::date,null::text,null::text,null::timestamptz,null::timestamptz,s.manager_employee_id,'none' from scoped s where s.cycle='none'
 ) select jsonb_build_object('id',record_id,'creator_profile_id',id,'creator_current_entity_id',creator_entity_id,'creator_joined_date',joined_date,'creator_platform',platform,'creator_platform_user_id',platform_user_id,'creator_platform_account',platform_account,'creator_region_id',region_id,'creator_name',creator_name,'creator_current_manager_employee_id',manager_employee_id,'creator_revenue_cycle',cycle,'cycle_source',case when public.creator_effective_revenue_cycle(id,revenue_period_month) is not null then 'VERIFIED' when cycle='weekly' then 'LEGACY_CURRENT_WEEKLY' else 'LEGACY_UNKNOWN' end,'creator_revenue_input_mode',revenue_input_mode,'creator_status',status,'creator_type',creator_type,'creator_created_at',created_at,'creator_updated_at',updated_at,'platform',platform,'revenue_amount',coalesce(amount,0),'revenue_unit',coalesce(unit,case when platform='tiktok' then 'diamond' else 'yinlang' end),'week_start_date',starts,'week_end_date',ends,'revenue_month',revenue_period_month,'record_kind',kind,'has_revenue_record',record_id is not null,'status',record_status,'agent_note',note,'created_at',record_created,'updated_at',record_updated,'region_code',region_code,'region_name',region_name,'reporting_manager_employee_id',reporting_manager,'reporting_manager_full_name',(select employee.full_name from public.employees employee where employee.id=reporting_manager),'reporting_manager_nickname',(select employee.nickname from public.employees employee where employee.id=reporting_manager))
 from rows where (p_manager_employee_id is null or reporting_manager=p_manager_employee_id) and (p_revenue_cycle is null or cycle=p_revenue_cycle)
 and (p_status is null or (p_status='pending' and record_status='submitted') or (p_status='confirmed' and record_status='confirmed')) order by revenue_period_month,id,starts nulls first,record_id nulls first limit p_limit offset p_offset;
end; $$;
revoke all on function public.list_agent_revenue_profiles_e(integer,integer),public.list_management_revenue_records_e(date,date,uuid,text,text,uuid,text,integer,integer,text) from public,anon;
grant execute on function public.list_agent_revenue_profiles_e(integer,integer),public.list_management_revenue_records_e(date,date,uuid,text,text,uuid,text,integer,integer,text) to authenticated;

commit;
