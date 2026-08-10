begin;

create policy "Attendance managers can read scoped attendance photos"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'attendance-photos'
  and public.current_user_has_permission('attendance-management', 'view')
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.status = 'approved'
      and p.role <> 'super_admin'
  )
  and exists (
    select 1
    from public.attendance_records ar
    join public.employees e on e.id = ar.employee_id
    where ar.photo_path = storage.objects.name
      and ar.profile_id::text = (storage.foldername(storage.objects.name))[1]
      and e.deleted_at is null
      and public.current_user_can_access_region(e.region_id)
  )
);

commit;
