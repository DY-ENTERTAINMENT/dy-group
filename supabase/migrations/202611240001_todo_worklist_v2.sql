begin;
set local lock_timeout = '5s';

-- Fail before DDL if any intended object name or column already exists.
do $$
declare
  v_conflicts text;
begin
  select string_agg(name, ', ' order by name) into v_conflicts from (
    select 'relation ' || c.relname as name
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = any (array[
      'todo_categories_v2', 'todo_categories_v2_pkey', 'todo_categories_v2_id_profile_id_key',
      'todo_subtasks_v2', 'todo_subtasks_v2_pkey', 'todo_worklist_v2_revisions',
      'todo_worklist_v2_revisions_pkey', 'todo_items_category_v2_idx',
      'todo_subtasks_v2_todo_idx', 'todo_items_id_profile_v2_unique'
    ])
    union all
    select 'type ' || t.typname
    from pg_catalog.pg_type t join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = any (array[
      'todo_categories_v2', 'todo_subtasks_v2', 'todo_worklist_v2_revisions'
    ])
    union all
    select 'function ' || p.proname
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (array[
      'lock_todo_worklist_v2', 'bump_todo_worklist_v2_revision',
      'get_todo_worklist_v2_revision', 'apply_todo_v2_changes'
    ])
    union all
    select 'todo_items column ' || a.attname
    from pg_catalog.pg_attribute a
    where a.attrelid = 'public.todo_items'::regclass and a.attnum > 0 and not a.attisdropped
      and a.attname = any (array['category_v2_id','sort_v2','outer_order_v2','priority_v2','note_v2'])
    union all
    select 'todo_items constraint ' || c.conname
    from pg_catalog.pg_constraint c where c.conrelid = 'public.todo_items'::regclass
      and c.conname = any (array['todo_items_id_profile_v2_unique','todo_items_category_owner_v2_fk'])
    union all
    select 'todo_items trigger ' || t.tgname
    from pg_catalog.pg_trigger t where t.tgrelid = 'public.todo_items'::regclass and not t.tgisinternal
      and t.tgname = any (array['todo_items_v2_lock','todo_items_v2_revision'])
  ) conflicts;
  if v_conflicts is not null then
    raise exception 'Worklist V2 naming conflict: %', v_conflicts;
  end if;
end;
$$;

create table public.todo_categories_v2 (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  color text not null default '#8b6bdc' check (color ~ '^#[0-9a-fA-F]{6}$'),
  outer_order integer,
  created_at timestamptz not null default now(),
  unique (id, profile_id)
);
alter table public.todo_categories_v2 enable row level security;
create policy "Users manage own todo categories v2" on public.todo_categories_v2 for all to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());
revoke all on public.todo_categories_v2 from public, anon, authenticated;
grant select, insert, update, delete on public.todo_categories_v2 to authenticated;

alter table public.todo_items
  add column category_v2_id uuid,
  add column sort_v2 integer,
  add column outer_order_v2 integer,
  add column priority_v2 text not null default '普通' check (priority_v2 in ('普通', '高', '低')),
  add column note_v2 text not null default '';
alter table public.todo_items add constraint todo_items_id_profile_v2_unique unique (id, profile_id);
alter table public.todo_items add constraint todo_items_category_owner_v2_fk foreign key (category_v2_id, profile_id) references public.todo_categories_v2 (id, profile_id);
create index todo_items_category_v2_idx on public.todo_items (profile_id, category_v2_id, sort_v2);

create table public.todo_subtasks_v2 (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  todo_id uuid not null,
  title text not null check (length(btrim(title)) > 0),
  is_completed boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  foreign key (todo_id, profile_id) references public.todo_items (id, profile_id) on delete cascade
);
create index todo_subtasks_v2_todo_idx on public.todo_subtasks_v2 (profile_id, todo_id, sort_order);
alter table public.todo_subtasks_v2 enable row level security;
create policy "Users manage own todo subtasks v2" on public.todo_subtasks_v2 for all to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());
revoke all on public.todo_subtasks_v2 from public, anon, authenticated;
grant select, insert, update, delete on public.todo_subtasks_v2 to authenticated;


-- All worklist DML paths take the same transaction lock before touching rows.
-- This includes legacy writes and recurring-task inserts, not only the V2 RPC.
create function public.lock_todo_worklist_v2() returns trigger
language plpgsql security invoker set search_path = pg_catalog as $$
declare v_deadline timestamptz;
begin
  -- Bounded wait without changing the caller's session or transaction settings.
  v_deadline := clock_timestamp() + interval '5 seconds';
  loop
    exit when pg_try_advisory_xact_lock(7192401, 1);
    if clock_timestamp() >= v_deadline then
      raise exception 'WORKLIST_V2_LOCK_TIMEOUT: 工作清单繁忙，请刷新或重试' using errcode = '55P03';
    end if;
    perform pg_sleep(0.05);
  end loop;
  return null;
end;
$$;
revoke all on function public.lock_todo_worklist_v2() from public, anon, authenticated;
create trigger todo_items_v2_lock before insert or update or delete on public.todo_items for each statement execute function public.lock_todo_worklist_v2();
create trigger todo_categories_v2_lock before insert or update or delete on public.todo_categories_v2 for each statement execute function public.lock_todo_worklist_v2();
create trigger todo_subtasks_v2_lock before insert or update or delete on public.todo_subtasks_v2 for each statement execute function public.lock_todo_worklist_v2();

-- A per-employee revision detects concurrent writes, including writes by the legacy UI.
create table public.todo_worklist_v2_revisions (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  revision bigint not null default 0
);
alter table public.todo_worklist_v2_revisions enable row level security;
create policy "Users read own todo v2 revision" on public.todo_worklist_v2_revisions for select to authenticated using (profile_id = auth.uid());
revoke all on public.todo_worklist_v2_revisions from public, anon, authenticated;
grant select on public.todo_worklist_v2_revisions to authenticated;

create function public.bump_todo_worklist_v2_revision() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare owner_id uuid;
begin
  -- The statement-level lock is already held before any worklist row is touched.
  for owner_id in
    select distinct x from unnest(array[
      case when tg_op <> 'INSERT' then old.profile_id else null end,
      case when tg_op <> 'DELETE' then new.profile_id else null end
    ]) x where x is not null order by x
  loop
    -- A cascading profile deletion must not recreate a revision for a deleted owner.
    if exists (select 1 from public.profiles where id = owner_id) then
      insert into public.todo_worklist_v2_revisions(profile_id, revision) values (owner_id, 1)
      on conflict (profile_id) do update set revision = todo_worklist_v2_revisions.revision + 1;
    end if;
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.bump_todo_worklist_v2_revision() from public, anon, authenticated;
create trigger todo_items_v2_revision after insert or update or delete on public.todo_items for each row execute function public.bump_todo_worklist_v2_revision();
create trigger todo_categories_v2_revision after insert or update or delete on public.todo_categories_v2 for each row execute function public.bump_todo_worklist_v2_revision();
create trigger todo_subtasks_v2_revision after insert or update or delete on public.todo_subtasks_v2 for each row execute function public.bump_todo_worklist_v2_revision();

create function public.get_todo_worklist_v2_revision() returns text
language sql volatile security invoker set search_path = pg_catalog, public as $$
  select coalesce((select revision::text from public.todo_worklist_v2_revisions where profile_id = auth.uid()), '0');
$$;
revoke all on function public.get_todo_worklist_v2_revision() from public, anon;
grant execute on function public.get_todo_worklist_v2_revision() to authenticated;

-- Invoker rights preserve the existing todo RLS. Each request contains only changed
-- records/fields; a failed operation rolls back the entire move or reorder.
create function public.apply_todo_v2_changes(p_changes jsonb, p_revision text) returns text
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v jsonb;
  v_id uuid;
  n integer;
  v_revision text;
  v_deadline timestamptz;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(p_changes) <> 'object' then raise exception 'Invalid changes'; end if;
  -- Bounded wait without changing the caller's session or transaction settings.
  v_deadline := clock_timestamp() + interval '5 seconds';
  loop
    exit when pg_try_advisory_xact_lock(7192401, 1);
    if clock_timestamp() >= v_deadline then
      raise exception 'WORKLIST_V2_LOCK_TIMEOUT: 工作清单繁忙，请刷新或重试' using errcode = '55P03';
    end if;
    perform pg_sleep(0.05);
  end loop;
  select public.get_todo_worklist_v2_revision() into v_revision;
  if p_revision is null or p_revision <> v_revision then
    raise exception 'WORKLIST_V2_CONFLICT: 工作清单已在其他窗口更新，请刷新后重试' using errcode = '40001';
  end if;

  for v in select value from jsonb_array_elements(coalesce(p_changes->'categories', '[]'::jsonb)) loop
    v_id := (v->>'id')::uuid;
    if coalesce((v->>'new')::boolean, false) then
      insert into public.todo_categories_v2(id, profile_id, name, color, outer_order)
      values (v_id, v_user, v->>'name', v->>'color', (v->>'outer_order')::integer);
    else
      update public.todo_categories_v2 set
        name = case when v ? 'name' then v->>'name' else name end,
        color = case when v ? 'color' then v->>'color' else color end,
        outer_order = case when v ? 'outer_order' then (v->>'outer_order')::integer else outer_order end
      where id = v_id and profile_id = v_user;
      get diagnostics n = row_count; if n <> 1 then raise exception 'Category not found'; end if;
    end if;
  end loop;

  for v in select value from jsonb_array_elements(coalesce(p_changes->'tasks', '[]'::jsonb)) loop
    v_id := (v->>'id')::uuid;
    if coalesce((v->>'new')::boolean, false) then
      insert into public.todo_items(id, profile_id, title, due_date, is_completed, completed_at, category_v2_id, sort_v2, outer_order_v2, priority_v2, note_v2)
      values (v_id, v_user, v->>'title', (v->>'date')::date, coalesce((v->>'done')::boolean,false), case when (v->>'done')::boolean then now() else null end, (v->>'category')::uuid, (v->>'sort')::integer, (v->>'outer_order')::integer, v->>'priority', v->>'note');
    else
      update public.todo_items set
        title = case when v ? 'title' then v->>'title' else title end,
        due_date = case when v ? 'date' then (v->>'date')::date else due_date end,
        category_v2_id = case when v ? 'category' then (v->>'category')::uuid else category_v2_id end,
        sort_v2 = case when v ? 'sort' then (v->>'sort')::integer else sort_v2 end,
        outer_order_v2 = case when v ? 'outer_order' then (v->>'outer_order')::integer else outer_order_v2 end,
        priority_v2 = case when v ? 'priority' then v->>'priority' else priority_v2 end,
        note_v2 = case when v ? 'note' then v->>'note' else note_v2 end,
        completed_at = case when v ? 'done' and (v->>'done')::boolean is distinct from is_completed then case when (v->>'done')::boolean then now() else null end else completed_at end,
        is_completed = case when v ? 'done' then (v->>'done')::boolean else is_completed end
      where id = v_id and profile_id = v_user;
      get diagnostics n = row_count; if n <> 1 then raise exception 'Task not found'; end if;
    end if;
  end loop;

  for v in select value from jsonb_array_elements(coalesce(p_changes->'subtasks', '[]'::jsonb)) loop
    v_id := (v->>'id')::uuid;
    if coalesce((v->>'new')::boolean, false) then
      insert into public.todo_subtasks_v2(id, profile_id, todo_id, title, is_completed, sort_order)
      values (v_id, v_user, (v->>'task_id')::uuid, v->>'title', (v->>'done')::boolean, (v->>'sort')::integer);
    else
      update public.todo_subtasks_v2 set
        title = case when v ? 'title' then v->>'title' else title end,
        is_completed = case when v ? 'done' then (v->>'done')::boolean else is_completed end,
        sort_order = case when v ? 'sort' then (v->>'sort')::integer else sort_order end
      where id = v_id and profile_id = v_user;
      get diagnostics n = row_count; if n <> 1 then raise exception 'Subtask not found'; end if;
    end if;
  end loop;
  for v in select value from jsonb_array_elements(coalesce(p_changes->'delete_subtasks', '[]'::jsonb)) loop
    delete from public.todo_subtasks_v2 where id = (v #>> '{}')::uuid and profile_id = v_user;
    get diagnostics n = row_count; if n <> 1 then raise exception 'Subtask not found'; end if;
  end loop;
  for v in select value from jsonb_array_elements(coalesce(p_changes->'delete_tasks', '[]'::jsonb)) loop
    delete from public.todo_items where id = (v #>> '{}')::uuid and profile_id = v_user;
    get diagnostics n = row_count; if n <> 1 then raise exception 'Task not found'; end if;
  end loop;
  for v in select value from jsonb_array_elements(coalesce(p_changes->'delete_categories', '[]'::jsonb)) loop
    delete from public.todo_categories_v2 where id = (v #>> '{}')::uuid and profile_id = v_user;
    get diagnostics n = row_count; if n <> 1 then raise exception 'Category not found'; end if;
  end loop;
  return public.get_todo_worklist_v2_revision();
end;
$$;
revoke all on function public.apply_todo_v2_changes(jsonb, text) from public, anon;
grant execute on function public.apply_todo_v2_changes(jsonb, text) to authenticated;
commit;
