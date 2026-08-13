alter table public.employees
  add column if not exists employment_end_date date;

comment on column public.employees.employment_end_date is
  'Employment end date for employees marked as left. Used by HR attendance reporting to preserve pre-departure history.';
