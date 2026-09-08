begin;

create table if not exists public.employee_leave_balance_adjustments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete restrict,
  leave_year integer not null,
  leave_type public.leave_type not null,
  adjustment_days integer not null,
  reason text not null,
  adjusted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint employee_leave_balance_adjustments_leave_type_check
    check (leave_type in ('annual', 'medical')),
  constraint employee_leave_balance_adjustments_days_check
    check (adjustment_days <> 0),
  constraint employee_leave_balance_adjustments_year_check
    check (leave_year between 2000 and 2100),
  constraint employee_leave_balance_adjustments_reason_check
    check (length(btrim(reason)) > 0)
);

create index if not exists employee_leave_balance_adjustments_employee_year_idx
on public.employee_leave_balance_adjustments(employee_id, leave_year, created_at desc);

create index if not exists employee_leave_balance_adjustments_type_year_idx
on public.employee_leave_balance_adjustments(leave_type, leave_year);

create index if not exists employee_leave_balance_adjustments_adjusted_by_idx
on public.employee_leave_balance_adjustments(adjusted_by, created_at desc);

alter table public.employee_leave_balance_adjustments enable row level security;

revoke insert, update, delete on public.employee_leave_balance_adjustments from anon;
revoke insert, update, delete on public.employee_leave_balance_adjustments from authenticated;

drop policy if exists "Leave balance managers can read scoped adjustments" on public.employee_leave_balance_adjustments;
create policy "Leave balance managers can read scoped adjustments"
on public.employee_leave_balance_adjustments
for select
to authenticated
using (
  public.current_user_has_permission('leave-balance-management', 'view')
  and exists (
    select 1
    from public.employees e
    where e.id = employee_leave_balance_adjustments.employee_id
      and e.deleted_at is null
      and public.current_user_can_access_region(e.region_id)
  )
);

commit;
