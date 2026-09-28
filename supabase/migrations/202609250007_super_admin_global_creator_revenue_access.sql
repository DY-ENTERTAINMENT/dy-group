begin;

-- Super Admin is the real profiles.role identity. Keep the personal-manager
-- path intact for every non-Super-Admin account.
create or replace function public.list_personal_manager_weekly_revenue_profiles()
returns table (id uuid,creator_entity_id uuid,joined_date date,platform public.creator_platform,platform_user_id text,platform_account text,platform_public_id text,region_id uuid,region_code text,region_name text,creator_name text,scout_employee_id uuid,scout_profile_id uuid,scout_full_name text,scout_nickname text,manager_employee_id uuid,manager_full_name text,manager_nickname text,secondary_manager_employee_id uuid,secondary_manager_display_name text,creator_type public.creator_type,status text,membership_status text,is_priority boolean,revenue_cycle text,revenue_input_mode text,pending_revenue_input_mode text,revenue_input_mode_effective_date date,effective_revenue_input_mode text,bank_account_name text,bank_name text,bank_account text,created_at timestamptz,updated_at timestamptz)
language sql stable security definer set search_path=public,pg_temp as $$
 select c.id,c.creator_entity_id,c.joined_date,c.platform,c.platform_user_id,c.platform_account,c.platform_public_id,c.region_id,r.code,r.name,c.creator_name,c.scout_employee_id,c.scout_profile_id,s.full_name,s.nickname,c.manager_employee_id,m.full_name,m.nickname,sm.employee_id,sm.display_name,c.creator_type,c.status,c.membership_status,e.is_priority,coalesce(c.revenue_cycle,'weekly'),coalesce(c.revenue_input_mode,'direct'),c.pending_revenue_input_mode,c.revenue_input_mode_effective_date,public.creator_effective_revenue_input_mode(c,public.current_malaysia_business_date()),case when c.manager_employee_id=public.current_user_employee_id() then c.bank_account_name else null end,case when c.manager_employee_id=public.current_user_employee_id() then c.bank_name else null end,case when c.manager_employee_id=public.current_user_employee_id() then c.bank_account else null end,c.created_at,c.updated_at
 from public.creator_profiles c join public.creator_entities e on e.id=c.creator_entity_id and e.status='active' left join public.regions r on r.id=c.region_id left join public.employees s on s.id=c.scout_employee_id left join public.employees m on m.id=c.manager_employee_id left join lateral (select a.employee_id,coalesce(nullif(btrim(x.nickname),''),x.full_name) display_name from public.creator_collaborator_assignments a join public.employees x on x.id=a.employee_id where a.creator_entity_id=c.creator_entity_id and a.assignment_type='manager' and a.assignment_role='secondary' and a.status='active' limit 1) sm on true
 where auth.uid() is not null and public.current_user_has_permission('agent-revenue-data','use') and public.current_user_can_access_region(c.region_id) and c.status='active' and c.membership_status='active' and (public.current_user_is_super_admin() or c.manager_employee_id=public.current_user_employee_id()) order by c.joined_date desc,c.id;
$$;

-- Preserve every direct-flow guard except the primary-manager requirement for
-- the actual Super Admin identity.
create or replace function public.save_direct_creator_weekly_revenue(p_creator_profile_id uuid,p_data_date date,p_revenue_amount numeric,p_agent_note text,p_idempotency_key uuid)
returns public.creator_weekly_revenue_records language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.creator_profiles; r public.creator_weekly_revenue_direct_save_requests; w public.creator_weekly_revenue_records; v_start date; v_end date;
begin
 if auth.uid() is null or p_creator_profile_id is null or p_data_date is null or p_idempotency_key is null or p_revenue_amount is null or p_revenue_amount<0 then raise exception 'Valid creator, date, idempotency key, and non-negative revenue are required.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_creator_profile_id::text,0)); select * into c from public.apply_due_creator_revenue_input_mode(p_creator_profile_id,p_data_date);
 if c.id is null or c.status<>'active' or c.membership_status<>'active' or c.revenue_cycle<>'weekly' or c.revenue_input_mode<>'direct' then raise exception 'Direct weekly revenue is only available for active weekly direct creator profiles.'; end if;
 if not exists(select 1 from public.creator_entities e where e.id=c.creator_entity_id and e.status='active') then raise exception 'Creator entity is not active for current revenue actions.'; end if;
 if not public.current_user_has_permission('agent-revenue-data','use') or (not public.current_user_is_super_admin() and c.manager_employee_id is distinct from public.current_user_employee_id()) or not public.current_user_can_access_region(c.region_id) then raise exception 'No permission to save direct weekly revenue for this creator.'; end if;
 select * into r from public.creator_weekly_revenue_direct_save_requests where creator_profile_id=c.id and idempotency_key=p_idempotency_key; if r.id is not null then select * into w from public.creator_weekly_revenue_records where id=r.weekly_revenue_record_id; return w; end if;
 v_start:=public.creator_weekly_revenue_period_start(p_data_date); v_end:=public.creator_weekly_revenue_period_end(v_start); select * into w from public.creator_weekly_revenue_records where creator_profile_id=c.id and week_start_date=v_start for update;
 if w.id is not null and public.creator_weekly_revenue_is_cumulative(w) then raise exception 'This period already has cumulative revenue and cannot be overwritten by direct input.'; end if;
 if w.id is null then insert into public.creator_weekly_revenue_records(creator_profile_id,week_start_date,week_end_date,revenue_amount,agent_note,status,source,is_cumulative_generated,revenue_entry_kind) values(c.id,v_start,v_end,p_revenue_amount,nullif(btrim(coalesce(p_agent_note,'')),''),'submitted','manual',false,'direct') returning * into w; else update public.creator_weekly_revenue_records set revenue_amount=p_revenue_amount,agent_note=nullif(btrim(coalesce(p_agent_note,'')),''),status='submitted' where id=w.id returning * into w; end if;
 insert into public.creator_weekly_revenue_direct_save_requests(creator_profile_id,requested_by_profile_id,idempotency_key,weekly_revenue_record_id) values(c.id,auth.uid(),p_idempotency_key,w.id); return w;
end; $$;

revoke all on function public.list_personal_manager_weekly_revenue_profiles() from public,anon;
grant execute on function public.list_personal_manager_weekly_revenue_profiles() to authenticated;
revoke all on function public.save_direct_creator_weekly_revenue(uuid,date,numeric,text,uuid) from public,anon;
grant execute on function public.save_direct_creator_weekly_revenue(uuid,date,numeric,text,uuid) to authenticated;

commit;
