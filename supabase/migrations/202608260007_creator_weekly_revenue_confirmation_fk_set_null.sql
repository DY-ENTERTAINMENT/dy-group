begin;

create or replace function public.prevent_creator_weekly_revenue_confirmation_history_changes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE'
     and old.weekly_record_id is not null
     and new.weekly_record_id is null
     and old.id is not distinct from new.id
     and old.action is not distinct from new.action
     and old.previous_status is not distinct from new.previous_status
     and old.new_status is not distinct from new.new_status
     and old.previous_confirmed_by_employee_id is not distinct from new.previous_confirmed_by_employee_id
     and old.previous_confirmed_at is not distinct from new.previous_confirmed_at
     and old.acted_by_employee_id is not distinct from new.acted_by_employee_id
     and old.acted_at is not distinct from new.acted_at
     and old.reason is not distinct from new.reason
     and old.created_at is not distinct from new.created_at
     and old.weekly_record_id_snapshot is not distinct from new.weekly_record_id_snapshot
     and old.creator_profile_id is not distinct from new.creator_profile_id
     and old.creator_entity_id is not distinct from new.creator_entity_id
     and old.platform is not distinct from new.platform
     and old.platform_uid is not distinct from new.platform_uid
     and old.week_start_date is not distinct from new.week_start_date
     and old.week_end_date is not distinct from new.week_end_date
     and old.revenue_amount is not distinct from new.revenue_amount
     and old.revenue_unit is not distinct from new.revenue_unit
     and old.agent_note is not distinct from new.agent_note
     and old.manager_note is not distinct from new.manager_note
     and old.submitted_by_employee_id is not distinct from new.submitted_by_employee_id
     and old.submitted_at is not distinct from new.submitted_at
     and old.confirmed_by_employee_id is not distinct from new.confirmed_by_employee_id
     and old.confirmed_at is not distinct from new.confirmed_at then
    return new;
  end if;

  raise exception 'Creator weekly revenue confirmation history is append-only.';
end;
$$;

commit;
