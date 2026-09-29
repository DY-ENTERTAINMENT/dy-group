-- Retire the cumulative-input configuration without removing its schema, RPCs,
-- or historical records. Existing and scheduled modes are normalized to direct.
begin;

update public.creator_profiles
set revenue_input_mode = 'direct',
    pending_revenue_input_mode = null,
    revenue_input_mode_effective_date = null
where revenue_input_mode is distinct from 'direct'
   or pending_revenue_input_mode is not null
   or revenue_input_mode_effective_date is not null;

commit;
