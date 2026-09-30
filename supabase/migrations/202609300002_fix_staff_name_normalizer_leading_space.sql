begin;

create or replace function public.normalize_employee_full_name(value text)
returns text
language plpgsql
immutable
as $$
declare
  normalized_value text := regexp_replace(btrim(coalesce(value, '')), '\s+', ' ', 'g');
  word text;
  normalized_word text;
begin
  if normalized_value = '' then
    raise exception '工作人员姓名不能为空';
  end if;

  -- concat_ws ignores NULL, but not an empty string. Starting from NULL prevents a leading delimiter.
  normalized_value := null;
  foreach word in array string_to_array(regexp_replace(btrim(coalesce(value, '')), '\s+', ' ', 'g'), ' ')
  loop
    normalized_word := lower(word);
    normalized_value := concat_ws(' ', normalized_value, upper(left(normalized_word, 1)) || substr(normalized_word, 2));
  end loop;

  return normalized_value;
end;
$$;

revoke all on function public.normalize_employee_full_name(text) from public;

commit;
