begin;

-- Informational prices for the Designer Request page only. These values are
-- intentionally isolated from requests, workflow stages, and calculations.
create table public.designer_reference_pricing (
  singleton boolean primary key default true check (singleton),
  banner_production_price numeric(10,2) not null,
  standee_production_price numeric(10,2) not null,
  event_design_setup_price numeric(10,2) not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  constraint designer_reference_pricing_non_negative_prices check (
    banner_production_price >= 0
    and standee_production_price >= 0
    and event_design_setup_price >= 0
  )
);

insert into public.designer_reference_pricing (
  singleton,
  banner_production_price,
  standee_production_price,
  event_design_setup_price
)
values (true, 30.00, 50.00, 50.00);

insert into public.permission_items (
  permission_key,
  parent_key,
  name,
  sort_order,
  is_active,
  is_reserved
)
values (
  'designer-pricing:manage',
  null,
  '管理美工参考价格',
  36,
  true,
  false
)
on conflict (permission_key) do update
set
  parent_key = excluded.parent_key,
  name = excluded.name,
  sort_order = excluded.sort_order,
  is_active = true,
  is_reserved = false,
  updated_at = now();

alter table public.designer_reference_pricing enable row level security;

create policy "Designer request viewers can read reference pricing"
on public.designer_reference_pricing
for select
to authenticated
using (public.current_user_has_permission('agent-design-requests', 'view'));

-- Clients may read through the policy above, but all mutations must use the
-- guarded RPC below.
revoke all on table public.designer_reference_pricing from public, anon, authenticated;
grant select on table public.designer_reference_pricing to authenticated;

create function public.update_designer_reference_pricing(
  p_banner_production_price numeric,
  p_standee_production_price numeric,
  p_event_design_setup_price numeric
)
returns public.designer_reference_pricing
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pricing public.designer_reference_pricing;
begin
  if not public.current_user_has_explicit_permission('designer-pricing:manage', 'use') then
    raise exception 'Designer pricing management permission is required.' using errcode = '42501';
  end if;

  if p_banner_production_price is null
     or p_standee_production_price is null
     or p_event_design_setup_price is null
     or p_banner_production_price::text in ('NaN', 'Infinity', '-Infinity')
     or p_standee_production_price::text in ('NaN', 'Infinity', '-Infinity')
     or p_event_design_setup_price::text in ('NaN', 'Infinity', '-Infinity')
     or p_banner_production_price < 0
     or p_standee_production_price < 0
     or p_event_design_setup_price < 0
     or p_banner_production_price > 99999999.99
     or p_standee_production_price > 99999999.99
     or p_event_design_setup_price > 99999999.99
     or p_banner_production_price <> round(p_banner_production_price, 2)
     or p_standee_production_price <> round(p_standee_production_price, 2)
     or p_event_design_setup_price <> round(p_event_design_setup_price, 2) then
    raise exception 'Reference prices must be finite, non-negative amounts with at most two decimal places.' using errcode = '22023';
  end if;

  update public.designer_reference_pricing
  set
    banner_production_price = p_banner_production_price,
    standee_production_price = p_standee_production_price,
    event_design_setup_price = p_event_design_setup_price,
    updated_at = now(),
    updated_by = auth.uid()
  where singleton = true
  returning * into v_pricing;

  if v_pricing.singleton is null then
    raise exception 'Designer reference pricing row is missing.' using errcode = '55000';
  end if;

  return v_pricing;
end;
$$;

revoke all on function public.update_designer_reference_pricing(numeric, numeric, numeric) from public, anon;
grant execute on function public.update_designer_reference_pricing(numeric, numeric, numeric) to authenticated;

commit;
