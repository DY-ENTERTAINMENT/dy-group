import type { Session, User } from '@supabase/supabase-js';
import type { Profile } from './database';

export type EmployeeAccess = 'allowed' | 'disabled';

export type AuthState = {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  employeeAccess: EmployeeAccess | null;
  loading: boolean;
};
