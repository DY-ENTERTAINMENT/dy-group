-- Existing profiles predate creator_revenue_cycle_history.  Their first
-- operator-authorized cycle change establishes only the current-month
-- effective history; it must not require a fabricated historical baseline.
begin;

create or replace function public.track_creator_revenue_cycle()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_month date; v_old text;
begin
 if tg_op='INSERT' then
   v_month:=greatest(date_trunc('month',public.current_malaysia_business_date())::date,date_trunc('month',new.joined_date)::date);
   insert into public.creator_revenue_cycle_history(creator_profile_id,effective_month,revenue_cycle,source,created_by)
     values(new.id,v_month,new.revenue_cycle,'creation',auth.uid());
   insert into public.creator_revenue_cycle_audit(creator_profile_id,effective_month,new_cycle,action,actor_id) values(new.id,v_month,new.revenue_cycle,'creation',auth.uid());
 elsif new.revenue_cycle is distinct from old.revenue_cycle then
   if auth.uid() is null or not public.current_user_has_explicit_permission('agent-creator-revenue-settings','use') or not public.current_user_can_manage_creator_entity(new.creator_entity_id) or not public.current_user_can_access_region(new.region_id) then raise exception 'CYCLE_PERMISSION_DENIED' using errcode='42501'; end if;
   -- The UPDATE already holds the profile row lock; avoid inverse lock order.
   -- A legacy profile without history gets its first current-month immediate
   -- record below.  No prior month is inferred or backfilled.
   v_month:=date_trunc('month',public.current_malaysia_business_date())::date;
   v_old:=public.creator_effective_revenue_cycle(new.id,v_month);
   insert into public.creator_revenue_cycle_history(creator_profile_id,effective_month,revenue_cycle,source,created_by) values(new.id,v_month,new.revenue_cycle,'immediate',auth.uid())
     on conflict(creator_profile_id,effective_month) do update set revenue_cycle=excluded.revenue_cycle,source='immediate',created_by=excluded.created_by,created_at=now();
   insert into public.creator_revenue_cycle_audit(creator_profile_id,effective_month,old_cycle,new_cycle,action,actor_id)
     values(new.id,v_month,v_old,new.revenue_cycle,'immediate_change',auth.uid());
 end if;
 return new;
end; $$;

commit;
