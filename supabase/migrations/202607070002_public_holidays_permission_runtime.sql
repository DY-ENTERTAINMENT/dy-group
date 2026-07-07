begin;

create or replace function public.current_user_can_manage_public_holidays()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.current_user_has_permission('public-holidays', 'use')
$$;

commit;
