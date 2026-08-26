begin;

alter table public.creator_weekly_revenue_confirmation_history
  drop constraint if exists creator_weekly_revenue_confirmation_history_action_check;

alter table public.creator_weekly_revenue_confirmation_history
  add constraint creator_weekly_revenue_confirmation_history_action_check
  check (action in ('cancel_confirmation', 'confirm'));

commit;
