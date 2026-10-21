-- Additive history API: preserves the deployed v1 RPC while returning the
-- attachment reference only to reviewers already authorised for the employee's region.
begin;

create function public.list_leave_review_history_v2(
  p_year integer, p_month integer, p_leave_type text default null, p_region_id uuid default null,
  p_status text default null, p_search text default null, p_page integer default 1, p_page_size integer default 25
) returns table (
  id uuid, employee_name text, employee_code text, region_id uuid, region_code text, leave_type text,
  start_date date, end_date date, reason text, status text, reviewer_name text, reviewed_at timestamptz,
  created_at timestamptz, has_medical_attachment boolean, medical_attachment_path text, total_count bigint
) language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_start timestamptz; v_end timestamptz; v_offset integer;
begin
  if auth.uid() is null or not public.current_user_can_review_leave_requests() then raise exception 'No permission to view leave review history.' using errcode = '42501'; end if;
  if p_year not between 2000 and 2100 or p_month not between 1 and 12 then raise exception 'Invalid year or month.' using errcode = '22023'; end if;
  if p_page < 1 or p_page_size < 1 or p_page_size > 100 then raise exception 'Invalid pagination.' using errcode = '22023'; end if;
  if p_leave_type is not null and p_leave_type not in ('annual','medical','unpaid','replacement') then raise exception 'Invalid leave type.' using errcode = '22023'; end if;
  if p_status is not null and p_status not in ('approved','rejected') then raise exception 'Invalid review status.' using errcode = '22023'; end if;
  if p_region_id is not null and not public.current_user_can_access_region(p_region_id) then raise exception 'No permission to view this region.' using errcode = '42501'; end if;
  v_start := make_timestamptz(p_year, p_month, 1, 0, 0, 0, 'Asia/Kuala_Lumpur');
  v_end := v_start + interval '1 month'; v_offset := (p_page - 1) * p_page_size;
  return query
  select lr.id, coalesce(nullif(e.nickname,''),e.full_name), e.employee_code, e.region_id, r.code, lr.leave_type::text,
    lr.start_date, lr.end_date, lr.reason, lr.status::text,
    coalesce(nullif(reviewer_employee.nickname,''), reviewer_employee.full_name, reviewer_profile.full_name), lr.reviewed_at,
    lr.created_at, lr.leave_type = 'medical' and lr.medical_attachment_url is not null,
    case when lr.leave_type = 'medical' then lr.medical_attachment_url else null end,
    count(*) over()
  from public.leave_requests lr
  join public.employees e on e.id = lr.employee_id and e.deleted_at is null
  left join public.regions r on r.id = e.region_id
  left join public.profiles reviewer_profile on reviewer_profile.id = lr.reviewed_by
  left join public.employees reviewer_employee on reviewer_employee.profile_id = lr.reviewed_by and reviewer_employee.deleted_at is null
  where lr.status in ('approved','rejected') and lr.created_at >= v_start and lr.created_at < v_end
    and public.current_user_can_access_region(e.region_id)
    and (p_region_id is null or e.region_id = p_region_id)
    and (p_leave_type is null or lr.leave_type::text = p_leave_type)
    and (p_status is null or lr.status::text = p_status)
    and (nullif(btrim(p_search),'') is null or coalesce(e.full_name,'') ilike '%' || btrim(p_search) || '%' or coalesce(e.employee_code,'') ilike '%' || btrim(p_search) || '%')
  order by lr.created_at desc, lr.id desc limit p_page_size offset v_offset;
end;
$$;

revoke all on function public.list_leave_review_history_v2(integer,integer,text,uuid,text,text,integer,integer) from public, anon;
grant execute on function public.list_leave_review_history_v2(integer,integer,text,uuid,text,text,integer,integer) to authenticated;
commit;
