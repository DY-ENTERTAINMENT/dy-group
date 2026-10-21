-- Additive private-storage hardening. Existing public URLs remain accepted by
-- the client, which derives their object path and asks Storage for a short URL.
begin;

update storage.buckets set public = false where id = 'leave-medical-attachments';
drop policy if exists "Medical attachments are publicly readable" on storage.objects;
drop policy if exists "Employees read own medical attachments" on storage.objects;
drop policy if exists "Leave reviewers read scoped medical attachments" on storage.objects;

create policy "Employees read own medical attachments"
on storage.objects for select to authenticated
using (
  bucket_id = 'leave-medical-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
  and public.current_user_is_active_employee()
);

create policy "Leave reviewers read scoped medical attachments"
on storage.objects for select to authenticated
using (
  bucket_id = 'leave-medical-attachments'
  and public.current_user_can_review_leave_requests()
  and exists (
    select 1 from public.employees e
    where e.profile_id::text = (storage.foldername(storage.objects.name))[1]
      and e.deleted_at is null
      and public.current_user_can_access_region(e.region_id)
  )
);
commit;
