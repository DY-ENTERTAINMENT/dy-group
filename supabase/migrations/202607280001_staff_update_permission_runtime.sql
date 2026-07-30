begin;

drop policy if exists "HR users can update scoped employees" on public.employees;

create policy "Staff permission users can update scoped employees"
on public.employees
for update
to authenticated
using (
  deleted_at is null
  and public.current_user_has_permission('staff', 'use')
  and public.current_user_can_access_region(region_id)
)
with check (
  deleted_at is null
  and public.current_user_has_permission('staff', 'use')
  and public.current_user_can_access_region(region_id)
);

commit;
