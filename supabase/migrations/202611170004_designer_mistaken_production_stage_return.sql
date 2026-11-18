-- REVIEW CANDIDATE ONLY: stage-level production mistake return. Do not run in Production without review.
begin;
create table public.designer_stage_mistake_returns (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references public.designer_requests(id),
 stage_id uuid not null references public.designer_request_stages(id),
 returned_by uuid not null references public.profiles(id),
 assignee_employee_id uuid references public.employees(id),
 accepted_at timestamptz not null,
 previous_status public.designer_stage_status not null,
 reason text not null check (length(btrim(reason)) between 1 and 2000),
 returned_at timestamptz not null default now()
);
alter table public.designer_stage_mistake_returns enable row level security;
revoke all on public.designer_stage_mistake_returns from public, anon, authenticated;
grant select on public.designer_stage_mistake_returns to authenticated;
create policy designer_stage_mistake_return_agent_read on public.designer_stage_mistake_returns for select to authenticated
 using (exists(select 1 from public.designer_requests r where r.id=request_id and r.agent_profile_id=auth.uid() and public.current_user_has_permission('agent-design-requests','view')) or public.current_user_is_super_admin());

-- Eligibility only considers this stage; previous design-stage evidence is retained.
create function public.designer_mistaken_production_stage_safe(p_stage_id uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.designer_request_stages s join public.designer_requests r on r.id=s.request_id
 where s.id=p_stage_id and r.deleted_at is null and r.status not in ('completed','cancelled')
 and coalesce(public.current_user_can_access_region(r.region_id),false)
 and s.stage_type='production' and ((s.status='in_progress' and not s.claim_pending_start) or (s.status='scheduled' and s.claim_pending_start))
 and s.assignee_profile_id=auth.uid() and s.assignee_employee_id is not null and s.accepted_at is not null
 and exists(select 1 from public.employees e where e.id=s.assignee_employee_id and e.profile_id=auth.uid() and e.deleted_at is null and e.status in ('active','probation'))
 and s.submitted_at is null and s.confirmed_at is null and s.confirmed_by_profile_id is null and s.confirmed_by_employee_id is null
 and s.feedback_count=0 and nullif(btrim(coalesce(s.feedback,'')),'') is null
 and not exists(select 1 from public.designer_deletion_approvals a where a.request_id=r.id and a.status='pending')
 and not exists(select 1 from public.designer_request_returns x where x.request_id=r.id and x.resubmitted_at is null))
 and not exists(select 1 from public.designer_stage_deliverables x where x.stage_id=p_stage_id)
 and not exists(select 1 from public.designer_stage_deliverable_submissions x where x.stage_id=p_stage_id)
 and not exists(select 1 from public.designer_stage_deliverable_upload_sessions x where x.stage_id=p_stage_id)
 and not exists(select 1 from public.designer_review_stage_state x where x.stage_id=p_stage_id and (x.draft_revision<>0 or x.pending_submission_id is not null or x.final_submission_id is not null))
 and not exists(select 1 from public.designer_review_events x where x.stage_id=p_stage_id)
 and not exists(select 1 from public.designer_review_current_assets x where x.stage_id=p_stage_id)
 and not exists(select 1 from public.designer_review_submission_assets x where x.stage_id=p_stage_id)
 and not exists(select 1 from public.designer_review_upload_bindings x where x.stage_id=p_stage_id)
 and not exists(select 1 from public.designer_review_activation_events x where x.stage_id=p_stage_id)
 and not exists(select 1 from public.designer_legacy_return_feedback x where x.stage_id=p_stage_id);
$$;
revoke all on function public.designer_mistaken_production_stage_safe(uuid) from public,anon,authenticated;
create function public.can_return_mistaken_production_stage(p_stage_id uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select auth.uid() is not null and coalesce(public.current_user_is_active_employee(),false) and coalesce(public.current_user_has_permission('designer-intake','use'),false)
 and coalesce(public.designer_mistaken_production_stage_safe(p_stage_id),false);
$$;
create function public.return_mistaken_production_stage(p_stage_id uuid,p_reason text,p_confirmed_not_started boolean) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.designer_request_stages; r public.designer_requests;
begin
 if auth.uid() is null or not coalesce(public.current_user_is_active_employee(),false) or not coalesce(public.current_user_has_permission('designer-intake','use'),false)
 or length(btrim(coalesce(p_reason,''))) not between 1 and 2000 or p_confirmed_not_started is distinct from true then raise exception '须填写退回原因并确认尚未开始制作'; end if;
 select * into s from public.designer_request_stages where id=p_stage_id;
 select * into r from public.designer_requests where id=s.request_id for update;
 select * into s from public.designer_request_stages where id=p_stage_id for update;
 if r.id is null or s.request_id is distinct from r.id or not coalesce(public.designer_mistaken_production_stage_safe(s.id),false) then raise exception '当前制作阶段不符合误接单退回条件'; end if;
 insert into public.designer_stage_mistake_returns(request_id,stage_id,returned_by,assignee_employee_id,accepted_at,previous_status,reason)
 values(r.id,s.id,auth.uid(),s.assignee_employee_id,s.accepted_at,s.status,btrim(p_reason));
 update public.designer_request_stages set status='unclaimed',assignee_profile_id=null,assignee_employee_id=null,accepted_at=null,claim_pending_start=false where id=s.id;
end $$;
revoke all on function public.can_return_mistaken_production_stage(uuid),public.return_mistaken_production_stage(uuid,text,boolean) from public,anon;
grant execute on function public.can_return_mistaken_production_stage(uuid),public.return_mistaken_production_stage(uuid,text,boolean) to authenticated;

-- Scope additional intake access to an actual returned production stage only.
-- Keep the existing view permission and legacy region rule for available work.
create function public.can_access_mistaken_production_request(p_request_id uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select auth.uid() is not null and coalesce(public.current_user_is_active_employee(),false) and exists (
  select 1 from public.designer_requests r join public.designer_request_stages s on s.request_id=r.id
  where r.id=p_request_id and r.deleted_at is null and r.status not in ('completed','cancelled')
  and coalesce(public.current_user_can_access_region(r.region_id),false)
  and s.stage_type='production' and exists(select 1 from public.designer_stage_mistake_returns x where x.stage_id=s.id and x.request_id=r.id)
  and not exists(select 1 from public.designer_request_returns x where x.request_id=r.id and x.resubmitted_at is null)
  and not exists(select 1 from public.designer_deletion_approvals a where a.request_id=r.id and a.status='pending')
  and (s.assignee_profile_id=auth.uid() or (s.status='unclaimed' and s.assignee_profile_id is null and public.current_user_has_permission('designer-intake','view') and (s.request_item_id is null or public.current_user_has_permission('designer-production-eligible','use'))
       and (r.work_mode is null or (r.region_id is not null and public.current_user_can_access_region(r.region_id)))))
 );
$$;
revoke all on function public.can_access_mistaken_production_request(uuid) from public,anon;
grant execute on function public.can_access_mistaken_production_request(uuid) to authenticated;
create or replace function public.can_access_designer_request(p_request_id uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.designer_requests r where r.id=p_request_id and r.deleted_at is null and
 (r.agent_profile_id=auth.uid() or exists(select 1 from public.designer_request_stages s where s.request_id=r.id and s.assignee_profile_id=auth.uid()) or
 (not exists(select 1 from public.designer_request_returns x where x.request_id=r.id and x.resubmitted_at is null) and r.status='unclaimed' and public.current_user_has_permission('designer-intake','view') and (r.work_mode is null or (r.region_id is not null and public.current_user_can_access_region(r.region_id))))))
 or public.can_access_mistaken_production_request(p_request_id);
$$;
-- Do not let request-level visibility authorize other unclaimed stages.
create or replace function public.claim_designer_request_stage(p_stage_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.designer_request_stages; r public.designer_requests; eid uuid; base_access boolean;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select * into s from public.designer_request_stages where id=p_stage_id;
 select * into r from public.designer_requests where id=s.request_id for update;
 select * into s from public.designer_request_stages where id=p_stage_id for update;
 if exists(select 1 from public.designer_deletion_approvals where request_id=r.id and status='pending') then raise exception '存在待处理的旧删除审批，申请暂时锁定'; end if;
 base_access := r.agent_profile_id=auth.uid() or exists(select 1 from public.designer_request_stages x where x.request_id=r.id and x.assignee_profile_id=auth.uid())
  or (r.status='unclaimed' and public.current_user_has_permission('designer-intake','view') and (r.work_mode is null or (r.region_id is not null and public.current_user_can_access_region(r.region_id))));
 if r.id is null or r.deleted_at is not null or r.status in ('completed','cancelled') or s.status<>'unclaimed'
 or exists(select 1 from public.designer_request_returns x where x.request_id=r.id and x.resubmitted_at is null)
 or not coalesce(public.current_user_has_permission('designer-intake','use'),false)
 or not coalesce(base_access or (s.stage_type='production' and s.assignee_profile_id is null and exists(select 1 from public.designer_stage_mistake_returns x where x.stage_id=s.id and x.request_id=r.id) and public.can_access_mistaken_production_request(r.id)),false)
 then raise exception 'Stage unavailable'; end if;
 select id into eid from public.employees where profile_id=auth.uid() and deleted_at is null limit 1;
 if eid is null then raise exception 'Active employee required'; end if;
 update public.designer_request_stages set status='scheduled',claim_pending_start=(s.stage_type in ('design','production')),assignee_profile_id=auth.uid(),assignee_employee_id=eid,accepted_at=now() where id=s.id;
end $$;

create policy designer_mistaken_production_request_read on public.designer_requests for select to authenticated
 using (public.can_access_mistaken_production_request(id));

-- Request visibility must not reveal unrelated stages through the existing stage policy.
create function public.can_read_mistaken_production_stage_scope(p_stage_id uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.designer_request_stages s join public.designer_requests r on r.id=s.request_id
 where s.id=p_stage_id and r.deleted_at is null and
 (r.agent_profile_id=auth.uid() or exists(select 1 from public.designer_request_stages own where own.request_id=r.id and own.assignee_profile_id=auth.uid())
 or (r.status='unclaimed' and not public.designer_request_is_returned(r.id) and public.current_user_has_permission('designer-intake','view') and (r.work_mode is null or (r.region_id is not null and public.current_user_can_access_region(r.region_id))))
 or (s.stage_type='production' and exists(select 1 from public.designer_stage_mistake_returns x where x.stage_id=s.id and x.request_id=r.id) and public.can_access_mistaken_production_request(r.id))));
$$;
revoke all on function public.can_read_mistaken_production_stage_scope(uuid) from public,anon;
grant execute on function public.can_read_mistaken_production_stage_scope(uuid) to authenticated;
create policy designer_mistaken_production_stage_scope on public.designer_request_stages as restrictive for select to authenticated
 using (public.can_read_mistaken_production_stage_scope(id));

-- Serialize result mutations with the parent lock, then recheck the current owner.
-- Existing history on other stages remains governed by existing policies.
create function public.guard_mistaken_production_stage_result() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare sid uuid; rid uuid; s public.designer_request_stages;
begin
 if tg_op='DELETE' then sid:=old.stage_id; else sid:=new.stage_id; end if;
 if tg_op='UPDATE' and new.stage_id is distinct from old.stage_id then raise exception 'Cannot move result between stages'; end if;
 select request_id into rid from public.designer_request_stages where id=sid;
 perform 1 from public.designer_requests where id=rid for update;
 select * into s from public.designer_request_stages where id=sid;
 if s.id is null or s.request_id is distinct from rid then raise exception 'Stage unavailable'; end if;
 if s.stage_type='production' and exists(select 1 from public.designer_stage_mistake_returns x where x.stage_id=s.id)
 and (s.status='unclaimed' or (s.status in ('scheduled','in_progress') and s.assignee_profile_id is distinct from auth.uid())) then
  raise exception '制作阶段已退回或负责人已变更';
 end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
revoke all on function public.guard_mistaken_production_stage_result() from public,anon,authenticated;
do $$ declare t text; begin
 foreach t in array array['designer_stage_deliverables','designer_stage_deliverable_submissions','designer_stage_deliverable_upload_sessions',
 'designer_review_stage_state','designer_review_current_assets','designer_review_submission_assets','designer_review_upload_bindings',
 'designer_review_events','designer_review_activation_events','designer_legacy_return_feedback'] loop
 execute format('create trigger designer_mistaken_production_result_guard before insert or update or delete on public.%I for each row execute function public.guard_mistaken_production_stage_result()',t);
 end loop;
end $$;

commit;
