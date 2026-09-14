begin;

alter table public.creator_entities add column if not exists birthday date;

create or replace function public.create_creator_entity_with_platforms_with_birthday(p_display_name text, p_birthday date, p_region_id uuid, p_scout_employee_id uuid, p_manager_employee_id uuid, p_platforms jsonb, p_secondary_scout_employee_id uuid default null, p_secondary_manager_employee_id uuid default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; begin
  v_id := public.create_creator_entity_with_platforms(p_display_name, p_region_id, p_scout_employee_id, p_manager_employee_id, p_platforms, p_secondary_scout_employee_id, p_secondary_manager_employee_id);
  update public.creator_entities set birthday = p_birthday where id = v_id;
  return v_id;
end; $$;

create or replace function public.save_creator_entity_shared_data_with_birthday(p_creator_entity_id uuid, p_display_name text, p_birthday date, p_region_id uuid, p_scout_employee_id uuid, p_manager_employee_id uuid, p_registration_type text, p_guild_joined_date date, p_bank_account_name text, p_bank_name text, p_bank_account text, p_secondary_scout_employee_id uuid, p_secondary_manager_employee_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$ begin
  perform public.save_creator_entity_shared_data(p_creator_entity_id,p_display_name,p_region_id,p_scout_employee_id,p_manager_employee_id,p_registration_type,p_guild_joined_date,p_bank_account_name,p_bank_name,p_bank_account,p_secondary_scout_employee_id,p_secondary_manager_employee_id);
  update public.creator_entities set birthday=p_birthday where id=p_creator_entity_id;
end; $$;
grant execute on function public.create_creator_entity_with_platforms_with_birthday(text,date,uuid,uuid,uuid,jsonb,uuid,uuid), public.save_creator_entity_shared_data_with_birthday(uuid,text,date,uuid,uuid,uuid,text,date,text,text,text,uuid,uuid) to authenticated;
revoke all on function public.create_creator_entity_with_platforms_with_birthday(text,date,uuid,uuid,uuid,jsonb,uuid,uuid) from public;
revoke all on function public.save_creator_entity_shared_data_with_birthday(uuid,text,date,uuid,uuid,uuid,text,date,text,text,text,uuid,uuid) from public;

create table public.creator_activities (
  id uuid primary key default gen_random_uuid(),
  creator_entity_id uuid not null references public.creator_entities(id) on delete restrict,
  agent_employee_id uuid not null references public.employees(id) on delete restrict,
  title text not null check (length(btrim(title)) > 0),
  activity_date date not null,
  activity_time time,
  activity_type text not null check (activity_type in ('guild_activity','live','shooting','offline_activity','other')),
  agent_remark text,
  lead_remark text,
  lead_remark_by uuid references public.profiles(id) on delete set null,
  lead_remark_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index creator_activities_date_idx on public.creator_activities(activity_date, activity_time, id);
create index creator_activities_entity_date_idx on public.creator_activities(creator_entity_id, activity_date);
create index creator_activities_agent_date_idx on public.creator_activities(agent_employee_id, activity_date);

create table public.creator_milestone_notes (
  id uuid primary key default gen_random_uuid(),
  creator_entity_id uuid not null references public.creator_entities(id) on delete restrict,
  milestone_type text not null check (milestone_type in ('30_days','100_days','6_months','1_year','birthday')),
  milestone_date date not null,
  agent_remark text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (creator_entity_id, milestone_type, milestone_date)
);

insert into public.permission_items(permission_key, parent_key, name, sort_order, is_reserved)
values ('agent-creator-activity-calendar', null, '主播活动总日历', 25, false)
on conflict (permission_key) do update set parent_key = null, name = excluded.name, sort_order = excluded.sort_order, is_active = true, updated_at = now();

create or replace function public.creator_activity_actor_can_manage(p_creator_entity_id uuid, p_action text default 'view') returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.current_user_has_permission('agent-creator-data', p_action)
    and exists (
      select 1 from public.creator_entities e
      where e.id = p_creator_entity_id and public.current_user_can_access_region(e.region_id)
        and (e.manager_employee_id = public.current_user_employee_id() or exists (
          select 1 from public.creator_collaborator_assignments c
          where c.creator_entity_id = e.id and c.assignment_type = 'manager' and c.assignment_role = 'secondary'
            and c.employee_id = public.current_user_employee_id() and c.status = 'active')));
$$;

create or replace function public.list_my_creator_entity_birthdays(p_creator_entity_ids uuid[])
returns table(creator_entity_id uuid, birthday date) language sql stable security definer set search_path = public, pg_temp as $$
 select e.id,e.birthday from public.creator_entities e where e.id = any(p_creator_entity_ids) and public.creator_activity_actor_can_manage(e.id,'view');
$$;
create or replace function public.get_creator_entity_birthday(p_creator_entity_id uuid)
returns date language sql stable security definer set search_path = public, pg_temp as $$
 select e.birthday from public.creator_entities e where e.id=p_creator_entity_id and public.current_user_has_permission('management-streamer-stats','view') and public.current_user_can_access_region(e.region_id);
$$;

alter table public.creator_activities enable row level security;
alter table public.creator_milestone_notes enable row level security;
revoke all on public.creator_activities, public.creator_milestone_notes from anon, authenticated;

create or replace function public.create_creator_activity(p_creator_entity_id uuid, p_title text, p_activity_date date, p_activity_time time, p_activity_type text, p_agent_remark text default null)
returns public.creator_activities language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.creator_activities; begin
  if auth.uid() is null or not public.creator_activity_actor_can_manage(p_creator_entity_id, 'use') then raise exception 'Permission denied.'; end if;
  insert into public.creator_activities(creator_entity_id, agent_employee_id, title, activity_date, activity_time, activity_type, agent_remark)
  values(p_creator_entity_id, public.current_user_employee_id(), nullif(btrim(p_title), ''), p_activity_date, p_activity_time, p_activity_type, nullif(btrim(coalesce(p_agent_remark,'')),'')) returning * into r; return r;
end; $$;

create or replace function public.update_creator_activity(p_id uuid, p_title text, p_activity_date date, p_activity_time time, p_activity_type text, p_agent_remark text default null)
returns public.creator_activities language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.creator_activities; begin
  select * into r from public.creator_activities where id=p_id for update;
  if not found or r.agent_employee_id <> public.current_user_employee_id() or not public.creator_activity_actor_can_manage(r.creator_entity_id, 'use') then raise exception 'Permission denied.'; end if;
  update public.creator_activities set title=nullif(btrim(p_title),''), activity_date=p_activity_date, activity_time=p_activity_time, activity_type=p_activity_type, agent_remark=nullif(btrim(coalesce(p_agent_remark,'')),''), updated_at=now() where id=p_id returning * into r; return r;
end; $$;

create or replace function public.list_my_creator_activities(p_month date)
returns setof public.creator_activities language sql stable security definer set search_path = public, pg_temp as $$
 select a.* from public.creator_activities a where public.creator_activity_actor_can_manage(a.creator_entity_id, 'view') and a.activity_date >= date_trunc('month',p_month)::date and a.activity_date < (date_trunc('month',p_month) + interval '1 month')::date order by a.activity_date,a.activity_time,a.id;
$$;

create or replace function public.list_creator_activity_calendar(p_month date)
returns table(id uuid, creator_entity_id uuid, creator_name text, region_id uuid, agent_employee_id uuid, agent_name text, title text, activity_date date, activity_time time, activity_type text, agent_remark text, lead_remark text, lead_remark_by uuid, lead_remark_updated_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
 select a.id,a.creator_entity_id,e.display_name,e.region_id,a.agent_employee_id,coalesce(nullif(btrim(agent.nickname),''),agent.full_name),a.title,a.activity_date,a.activity_time,a.activity_type,a.agent_remark,a.lead_remark,a.lead_remark_by,a.lead_remark_updated_at
 from public.creator_activities a join public.creator_entities e on e.id=a.creator_entity_id join public.employees agent on agent.id=a.agent_employee_id
 where public.current_user_has_permission('agent-creator-activity-calendar','view') and public.current_user_can_access_region(e.region_id)
   and a.activity_date >= date_trunc('month',p_month)::date and a.activity_date < (date_trunc('month',p_month) + interval '1 month')::date order by a.activity_date,a.activity_time,a.id;
$$;

create or replace function public.update_creator_activity_lead_remark(p_id uuid, p_lead_remark text)
returns public.creator_activities language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.creator_activities; begin
 select a.* into r from public.creator_activities a join public.creator_entities e on e.id=a.creator_entity_id where a.id=p_id and public.current_user_can_access_region(e.region_id) for update;
 if not found or not public.current_user_has_permission('agent-creator-activity-calendar','use') then raise exception 'Permission denied.'; end if;
 update public.creator_activities set lead_remark=nullif(btrim(coalesce(p_lead_remark,'')),''), lead_remark_by=auth.uid(), lead_remark_updated_at=now(), updated_at=now() where id=p_id returning * into r; return r;
end; $$;

create or replace function public.upsert_creator_milestone_note(p_creator_entity_id uuid, p_milestone_type text, p_milestone_date date, p_agent_remark text)
returns public.creator_milestone_notes language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.creator_milestone_notes; begin
 if auth.uid() is null or not public.creator_activity_actor_can_manage(p_creator_entity_id,'use') then raise exception 'Permission denied.'; end if;
 insert into public.creator_milestone_notes(creator_entity_id,milestone_type,milestone_date,agent_remark,created_by,updated_by) values(p_creator_entity_id,p_milestone_type,p_milestone_date,nullif(btrim(coalesce(p_agent_remark,'')),''),auth.uid(),auth.uid())
 on conflict(creator_entity_id,milestone_type,milestone_date) do update set agent_remark=excluded.agent_remark,updated_by=auth.uid(),updated_at=now() returning * into r; return r;
end; $$;

create or replace function public.get_creator_milestone_note(p_creator_entity_id uuid, p_milestone_type text, p_milestone_date date)
returns public.creator_milestone_notes language sql stable security definer set search_path = public, pg_temp as $$
 select n.* from public.creator_milestone_notes n
 where n.creator_entity_id=p_creator_entity_id and n.milestone_type=p_milestone_type and n.milestone_date=p_milestone_date
   and public.creator_activity_actor_can_manage(n.creator_entity_id,'view');
$$;

grant execute on function public.create_creator_activity(uuid,text,date,time,text,text), public.update_creator_activity(uuid,text,date,time,text,text), public.list_my_creator_activities(date), public.list_creator_activity_calendar(date), public.update_creator_activity_lead_remark(uuid,text), public.upsert_creator_milestone_note(uuid,text,date,text), public.get_creator_milestone_note(uuid,text,date) to authenticated;
grant execute on function public.list_my_creator_entity_birthdays(uuid[]) to authenticated;
grant execute on function public.get_creator_entity_birthday(uuid) to authenticated;
revoke all on function public.creator_activity_actor_can_manage(uuid,text) from public;
revoke all on function public.list_my_creator_entity_birthdays(uuid[]) from public;
revoke all on function public.get_creator_entity_birthday(uuid) from public;
revoke all on function public.create_creator_activity(uuid,text,date,time,text,text) from public;
revoke all on function public.update_creator_activity(uuid,text,date,time,text,text) from public;
revoke all on function public.list_my_creator_activities(date) from public;
revoke all on function public.list_creator_activity_calendar(date) from public;
revoke all on function public.update_creator_activity_lead_remark(uuid,text) from public;
revoke all on function public.upsert_creator_milestone_note(uuid,text,date,text) from public;
revoke all on function public.get_creator_milestone_note(uuid,text,date) from public;
commit;
