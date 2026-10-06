begin;

-- Employee-facing reads must never inherit the broader region-scoped
-- management policy. These RPCs deliberately bind every row to auth.uid().
create or replace function public.list_my_outgoing_requests()
returns setof public.outgoing_requests
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.*
  from public.outgoing_requests r
  where r.profile_id = auth.uid()
    and public.current_user_is_active_employee()
    and public.current_user_has_permission('outgoing-application', 'view')
  order by r.outgoing_date desc, r.planned_start_time desc
$$;

create or replace function public.list_my_outgoing_request_review_history(p_request_id uuid)
returns setof public.outgoing_request_review_history
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select h.*
  from public.outgoing_request_review_history h
  join public.outgoing_requests r on r.id = h.request_id
  where h.request_id = p_request_id
    and r.profile_id = auth.uid()
    and public.current_user_is_active_employee()
    and public.current_user_has_permission('outgoing-application', 'view')
  order by h.created_at asc
$$;

revoke all on function public.list_my_outgoing_requests() from public, anon;
revoke all on function public.list_my_outgoing_request_review_history(uuid) from public, anon;
grant execute on function public.list_my_outgoing_requests() to authenticated;
grant execute on function public.list_my_outgoing_request_review_history(uuid) to authenticated;

commit;
