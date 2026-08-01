begin;

alter table public.leave_requests
drop constraint if exists leave_requests_date_range_check;

alter table public.leave_requests
add constraint leave_requests_date_range_check
check (
  leave_type = 'replacement'
  or end_date >= start_date
);

commit;
