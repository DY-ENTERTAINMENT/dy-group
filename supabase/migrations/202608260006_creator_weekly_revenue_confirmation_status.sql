begin;

alter table public.creator_weekly_revenue_confirmation_history
  drop constraint if exists creator_weekly_revenue_confirmation_history_status_check;

alter table public.creator_weekly_revenue_confirmation_history
  add constraint creator_weekly_revenue_confirmation_history_status_check
  check (
    (
      previous_status = 'confirmed'
      and new_status = 'submitted'
    )
    or
    (
      previous_status = 'submitted'
      and new_status = 'confirmed'
    )
  );

commit;
