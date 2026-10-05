begin;

-- Phase 3C: server-side admission gate.  It defaults closed and is deliberately
-- independent of attendance_records and the existing attendance write RPCs.
create table public.outgoing_feature_control (
  control_key text primary key check (control_key = 'outgoing_real_service'),
  admissions_enabled boolean not null default false,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.outgoing_feature_control_audit (
  id uuid primary key default gen_random_uuid(),
  previous_enabled boolean not null,
  next_enabled boolean not null,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now()
);

insert into public.outgoing_feature_control (control_key, admissions_enabled)
values ('outgoing_real_service', false)
on conflict (control_key) do nothing;

alter table public.outgoing_feature_control enable row level security;
alter table public.outgoing_feature_control_audit enable row level security;

create or replace function public.outgoing_feature_admissions_enabled()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select admissions_enabled from public.outgoing_feature_control where control_key = 'outgoing_real_service'), false)
$$;

create or replace function public.get_outgoing_feature_admissions_enabled()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.current_user_is_active_employee() and public.outgoing_feature_admissions_enabled()
$$;

create or replace function public.set_outgoing_feature_admissions_enabled(p_enabled boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare previous_value boolean;
begin
  if p_enabled is null then raise exception 'Outgoing feature state is required.'; end if;
  if not public.current_user_has_permission('outgoing-settings', 'use') then raise exception 'No permission to change outgoing feature settings.'; end if;
  select admissions_enabled into previous_value from public.outgoing_feature_control where control_key = 'outgoing_real_service' for update;
  update public.outgoing_feature_control set admissions_enabled = p_enabled, updated_by = auth.uid(), updated_at = now() where control_key = 'outgoing_real_service';
  if previous_value is distinct from p_enabled then
    insert into public.outgoing_feature_control_audit(previous_enabled, next_enabled, changed_by) values (previous_value, p_enabled, auth.uid());
  end if;
end;
$$;

-- Enforced below the client/RPC layer.  Disabling stops new work but preserves
-- cancellation, reconciliation, and completion of already-started outings.
create or replace function public.guard_outgoing_request_admission()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (tg_op = 'INSERT' or (tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'approved'))
     and not public.outgoing_feature_admissions_enabled() then
    raise exception 'Outgoing service is currently disabled.';
  end if;
  return new;
end;
$$;

create or replace function public.guard_outgoing_event_admission()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.outgoing_feature_admissions_enabled() then raise exception 'Outgoing service is currently disabled.'; end if;
  return new;
end;
$$;

create trigger trg_outgoing_request_admission_guard before insert or update of status on public.outgoing_requests
for each row execute function public.guard_outgoing_request_admission();
create trigger trg_outgoing_event_admission_guard before insert on public.outgoing_events
for each row execute function public.guard_outgoing_event_admission();

drop policy "Active employees can upload own outgoing photos" on storage.objects;
create policy "Active employees can upload own outgoing photos" on storage.objects for insert to authenticated with check (
  bucket_id = 'outgoing-photos' and public.current_user_is_active_employee()
  and (storage.foldername(name))[1] = auth.uid()::text
  and exists (select 1 from public.outgoing_requests r where r.id::text = (storage.foldername(name))[2]
    and r.profile_id = auth.uid() and r.status = 'approved'
    and (public.outgoing_feature_admissions_enabled() or exists (select 1 from public.outgoing_events e where e.request_id = r.id and e.profile_id = auth.uid() and e.status = 'in_progress')))
);

revoke all on function public.outgoing_feature_admissions_enabled() from public, anon;
revoke all on function public.get_outgoing_feature_admissions_enabled() from public, anon;
revoke all on function public.set_outgoing_feature_admissions_enabled(boolean) from public, anon;
grant execute on function public.get_outgoing_feature_admissions_enabled() to authenticated;
grant execute on function public.set_outgoing_feature_admissions_enabled(boolean) to authenticated;

commit;
