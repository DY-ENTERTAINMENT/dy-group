begin;

drop index if exists public.replacement_work_change_one_approved_per_source_idx;

create or replace function public.create_replacement_work_change_request(
  p_source_replacement_leave_request_id uuid,
  p_change_type text,
  p_requested_makeup_date date,
  p_requested_start_time time,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  source_row record;
  new_id uuid;
  effective_date date;
  today_myt date := public.current_malaysia_business_date();
begin
  select lr.*, e.id employee_id, e.profile_id, e.region_id, e.start_work_time
  into source_row
  from public.leave_requests lr
  join public.employees e on e.id = lr.employee_id and e.deleted_at is null
  where lr.id = p_source_replacement_leave_request_id
  for update;

  if source_row.id is null or source_row.leave_type <> 'replacement' or source_row.status <> 'approved' then
    raise exception 'Only approved replacement leave can be changed.';
  end if;

  if source_row.profile_id <> auth.uid() then
    raise exception 'Employees can only change their own replacement leave.';
  end if;

  if not public.current_user_has_region_feature_permission('replacement-leave', 'use') then
    raise exception 'Replacement leave is not enabled in this region.';
  end if;

  if p_change_type <> 'reschedule' then
    raise exception 'New replacement work change requests only support reschedule.';
  end if;

  if p_requested_start_time is not null then
    raise exception 'Reschedule requests cannot include a work time.';
  end if;

  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Reason is required.';
  end if;

  select coalesce((
    select c.requested_makeup_date
    from public.replacement_work_change_requests c
    where c.source_replacement_leave_request_id = source_row.id
      and c.status = 'approved'
      and c.change_type = 'reschedule'
    order by c.reviewed_at desc, c.created_at desc, c.id desc
    limit 1
  ), source_row.start_date)
  into effective_date;

  if public.replacement_makeup_has_clock_in(source_row.employee_id, effective_date) then
    raise exception 'Make-up work has already started and cannot be changed from the employee portal.';
  end if;

  if p_requested_makeup_date is null
     or extract(dow from p_requested_makeup_date) <> 6
     or p_requested_makeup_date < today_myt then
    raise exception 'New make-up date must be a non-past Saturday.';
  end if;

  if exists (
    select 1
    from public.public_holidays ph
    where ph.is_active
      and ph.holiday_date = p_requested_makeup_date
      and (ph.region_id is null or ph.region_id = source_row.region_id)
  ) then
    raise exception 'New make-up date cannot be a public holiday.';
  end if;

  if exists (
    select 1
    from public.rest_days rd
    where rd.employee_id = source_row.employee_id
      and rd.rest_date = p_requested_makeup_date
      and rd.status = 'confirmed'
  ) then
    raise exception 'New make-up date conflicts with a confirmed rest day.';
  end if;

  if exists (
    select 1
    from public.leave_requests l
    where l.employee_id = source_row.employee_id
      and l.status = 'approved'
      and l.leave_type <> 'replacement'
      and p_requested_makeup_date between l.start_date and l.end_date
  ) then
    raise exception 'New make-up date conflicts with approved leave.';
  end if;

  if exists (
    select 1
    from public.leave_requests l
    where l.employee_id = source_row.employee_id
      and l.leave_type = 'replacement'
      and l.status = 'approved'
      and l.id <> source_row.id
      and l.start_date = p_requested_makeup_date
  ) then
    raise exception 'New make-up date conflicts with another replacement leave.';
  end if;

  if exists (
    select 1
    from public.replacement_work_change_requests c
    where c.employee_id = source_row.employee_id
      and c.status = 'approved'
      and c.change_type = 'reschedule'
      and c.source_replacement_leave_request_id <> source_row.id
      and c.requested_makeup_date = p_requested_makeup_date
  ) then
    raise exception 'New make-up date conflicts with another effective replacement change.';
  end if;

  insert into public.replacement_work_change_requests (
    source_replacement_leave_request_id,
    employee_id,
    change_type,
    original_makeup_date,
    original_start_time,
    requested_makeup_date,
    requested_start_time,
    reason
  )
  values (
    source_row.id,
    source_row.employee_id,
    'reschedule'::public.replacement_work_change_type,
    effective_date,
    source_row.start_work_time,
    p_requested_makeup_date,
    null,
    btrim(p_reason)
  )
  returning id into new_id;

  return new_id;
end;
$$;

create or replace function public.review_replacement_work_change_request(
  p_request_id uuid,
  p_status text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  change_row record;
  effective_date date;
  adjustment_id uuid;
  adjusted_end time;
begin
  select c.*, lr.id source_id, lr.employee_id source_employee_id, lr.start_date source_makeup_date,
    lr.status source_status, lr.leave_type, e.region_id, e.profile_id, e.start_work_time, e.end_work_time
  into change_row
  from public.replacement_work_change_requests c
  join public.leave_requests lr on lr.id = c.source_replacement_leave_request_id
  join public.employees e on e.id = c.employee_id and e.deleted_at is null
  where c.id = p_request_id
  for update;

  if change_row.id is null or change_row.status <> 'pending' then
    raise exception 'Only pending replacement work changes can be reviewed.';
  end if;

  if not public.current_user_can_review_leave_requests()
     or not public.current_user_can_access_region(change_row.region_id) then
    raise exception 'No permission to review this replacement work change.';
  end if;

  if p_status not in ('approved', 'rejected') then
    raise exception 'Invalid review status.';
  end if;

  if p_status = 'rejected' and length(btrim(coalesce(p_note, ''))) = 0 then
    raise exception 'Review note is required when rejecting.';
  end if;

  if p_status = 'approved' and change_row.employee_id is distinct from change_row.source_employee_id then
    raise exception 'Replacement work change employee does not match the source leave request.';
  end if;

  select coalesce((
    select c.requested_makeup_date
    from public.replacement_work_change_requests c
    where c.source_replacement_leave_request_id = change_row.source_replacement_leave_request_id
      and c.status = 'approved'
      and c.change_type = 'reschedule'
    order by c.reviewed_at desc, c.created_at desc, c.id desc
    limit 1
  ), change_row.source_makeup_date)
  into effective_date;

  if change_row.source_status <> 'approved' or change_row.leave_type <> 'replacement' then
    raise exception 'Source replacement leave is no longer valid.';
  end if;

  if p_status = 'approved'
     and change_row.change_type = 'reschedule'
     and change_row.original_makeup_date <> effective_date then
    raise exception 'Current make-up date changed after this reschedule request was submitted. Please submit a new request.';
  end if;

  if public.replacement_makeup_has_clock_in(change_row.employee_id, effective_date) then
    raise exception 'Make-up work has already started and cannot be changed from the employee portal.';
  end if;

  if p_status = 'approved' and change_row.change_type = 'reschedule' then
    if change_row.requested_makeup_date < public.current_malaysia_business_date()
       or extract(dow from change_row.requested_makeup_date) <> 6 then
      raise exception 'New make-up date is no longer valid.';
    end if;

    if exists (
      select 1
      from public.public_holidays ph
      where ph.is_active
        and ph.holiday_date = change_row.requested_makeup_date
        and (ph.region_id is null or ph.region_id = change_row.region_id)
    ) then
      raise exception 'New make-up date conflicts with a public holiday.';
    end if;

    if exists (
      select 1
      from public.rest_days rd
      where rd.employee_id = change_row.employee_id
        and rd.rest_date = change_row.requested_makeup_date
        and rd.status = 'confirmed'
    ) then
      raise exception 'New make-up date conflicts with a confirmed rest day.';
    end if;

    if exists (
      select 1
      from public.leave_requests l
      where l.employee_id = change_row.employee_id
        and l.status = 'approved'
        and l.leave_type <> 'replacement'
        and change_row.requested_makeup_date between l.start_date and l.end_date
    ) then
      raise exception 'New make-up date conflicts with approved leave.';
    end if;

    if exists (
      select 1
      from public.leave_requests l
      where l.employee_id = change_row.employee_id
        and l.leave_type = 'replacement'
        and l.status = 'approved'
        and l.id <> change_row.source_replacement_leave_request_id
        and l.start_date = change_row.requested_makeup_date
    ) then
      raise exception 'New make-up date conflicts with another replacement leave.';
    end if;

    if exists (
      select 1
      from public.replacement_work_change_requests c
      where c.employee_id = change_row.employee_id
        and c.status = 'approved'
        and c.change_type = 'reschedule'
        and c.source_replacement_leave_request_id <> change_row.source_replacement_leave_request_id
        and c.requested_makeup_date = change_row.requested_makeup_date
    ) then
      raise exception 'New make-up date conflicts with another effective replacement change.';
    end if;
  end if;

  update public.replacement_work_change_requests
  set
    status = p_status::public.replacement_work_change_status,
    review_note = nullif(btrim(coalesce(p_note, '')), ''),
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    updated_at = now()
  where id = change_row.id;

  if p_status = 'approved' and change_row.change_type = 'work_time' then
    adjusted_end := change_row.requested_start_time + interval '8 hours 30 minutes';

    insert into public.work_time_adjustment_requests (
      profile_id, employee_id, region_id, requested_start_date, requested_end_date,
      original_start_work_time, original_end_work_time, requested_start_time, requested_end_time, reason
    )
    values (
      change_row.profile_id, change_row.employee_id, change_row.region_id, effective_date, effective_date,
      change_row.start_work_time, change_row.end_work_time, change_row.requested_start_time, adjusted_end, change_row.reason
    )
    returning id into adjustment_id;

    insert into public.work_time_adjustment_request_dates (
      request_id, profile_id, employee_id, region_id, work_date, original_start_work_time,
      original_end_work_time, adjusted_start_time, adjusted_end_time, status, reviewed_by, reviewed_at,
      source_replacement_leave_request_id
    )
    values (
      adjustment_id, change_row.profile_id, change_row.employee_id, change_row.region_id, effective_date,
      change_row.start_work_time, change_row.end_work_time, change_row.requested_start_time, adjusted_end,
      'approved', auth.uid(), now(), change_row.source_replacement_leave_request_id
    );
  end if;
end;
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
  where id = requester.employee_id and deleted_at is null;

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
    profile_id, employee_id, region_id, requested_start_date, requested_end_date,
    original_start_work_time, original_end_work_time, requested_start_time, requested_end_time,
    reason, attachment_path, attachment_original_name, attachment_content_type, attachment_size_bytes
  )
  values (
    requester.profile_id, requester.employee_id, requester.region_id, p_start_date, p_end_date,
    employee_record.start_work_time, employee_record.end_work_time, p_adjusted_start_time, adjusted_end,
    trim(p_reason), nullif(trim(coalesce(p_attachment_path, '')), ''),
    nullif(trim(coalesce(p_attachment_original_name, '')), ''), p_attachment_content_type, p_attachment_size_bytes
  )
  returning id into new_request_id;

  insert into public.work_time_adjustment_audit_history (
    request_id, actor_profile_id, actor_employee_id, action, note, metadata
  )
  values (
    new_request_id, requester.profile_id, requester.employee_id, 'request_created', trim(p_reason),
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
          and coalesce((
            select c.requested_makeup_date
            from public.replacement_work_change_requests c
            where c.source_replacement_leave_request_id = lr.id
              and c.status = 'approved'
              and c.change_type = 'reschedule'
            order by c.reviewed_at desc, c.created_at desc, c.id desc
            limit 1
          ), lr.start_date) = day::date
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
      request_id, profile_id, employee_id, region_id, work_date, original_start_work_time,
      original_end_work_time, adjusted_start_time, adjusted_end_time
    )
    values (
      new_request_id, requester.profile_id, requester.employee_id, requester.region_id, candidate.work_date,
      effective_original_start, effective_original_end, p_adjusted_start_time, adjusted_end
    );

    detail_count := detail_count + 1;
  end loop;

  if detail_count = 0 then
    raise exception 'The selected range has no eligible work dates.';
  end if;

  return new_request_id;
end;
$$;

create or replace function public.review_work_time_adjustment_date(
  p_detail_id uuid,
  p_status text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_detail public.work_time_adjustment_request_dates;
  normalized_status text := lower(trim(coalesce(p_status, '')));
  audit_action public.work_time_adjustment_audit_action;
begin
  if normalized_status not in ('approved', 'rejected') then
    raise exception 'Review status must be approved or rejected.';
  end if;

  select * into target_detail
  from public.work_time_adjustment_request_dates
  where id = p_detail_id
  for update;

  if target_detail.id is null then
    raise exception 'Work time adjustment date not found.';
  end if;

  if target_detail.status <> 'pending' then
    raise exception 'Only pending request dates can be reviewed.';
  end if;

  if not public.current_user_can_review_work_time_adjustment(target_detail.region_id) then
    raise exception 'No permission to review this work time adjustment date.';
  end if;

  if normalized_status = 'approved'
     and extract(dow from target_detail.work_date) = 6
     and not exists (
       select 1
       from public.leave_requests lr
       where lr.employee_id = target_detail.employee_id
         and lr.leave_type = 'replacement'
         and lr.status = 'approved'
         and coalesce((
           select c.requested_makeup_date
           from public.replacement_work_change_requests c
           where c.source_replacement_leave_request_id = lr.id
             and c.status = 'approved'
             and c.change_type = 'reschedule'
           order by c.reviewed_at desc, c.created_at desc, c.id desc
           limit 1
         ), lr.start_date) = target_detail.work_date
     ) then
    raise exception 'This date is no longer the current effective make-up work date and cannot be approved.';
  end if;

  audit_action := case
    when normalized_status = 'approved' then 'detail_approved'::public.work_time_adjustment_audit_action
    else 'detail_rejected'::public.work_time_adjustment_audit_action
  end;

  update public.work_time_adjustment_request_dates
  set
    status = normalized_status::public.work_time_adjustment_detail_status,
    review_note = nullif(trim(coalesce(p_note, '')), ''),
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    updated_at = now()
  where id = p_detail_id;

  insert into public.work_time_adjustment_audit_history (
    request_id, detail_id, actor_profile_id, action, from_status, to_status, note
  )
  values (
    target_detail.request_id, target_detail.id, auth.uid(), audit_action, target_detail.status,
    normalized_status::public.work_time_adjustment_detail_status, nullif(trim(coalesce(p_note, '')), '')
  );
end;
$$;

commit;
