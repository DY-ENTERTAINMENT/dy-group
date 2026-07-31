begin;

create or replace function public.current_user_can_review_leave_requests()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    public.current_user_has_permission('leave-review', 'use')
    or exists (
      select 1
      from public.profiles
      where id = auth.uid()
        and role in ('super_admin', 'admin', 'hr')
        and status = 'approved'
    );
$$;

commit;
