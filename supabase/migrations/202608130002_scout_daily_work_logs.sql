create table if not exists public.scout_daily_work_logs (
  id uuid primary key default gen_random_uuid(),
  work_date date not null,
  scout_profile_id uuid not null references public.profiles(id) on delete cascade,
  scout_employee_id uuid references public.employees(id) on delete set null,
  region_id uuid references public.regions(id) on delete set null,
  contacted_count integer not null default 0,
  replied_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scout_daily_work_logs_unique unique (scout_profile_id, work_date),
  constraint scout_daily_work_logs_contacted_count_check check (contacted_count >= 0),
  constraint scout_daily_work_logs_replied_count_check check (replied_count >= 0),
  constraint scout_daily_work_logs_reply_limit_check check (replied_count <= contacted_count)
);

create index if not exists scout_daily_work_logs_work_date_idx
on public.scout_daily_work_logs(work_date);

create index if not exists scout_daily_work_logs_scout_employee_id_idx
on public.scout_daily_work_logs(scout_employee_id);

create index if not exists scout_daily_work_logs_region_id_idx
on public.scout_daily_work_logs(region_id);

drop trigger if exists set_scout_daily_work_logs_updated_at on public.scout_daily_work_logs;
create trigger set_scout_daily_work_logs_updated_at
before update on public.scout_daily_work_logs
for each row execute function public.set_updated_at();

alter table public.scout_daily_work_logs enable row level security;

revoke all on table public.scout_daily_work_logs from public;
revoke insert, update, delete on table public.scout_daily_work_logs from authenticated;
grant select on table public.scout_daily_work_logs to authenticated;

drop policy if exists "Scouts can read own daily work logs" on public.scout_daily_work_logs;
create policy "Scouts can read own daily work logs"
on public.scout_daily_work_logs for select
to authenticated
using (
  scout_profile_id = auth.uid()
  and public.current_user_has_permission('scout-recruiting-data', 'view')
);

drop policy if exists "Scouts can create own recent daily work logs" on public.scout_daily_work_logs;
create policy "Scouts can create own recent daily work logs"
on public.scout_daily_work_logs for insert
to authenticated
with check (
  scout_profile_id = auth.uid()
  and scout_employee_id = public.current_user_employee_id()
  and work_date between ((now() at time zone 'Asia/Kuala_Lumpur')::date - 1)
                    and ((now() at time zone 'Asia/Kuala_Lumpur')::date)
  and public.current_user_has_permission('scout-recruiting-data', 'use')
);

drop policy if exists "Scouts can update own recent daily work logs" on public.scout_daily_work_logs;
create policy "Scouts can update own recent daily work logs"
on public.scout_daily_work_logs for update
to authenticated
using (
  scout_profile_id = auth.uid()
  and work_date between ((now() at time zone 'Asia/Kuala_Lumpur')::date - 1)
                    and ((now() at time zone 'Asia/Kuala_Lumpur')::date)
  and public.current_user_has_permission('scout-recruiting-data', 'use')
)
with check (
  scout_profile_id = auth.uid()
  and scout_employee_id = public.current_user_employee_id()
  and work_date between ((now() at time zone 'Asia/Kuala_Lumpur')::date - 1)
                    and ((now() at time zone 'Asia/Kuala_Lumpur')::date)
  and public.current_user_has_permission('scout-recruiting-data', 'use')
);

create or replace function public.upsert_scout_daily_work_log(
  p_work_date date,
  p_contacted_count integer,
  p_replied_count integer
)
returns public.scout_daily_work_logs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_employee public.employees;
  target_log public.scout_daily_work_logs;
  today_kl date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  if not public.current_user_has_permission('scout-recruiting-data', 'use') then
    raise exception 'Permission denied.';
  end if;

  if p_work_date < today_kl - 1 or p_work_date > today_kl then
    raise exception 'Daily work logs can only be saved for today or yesterday.';
  end if;

  if p_contacted_count < 0 then
    raise exception 'Contacted count cannot be negative.';
  end if;

  if p_replied_count < 0 then
    raise exception 'Replied count cannot be negative.';
  end if;

  if p_replied_count > p_contacted_count then
    raise exception 'Replied count cannot be greater than contacted count.';
  end if;

  select *
  into current_employee
  from public.employees e
  where e.profile_id = auth.uid()
    and e.deleted_at is null
  limit 1;

  if current_employee.id is null then
    raise exception 'Current employee profile was not found.';
  end if;

  insert into public.scout_daily_work_logs (
    work_date,
    scout_profile_id,
    scout_employee_id,
    region_id,
    contacted_count,
    replied_count
  )
  values (
    p_work_date,
    auth.uid(),
    current_employee.id,
    current_employee.region_id,
    p_contacted_count,
    p_replied_count
  )
  on conflict (scout_profile_id, work_date) do update
  set
    scout_employee_id = excluded.scout_employee_id,
    region_id = excluded.region_id,
    contacted_count = excluded.contacted_count,
    replied_count = excluded.replied_count
  returning * into target_log;

  return target_log;
end;
$$;

revoke all on function public.upsert_scout_daily_work_log(date, integer, integer) from public;
grant execute on function public.upsert_scout_daily_work_log(date, integer, integer) to authenticated;
