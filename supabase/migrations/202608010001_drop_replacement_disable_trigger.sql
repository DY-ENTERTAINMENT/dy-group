begin;

drop trigger if exists trg_prevent_new_replacement_leave_requests on public.leave_requests;

commit;
