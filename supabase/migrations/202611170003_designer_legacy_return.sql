-- Conservative cutoff precedes the recorded 202611170002 execution on 2026-11-17 afternoon MYT.
-- The existing new-task RPC and safety helper remain unchanged.
begin;
create function public.designer_legacy_return_safe(p_request_id uuid) returns boolean language sql security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.designer_requests r where r.id=p_request_id and r.deleted_at is null
  and r.status='unclaimed' and r.designer_profile_id is null and r.designer_employee_id is null
  and r.accepted_at is null and r.completed_at is null and coalesce(cardinality(r.design_urls),0)=0
  and nullif(btrim(coalesce(r.revision_note,'')),'') is null)
 and not exists(select 1 from public.designer_deletion_approvals a where a.request_id=p_request_id and a.status='pending')
 and not exists(select 1 from public.designer_reference_operations o where o.request_id=p_request_id and o.completed_at is null)
 and not exists(select 1 from public.designer_request_stages s where s.request_id=p_request_id and
   (s.submitted_at is not null or s.confirmed_at is not null or s.confirmed_by_profile_id is not null or s.confirmed_by_employee_id is not null
    or s.feedback_count<>0 or nullif(btrim(coalesce(s.feedback,'')),'') is not null
    or (s.assignee_profile_id is null and (s.assignee_employee_id is not null or s.accepted_at is not null or s.status not in ('unclaimed','scheduled')))
    or (s.assignee_profile_id is not null and (s.claim_pending_start or not (s.stage_type in ('design','production') and s.status='in_progress') or s.accepted_at is null))))
 and not exists(select 1 from public.designer_stage_deliverables d where d.request_id=p_request_id)
 and not exists(select 1 from public.designer_stage_deliverable_submissions d where d.request_id=p_request_id)
 and not exists(select 1 from public.designer_stage_deliverable_upload_sessions d where d.request_id=p_request_id)
 and not exists(select 1 from public.designer_review_stage_state d where d.request_id=p_request_id and (d.draft_revision<>0 or d.pending_submission_id is not null or d.final_submission_id is not null))
 and not exists(select 1 from public.designer_review_events e join public.designer_request_stages s on s.id=e.stage_id where s.request_id=p_request_id)
 and not exists(select 1 from public.designer_review_removed_inventory d where d.request_id=p_request_id)
 and not exists(select 1 from public.designer_review_current_assets d join public.designer_request_stages s on s.id=d.stage_id where s.request_id=p_request_id)
 and not exists(select 1 from public.designer_review_submission_assets d join public.designer_request_stages s on s.id=d.stage_id where s.request_id=p_request_id)
 and not exists(select 1 from public.designer_review_upload_bindings d join public.designer_request_stages s on s.id=d.stage_id where s.request_id=p_request_id)
 and not exists(select 1 from public.designer_review_activation_events d where d.request_id=p_request_id)
 and not exists(select 1 from public.designer_legacy_return_feedback e join public.designer_request_stages s on s.id=e.stage_id where s.request_id=p_request_id);
$$;
revoke all on function public.designer_legacy_return_safe(uuid) from public,anon,authenticated;


-- Strictly before the independently verified conservative pre-migration cutoff.
create function public.designer_legacy_claim_cutoff() returns timestamptz language sql immutable set search_path=public,pg_temp as $$ select '2026-11-17 00:00:00+08:00'::timestamptz $$;
revoke all on function public.designer_legacy_claim_cutoff() from public,anon,authenticated;
create function public.can_return_legacy_designer_request(p_request_id uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select auth.uid() is not null and coalesce(public.current_user_has_permission('designer-intake','use'),false)
 and public.designer_legacy_claim_cutoff() is not null
 and coalesce(public.designer_legacy_return_safe(p_request_id),false)
 and not exists(select 1 from public.designer_request_returns x where x.request_id=p_request_id)
 and (select count(*) from public.designer_request_stages s where s.request_id=p_request_id and s.assignee_profile_id is not null)=1
 and exists(select 1 from public.designer_request_stages s where s.request_id=p_request_id and s.assignee_profile_id=auth.uid() and not s.claim_pending_start and (s.stage_type in ('design','production') and s.status='in_progress') and s.accepted_at < public.designer_legacy_claim_cutoff());
$$;
revoke all on function public.can_return_legacy_designer_request(uuid) from public,anon;
grant execute on function public.can_return_legacy_designer_request(uuid) to authenticated;

create function public.return_legacy_designer_request_to_agent(p_request_id uuid,p_reason text,p_confirmed_not_started boolean) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.designer_requests; snapshot jsonb; legacy_cutoff timestamptz := public.designer_legacy_claim_cutoff();
begin
 if auth.uid() is null or not coalesce(public.current_user_has_permission('designer-intake','use'),false) or length(btrim(coalesce(p_reason,''))) not between 1 and 2000 or p_confirmed_not_started is distinct from true then raise exception '须填写退回原因并确认尚未实际开始'; end if;
 if legacy_cutoff is null then raise exception '旧任务退回尚未启用'; end if;
 select * into r from public.designer_requests where id=p_request_id for update;
 if not coalesce(public.designer_legacy_return_safe(r.id),false) or exists(select 1 from public.designer_request_returns x where x.request_id=r.id) or (select count(*) from public.designer_request_stages s where s.request_id=r.id and s.assignee_profile_id is not null)<>1 or not exists(select 1 from public.designer_request_stages s where s.request_id=r.id and s.assignee_profile_id=auth.uid() and not s.claim_pending_start and (s.stage_type in ('design','production') and s.status='in_progress') and s.accepted_at < legacy_cutoff) then raise exception '申请不符合旧任务退回条件'; end if;
 select jsonb_agg(jsonb_build_object('stage_id',id,'assignee_profile_id',assignee_profile_id,'assignee_employee_id',assignee_employee_id,'accepted_at',accepted_at,'status',status,'legacy_confirmed_not_started',true) order by id) into snapshot from public.designer_request_stages where request_id=r.id;
 update public.designer_request_stages set status='unclaimed',assignee_profile_id=null,assignee_employee_id=null,accepted_at=null,claim_pending_start=false where request_id=r.id and assignee_profile_id=auth.uid();
 insert into public.designer_request_returns(request_id,returned_by,reason,stage_snapshot) values(r.id,auth.uid(),btrim(p_reason),coalesce(snapshot,'[]'::jsonb));
end $$;
revoke all on function public.return_legacy_designer_request_to_agent(uuid,text,boolean) from public,anon;
grant execute on function public.return_legacy_designer_request_to_agent(uuid,text,boolean) to authenticated;
commit;
