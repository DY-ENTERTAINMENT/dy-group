begin;

create table if not exists public.attendance_locations (
  id uuid primary key default gen_random_uuid(),
  region_id uuid not null references public.regions(id) on delete cascade,
  name text not null,
  latitude numeric(10, 7) not null,
  longitude numeric(10, 7) not null,
  radius_meters integer not null default 200,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_locations_name_check check (length(trim(name)) > 0),
  constraint attendance_locations_radius_check check (radius_meters > 0)
);

create index if not exists attendance_locations_region_id_idx on public.attendance_locations(region_id);
create index if not exists attendance_locations_active_idx on public.attendance_locations(is_active) where is_active = true;

drop trigger if exists trg_attendance_locations_updated_at on public.attendance_locations;
create trigger trg_attendance_locations_updated_at
before update on public.attendance_locations
for each row
execute function public.set_updated_at();

alter table public.attendance_records
  add column if not exists attendance_location_id uuid references public.attendance_locations(id) on delete set null,
  add column if not exists distance_meters numeric(10, 2),
  add column if not exists location_check_result text;

create index if not exists attendance_records_location_id_idx on public.attendance_records(attendance_location_id);

insert into public.permission_items (permission_key, parent_key, name, sort_order, is_reserved)
values ('attendance-locations', 'hr', '打卡地点', 46, false)
on conflict (permission_key) do update
set
  parent_key = excluded.parent_key,
  name = excluded.name,
  sort_order = excluded.sort_order,
  is_reserved = excluded.is_reserved,
  is_active = true,
  updated_at = now();

create or replace function public.calculate_distance_meters(
  lat1 numeric,
  lon1 numeric,
  lat2 numeric,
  lon2 numeric
)
returns numeric
language sql
immutable
as $$
  select (
    6371000 * 2 * asin(
      least(
        1::double precision,
        sqrt(
          power(sin(radians((lat2 - lat1)::double precision) / 2), 2)
          + cos(radians(lat1::double precision))
          * cos(radians(lat2::double precision))
          * power(sin(radians((lon2 - lon1)::double precision) / 2), 2)
        )
      )
    )
  )::numeric
$$;

create or replace function public.create_attendance_record_checked(
  p_punch_type public.attendance_punch_type,
  p_photo_path text,
  p_latitude numeric,
  p_longitude numeric,
  p_accuracy numeric,
  p_ip_address text,
  p_device_info text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_employee public.employees;
  nearest_location public.attendance_locations;
  nearest_distance numeric;
  created_record_id uuid;
begin
  if auth.uid() is null then
    raise exception '无法确认当前用户。';
  end if;

  if p_latitude is null or p_longitude is null then
    raise exception '请允许浏览器定位权限，否则无法打卡。';
  end if;

  select e.*
  into current_employee
  from public.employees e
  where e.profile_id = auth.uid()
    and e.deleted_at is null
  order by e.created_at asc
  limit 1;

  if current_employee.id is null then
    raise exception '当前账号尚未关联工作人员，请联系 HR。';
  end if;

  if current_employee.region_id is null then
    raise exception '当前员工尚未设置区域，请联系 HR。';
  end if;

  select al.*
  into nearest_location
  from public.attendance_locations al
  where al.region_id = current_employee.region_id
    and al.is_active = true
  order by public.calculate_distance_meters(p_latitude, p_longitude, al.latitude, al.longitude) asc
  limit 1;

  if nearest_location.id is null then
    raise exception '当前区域尚未设置打卡地点，请联系 HR。';
  end if;

  nearest_distance := public.calculate_distance_meters(
    p_latitude,
    p_longitude,
    nearest_location.latitude,
    nearest_location.longitude
  );

  if nearest_distance > nearest_location.radius_meters then
    raise exception '您目前不在指定打卡地点范围内，无法打卡。';
  end if;

  insert into public.attendance_records (
    profile_id,
    employee_id,
    punch_type,
    photo_path,
    latitude,
    longitude,
    accuracy,
    ip_address,
    device_info,
    attendance_location_id,
    distance_meters,
    location_check_result
  )
  values (
    auth.uid(),
    current_employee.id,
    p_punch_type,
    p_photo_path,
    p_latitude,
    p_longitude,
    p_accuracy,
    p_ip_address,
    p_device_info,
    nearest_location.id,
    round(nearest_distance, 2),
    'allowed'
  )
  returning id into created_record_id;

  return created_record_id;
end;
$$;

drop policy if exists "Employees can create own attendance records" on public.attendance_records;
create policy "Employees can create own attendance records"
on public.attendance_records
for insert
to authenticated
with check (
  auth.uid() = profile_id
  and location_check_result = 'allowed'
  and exists (
    select 1
    from public.employees e
    join public.attendance_locations al on al.id = attendance_records.attendance_location_id
    where e.id = attendance_records.employee_id
      and e.profile_id = auth.uid()
      and e.deleted_at is null
      and e.region_id = al.region_id
      and al.is_active = true
      and public.calculate_distance_meters(
        attendance_records.latitude,
        attendance_records.longitude,
        al.latitude,
        al.longitude
      ) <= al.radius_meters
  )
);

alter table public.attendance_locations enable row level security;

drop policy if exists "Attendance location viewers can read scoped locations" on public.attendance_locations;
create policy "Attendance location viewers can read scoped locations"
on public.attendance_locations
for select
to authenticated
using (
  public.current_user_has_permission('attendance-locations', 'view')
  and public.current_user_can_access_region(region_id)
);

drop policy if exists "Attendance location users can create scoped locations" on public.attendance_locations;
create policy "Attendance location users can create scoped locations"
on public.attendance_locations
for insert
to authenticated
with check (
  public.current_user_has_permission('attendance-locations', 'use')
  and public.current_user_can_access_region(region_id)
);

drop policy if exists "Attendance location users can update scoped locations" on public.attendance_locations;
create policy "Attendance location users can update scoped locations"
on public.attendance_locations
for update
to authenticated
using (
  public.current_user_has_permission('attendance-locations', 'use')
  and public.current_user_can_access_region(region_id)
)
with check (
  public.current_user_has_permission('attendance-locations', 'use')
  and public.current_user_can_access_region(region_id)
);

drop policy if exists "Attendance location users can delete scoped locations" on public.attendance_locations;
create policy "Attendance location users can delete scoped locations"
on public.attendance_locations
for delete
to authenticated
using (
  public.current_user_has_permission('attendance-locations', 'use')
  and public.current_user_can_access_region(region_id)
);

grant execute on function public.calculate_distance_meters(numeric, numeric, numeric, numeric) to authenticated;
grant execute on function public.create_attendance_record_checked(
  public.attendance_punch_type,
  text,
  numeric,
  numeric,
  numeric,
  text,
  text
) to authenticated;

commit;
