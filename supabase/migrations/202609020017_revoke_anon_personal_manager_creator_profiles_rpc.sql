revoke execute
on function public.list_personal_manager_creator_profiles(text)
from anon;

revoke all
on function public.list_personal_manager_creator_profiles(text)
from public;
