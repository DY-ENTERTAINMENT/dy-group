begin;

create or replace function public.current_user_can_access_region(region_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
select exists (
select 1 from public.current_user_authorized_region_ids() r
where r = region_id
);
$function$;

comment on function public.current_user_can_access_region(uuid) is
'Versioned copy of the existing production region-access helper. Returns true when the current user may access the given region_id via current_user_authorized_region_ids().';

commit;
