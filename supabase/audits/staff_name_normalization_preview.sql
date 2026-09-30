-- READ-ONLY audit. Do not add DML statements to this file.
-- Run only after manual review and with read-only database credentials.
with employee_names as (
  select
    e.id as employee_id,
    e.employee_code as employee_number,
    e.full_name as current_employee_name,
    p.full_name as current_profile_name,
    (
      select string_agg(upper(left(lower(words.word), 1)) || substr(lower(words.word), 2), ' ' order by words.position)
      from unnest(string_to_array(regexp_replace(btrim(e.full_name), '\s+', ' ', 'g'), ' ')) with ordinality as words(word, position)
    ) as normalized_employee_name,
    case when p.id is not null then (
      select string_agg(upper(left(lower(words.word), 1)) || substr(lower(words.word), 2), ' ' order by words.position)
      from unnest(string_to_array(regexp_replace(btrim(p.full_name), '\s+', ' ', 'g'), ' ')) with ordinality as words(word, position)
    ) end as normalized_profile_name
  from public.employees e
  left join public.profiles p on p.id = e.profile_id
  where e.deleted_at is null
)
select
  employee_id,
  employee_number,
  current_employee_name,
  normalized_employee_name,
  current_profile_name,
  normalized_profile_name,
  current_profile_name is not null and current_employee_name = current_profile_name as employee_profile_name_match
from employee_names
where current_employee_name is distinct from normalized_employee_name
   or (current_profile_name is not null and current_profile_name is distinct from normalized_profile_name)
   or (current_profile_name is not null and current_employee_name is distinct from current_profile_name)
order by current_employee_name, employee_number;
