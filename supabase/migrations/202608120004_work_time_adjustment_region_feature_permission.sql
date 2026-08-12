begin;

create or replace function public.current_user_work_time_adjustment_employee()
returns table (
  profile_id uuid,
  employee_id uuid,
  region_id uuid
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id, e.id, e.region_id
  from public.profiles p
  join public.employees e
    on e.profile_id = p.id
    and e.deleted_at is null
  join public.regions r
    on r.id = e.region_id
    and r.is_active = true
  where p.id = auth.uid()
    and p.status = 'approved'
    and public.current_user_has_region_feature_permission('work-time-adjustment-employee', 'use')
  limit 1
$$;

create or replace function public.current_user_can_review_work_time_adjustment(p_region_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.regions r
    where r.id = p_region_id
      and public.current_user_has_permission('work-time-adjustment', 'use')
      and public.current_user_can_access_region(p_region_id)
  )
$$;

create or replace function public.get_effective_work_time_adjustment(
  p_employee_id uuid,
  p_work_date date
)
returns table (
  detail_id uuid,
  request_id uuid,
  employee_id uuid,
  work_date date,
  adjusted_start_time time,
  adjusted_end_time time,
  approved_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    d.id,
    d.request_id,
    d.employee_id,
    d.work_date,
    d.adjusted_start_time,
    d.adjusted_end_time,
    d.reviewed_at
  from public.work_time_adjustment_request_dates d
  join public.employees e
    on e.id = d.employee_id
    and e.deleted_at is null
  join public.regions r
    on r.id = e.region_id
    and r.is_active = true
  where d.employee_id = p_employee_id
    and d.work_date = p_work_date
    and d.status = 'approved'
    and (
      (
        e.profile_id = auth.uid()
        and exists (
          select 1
          from public.current_user_work_time_adjustment_employee() current_employee
          where current_employee.employee_id = e.id
        )
      )
      or public.current_user_can_review_work_time_adjustment(e.region_id)
    )
  order by d.reviewed_at desc, d.created_at desc, d.id desc
  limit 1
$$;

create or replace function public.create_work_time_adjustment_request(
  p_start_date date,
  p_end_date date,
  p_adjusted_start_time time,
  p_reason text,
  p_attachment_path text default null,
  p_attachment_original_name text default null,
  p_attachment_content_type text default null,
  p_attachment_size_bytes integer default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requester record;
  employee_record public.employees;
  new_request_id uuid;
  adjusted_end time := p_adjusted_start_time + interval '8 hours 30 minutes';
  detail_count integer := 0;
  effective_original_start time;
  effective_original_end time;
  candidate record;
begin
  select * into requester from public.current_user_work_time_adjustment_employee() limit 1;

  if requester.employee_id is null then
    raise exception 'Current employee region has not enabled work time adjustment requests.';
  end if;

  select * into employee_record
  from public.employees
  where id = requester.employee_id
    and deleted_at is null;

  if employee_record.start_work_time is null or employee_record.end_work_time is null then
    raise exception 'Employee normal work time is incomplete.';
  end if;

  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then
    raise exception 'Invalid request date range.';
  end if;

  if p_start_date < public.current_malaysia_business_date() + 1 then
    raise exception 'Work time adjustment requests must be submitted at least 1 day in advance.';
  end if;

  if p_adjusted_start_time is null
     or extract(second from p_adjusted_start_time) <> 0
     or mod(extract(minute from p_adjusted_start_time)::integer, 15) <> 0 then
    raise exception 'Adjusted start time must use a 15-minute interval.';
  end if;

  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Reason is required.';
  end if;

  if nullif(trim(coalesce(p_attachment_path, '')), '') is not null then
    if split_part(trim(p_attachment_path), '/', 1) <> auth.uid()::text then
      raise exception 'Attachment path must belong to the current user.';
    end if;

    if p_attachment_content_type not in ('image/jpeg', 'image/png', 'application/pdf')
       or coalesce(p_attachment_size_bytes, 0) < 1
       or p_attachment_size_bytes > 5242880 then
      raise exception 'Attachment must be JPG, JPEG, PNG, or PDF and no larger than 5MB.';
    end if;
  end if;

  insert into public.work_time_adjustment_requests (
    profile_id,
    employee_id,
    region_id,
    requested_start_date,
    requested_end_date,
    original_start_work_time,
    original_end_work_time,
    requested_start_time,
    requested_end_time,
    reason,
    attachment_path,
    attachment_original_name,
    attachment_content_type,
    attachment_size_bytes
  )
  values (
    requester.profile_id,
    requester.employee_id,
    requester.region_id,
    p_start_date,
    p_end_date,
    employee_record.start_work_time,
    employee_record.end_work_time,
    p_adjusted_start_time,
    adjusted_end,
    trim(p_reason),
    nullif(trim(coalesce(p_attachment_path, '')), ''),
    nullif(trim(coalesce(p_attachment_original_name, '')), ''),
    p_attachment_content_type,
    p_attachment_size_bytes
  )
  returning id into new_request_id;

  insert into public.work_time_adjustment_audit_history (
    request_id,
    actor_profile_id,
    actor_employee_id,
    action,
    note,
    metadata
  )
  values (
    new_request_id,
    requester.profile_id,
    requester.employee_id,
    'request_created',
    trim(p_reason),
    jsonb_build_object('start_date', p_start_date, 'end_date', p_end_date)
  );

  for candidate in
    select day::date as work_date
    from generate_series(p_start_date, p_end_date, interval '1 day') as day
    where not exists (
        select 1
        from public.public_holidays ph
        where ph.is_active = true
          and ph.holiday_date = day::date
          and (ph.region_id is null or ph.region_id = requester.region_id)
      )
      and not exists (
        select 1
        from public.rest_days rd
        where rd.employee_id = requester.employee_id
          and rd.rest_date = day::date
          and rd.status = 'confirmed'
      )
      and (
        extract(dow from day::date) between 1 and 5
        or exists (
          select 1
          from public.leave_requests lr
          where lr.employee_id = requester.employee_id
            and lr.leave_type = 'replacement'
            and lr.status = 'approved'
            and lr.start_date = day::date
        )
      )
    order by day::date
  loop
    select
      coalesce(effective.adjusted_start_time, employee_record.start_work_time),
      coalesce(effective.adjusted_end_time, employee_record.end_work_time)
    into effective_original_start, effective_original_end
    from (select 1) seed
    left join lateral public.get_effective_work_time_adjustment(requester.employee_id, candidate.work_date) effective
      on true;

    if detail_count = 0 then
      update public.work_time_adjustment_requests
      set
        original_start_work_time = effective_original_start,
        original_end_work_time = effective_original_end
      where id = new_request_id;
    elsif effective_original_start is distinct from (
      select original_start_work_time from public.work_time_adjustment_requests where id = new_request_id
    ) or effective_original_end is distinct from (
      select original_end_work_time from public.work_time_adjustment_requests where id = new_request_id
    ) then
      raise exception 'Request range contains different original work periods. Please split the request.';
    end if;

    insert into public.work_time_adjustment_request_dates (
      request_id,
      profile_id,
      employee_id,
      region_id,
      work_date,
      original_start_work_time,
      original_end_work_time,
      adjusted_start_time,
      adjusted_end_time
    )
    values (
      new_request_id,
      requester.profile_id,
      requester.employee_id,
      requester.region_id,
      candidate.work_date,
      effective_original_start,
      effective_original_end,
      p_adjusted_start_time,
      adjusted_end
    );

    detail_count := detail_count + 1;
  end loop;

  if detail_count = 0 then
    raise exception 'The selected range has no eligible work dates.';
  end if;

  return new_request_id;
end;
$$;

create or replace function public.update_pending_work_time_adjustment_date(
  p_detail_id uuid,
  p_adjusted_start_time time
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_detail public.work_time_adjustment_request_dates;
  adjusted_end time := p_adjusted_start_time + interval '8 hours 30 minutes';
begin
  select * into target_detail
  from public.work_time_adjustment_request_dates
  where id = p_detail_id
  for update;

  if target_detail.id is null then
    raise exception 'Work time adjustment date not found.';
  end if;

  if target_detail.profile_id <> auth.uid() then
    raise exception 'Employees can only update their own requests.';
  end if;

  if not exists (
    select 1
    from public.current_user_work_time_adjustment_employee() current_employee
    where current_employee.employee_id = target_detail.employee_id
  ) then
    raise exception 'Current employee region has not enabled work time adjustment requests.';
  end if;

  if target_detail.status <> 'pending' then
    raise exception 'Only pending request dates can be updated.';
  end if;

  if target_detail.work_date < public.current_malaysia_business_date() + 1 then
    raise exception 'Pending request dates can only be updated at least 1 day in advance.';
  end if;

  if p_adjusted_start_time is null
     or extract(second from p_adjusted_start_time) <> 0
     or mod(extract(minute from p_adjusted_start_time)::integer, 15) <> 0 then
    raise exception 'Adjusted start time must use a 15-minute interval.';
  end if;

  update public.work_time_adjustment_request_dates
  set
    adjusted_start_time = p_adjusted_start_time,
    adjusted_end_time = adjusted_end,
    updated_at = now()
  where id = p_detail_id;

  insert into public.work_time_adjustment_audit_history (
    request_id,
    detail_id,
    actor_profile_id,
    action,
    from_status,
    to_status,
    metadata
  )
  values (
    target_detail.request_id,
    target_detail.id,
    auth.uid(),
    'detail_updated',
    target_detail.status,
    target_detail.status,
    jsonb_build_object(
      'old_start_time', target_detail.adjusted_start_time,
      'new_start_time', p_adjusted_start_time
    )
  );
end;
$$;

create or replace function public.cancel_pending_work_time_adjustment_date(
  p_detail_id uuid,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_detail public.work_time_adjustment_request_dates;
begin
  select * into target_detail
  from public.work_time_adjustment_request_dates
  where id = p_detail_id
  for update;

  if target_detail.id is null then
    raise exception 'Work time adjustment date not found.';
  end if;

  if target_detail.profile_id <> auth.uid() then
    raise exception 'Employees can only cancel their own requests.';
  end if;

  if not exists (
    select 1
    from public.current_user_work_time_adjustment_employee() current_employee
    where current_employee.employee_id = target_detail.employee_id
  ) then
    raise exception 'Current employee region has not enabled work time adjustment requests.';
  end if;

  if target_detail.status <> 'pending' then
    raise exception 'Only pending request dates can be cancelled by employees.';
  end if;

  update public.work_time_adjustment_request_dates
  set
    status = 'cancelled',
    cancelled_at = now(),
    updated_at = now()
  where id = p_detail_id;

  insert into public.work_time_adjustment_audit_history (
    request_id,
    detail_id,
    actor_profile_id,
    action,
    from_status,
    to_status,
    note
  )
  values (
    target_detail.request_id,
    target_detail.id,
    auth.uid(),
    'detail_cancelled',
    target_detail.status,
    'cancelled',
    nullif(trim(coalesce(p_note, '')), '')
  );
end;
$$;

create or replace function public.get_attendance_effective_work_times(
  p_start_date date,
  p_end_date date,
  p_region_id uuid default null
)
returns table (
  employee_id uuid,
  work_date date,
  effective_start_time time,
  effective_end_time time,
  is_from_work_time_adjustment boolean,
  detail_id uuid,
  request_id uuid,
  approved_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_start_date is null then
    raise exception 'Start date is required.';
  end if;

  if p_end_date is null then
    raise exception 'End date is required.';
  end if;

  if p_start_date > p_end_date then
    raise exception 'Start date must be before or equal to end date.';
  end if;

  if not public.current_user_has_permission('attendance-management', 'view') then
    raise exception 'No permission to view attendance effective work times.';
  end if;

  if p_region_id is not null and not public.current_user_can_access_region(p_region_id) then
    raise exception 'No permission to view attendance effective work times in this region.';
  end if;

  return query
  with ranked_adjustments as (
    select
      d.employee_id,
      d.work_date,
      d.adjusted_start_time,
      d.adjusted_end_time,
      d.id as detail_id,
      d.request_id,
      d.reviewed_at,
      row_number() over (
        partition by d.employee_id, d.work_date
        order by d.reviewed_at desc, d.created_at desc, d.id desc
      ) as row_number
    from public.work_time_adjustment_request_dates d
    join public.employees e
      on e.id = d.employee_id
      and e.deleted_at is null
    join public.regions r
      on r.id = e.region_id
      and r.is_active = true
    where d.status = 'approved'
      and d.work_date between p_start_date and p_end_date
      and (p_region_id is null or e.region_id = p_region_id)
      and public.current_user_can_access_region(e.region_id)
  )
  select
    ranked_adjustments.employee_id,
    ranked_adjustments.work_date,
    ranked_adjustments.adjusted_start_time as effective_start_time,
    ranked_adjustments.adjusted_end_time as effective_end_time,
    true as is_from_work_time_adjustment,
    ranked_adjustments.detail_id,
    ranked_adjustments.request_id,
    ranked_adjustments.reviewed_at as approved_at
  from ranked_adjustments
  where ranked_adjustments.row_number = 1
  order by ranked_adjustments.work_date, ranked_adjustments.employee_id;
end;
$$;

drop policy if exists "Users can read own or reviewable work time adjustment requests"
on public.work_time_adjustment_requests;
create policy "Users can read own or reviewable work time adjustment requests"
on public.work_time_adjustment_requests
for select
to authenticated
using (
  (
    profile_id = auth.uid()
    and exists (
      select 1
      from public.current_user_work_time_adjustment_employee() current_employee
      where current_employee.employee_id = work_time_adjustment_requests.employee_id
    )
  )
  or public.current_user_can_review_work_time_adjustment(region_id)
);

drop policy if exists "Users can read own or reviewable work time adjustment dates"
on public.work_time_adjustment_request_dates;
create policy "Users can read own or reviewable work time adjustment dates"
on public.work_time_adjustment_request_dates
for select
to authenticated
using (
  (
    profile_id = auth.uid()
    and exists (
      select 1
      from public.current_user_work_time_adjustment_employee() current_employee
      where current_employee.employee_id = work_time_adjustment_request_dates.employee_id
    )
  )
  or public.current_user_can_review_work_time_adjustment(region_id)
);

drop policy if exists "Users can read own or reviewable work time adjustment audit"
on public.work_time_adjustment_audit_history;
create policy "Users can read own or reviewable work time adjustment audit"
on public.work_time_adjustment_audit_history
for select
to authenticated
using (
  exists (
    select 1
    from public.work_time_adjustment_requests r
    where r.id = work_time_adjustment_audit_history.request_id
      and (
        (
          r.profile_id = auth.uid()
          and exists (
            select 1
            from public.current_user_work_time_adjustment_employee() current_employee
            where current_employee.employee_id = r.employee_id
          )
        )
        or public.current_user_can_review_work_time_adjustment(r.region_id)
      )
  )
);

drop policy if exists "KCH employees can upload own work time adjustment attachments"
on storage.objects;
drop policy if exists "Employees in enabled regions can upload own work time adjustment attachments"
on storage.objects;
create policy "Employees in enabled regions can upload own work time adjustment attachments"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'work-time-adjustment-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
  and exists (select 1 from public.current_user_work_time_adjustment_employee())
);

drop policy if exists "Users can read own or reviewable work time adjustment attachments"
on storage.objects;
create policy "Users can read own or reviewable work time adjustment attachments"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'work-time-adjustment-attachments'
  and (
    (
      (storage.foldername(name))[1] = auth.uid()::text
      and exists (select 1 from public.current_user_work_time_adjustment_employee())
    )
    or exists (
      select 1
      from public.work_time_adjustment_requests r
      where r.attachment_path = storage.objects.name
        and public.current_user_can_review_work_time_adjustment(r.region_id)
    )
  )
);

revoke all on function public.current_user_work_time_adjustment_employee() from public;
grant execute on function public.current_user_work_time_adjustment_employee() to authenticated;

revoke all on function public.current_user_can_review_work_time_adjustment(uuid) from public;
grant execute on function public.current_user_can_review_work_time_adjustment(uuid) to authenticated;

revoke all on function public.get_effective_work_time_adjustment(uuid, date) from public;
grant execute on function public.get_effective_work_time_adjustment(uuid, date) to authenticated;

revoke all on function public.create_work_time_adjustment_request(
  date,
  date,
  time,
  text,
  text,
  text,
  text,
  integer
) from public;
grant execute on function public.create_work_time_adjustment_request(
  date,
  date,
  time,
  text,
  text,
  text,
  text,
  integer
) to authenticated;

revoke all on function public.update_pending_work_time_adjustment_date(uuid, time) from public;
grant execute on function public.update_pending_work_time_adjustment_date(uuid, time) to authenticated;

revoke all on function public.cancel_pending_work_time_adjustment_date(uuid, text) from public;
grant execute on function public.cancel_pending_work_time_adjustment_date(uuid, text) to authenticated;

revoke all on function public.get_attendance_effective_work_times(date, date, uuid) from public;
grant execute on function public.get_attendance_effective_work_times(date, date, uuid) to authenticated;

comment on function public.current_user_work_time_adjustment_employee() is
  'Returns the current approved employee when their active region has work-time adjustment enabled.';

comment on table public.work_time_adjustment_requests is
  'Header table for work time adjustment requests. Per-date status is stored in work_time_adjustment_request_dates.';

comment on function public.get_attendance_effective_work_times(date, date, uuid) is
  'Returns approved work-time adjustment overrides for attendance reports. Dates without a row should use the employee default work times.';

commit;
