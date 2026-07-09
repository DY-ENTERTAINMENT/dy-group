import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { AuthState } from '../types/auth';

type AuthContextValue = AuthState & {
  error: string;
  reloadProfile: () => Promise<void>;
};

const initialState: AuthState = {
  user: null,
  session: null,
  profile: null,
  loading: true,
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>(initialState);
  const [error, setError] = useState('');
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;

    void loadAuthState();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const requestId = ++requestIdRef.current;
      const user = session?.user ?? null;

      if (!user) {
        commitAuthState(requestId, {
          user: null,
          session,
          profile: null,
          loading: false,
        });
        return;
      }

      commitAuthState(requestId, {
        user,
        session,
        profile: null,
        loading: true,
      });

      window.setTimeout(() => {
        void loadProfileForSession(session, requestId);
      }, 0);
    });

    return () => {
      mountedRef.current = false;
      subscription.unsubscribe();
    };
  }, []);

  async function loadAuthState() {
    const requestId = ++requestIdRef.current;
    let session: Session | null = null;

    try {
      setError('');
      const { data, error: sessionError } = await supabase.auth.getSession();

      if (sessionError) {
        throw sessionError;
      }

      session = data.session;
      const user = session?.user ?? null;
      const profile = user ? await fetchProfile(user.id) : null;

      commitAuthState(requestId, {
        user,
        session,
        profile,
        loading: false,
      });
    } catch (loadError) {
      console.error('Failed to initialize auth state', loadError);
      if (mountedRef.current && requestId === requestIdRef.current) {
        setError(getErrorMessage(loadError));
      }
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setAuthState((current) => ({
          ...current,
          session,
          user: session?.user ?? current.user,
          loading: false,
        }));
      }
    }
  }

  async function loadProfileForSession(session: Session | null, requestId = ++requestIdRef.current) {
    const user = session?.user ?? null;

    try {
      setError('');
      const profile = user ? await fetchProfile(user.id) : null;

      commitAuthState(requestId, {
        user,
        session,
        profile,
        loading: false,
      });
    } catch (profileError) {
      console.error('Failed to load auth profile', profileError);
      if (mountedRef.current && requestId === requestIdRef.current) {
        setError(getErrorMessage(profileError));
      }
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setAuthState((current) => ({
          ...current,
          user,
          session,
          loading: false,
        }));
      }
    }
  }

  async function reloadProfile() {
    await loadProfileForSession(authState.session);
  }

  function commitAuthState(requestId: number, nextState: AuthState) {
    if (!mountedRef.current || requestId !== requestIdRef.current) {
      return;
    }

    setAuthState(nextState);
  }

  return (
    <AuthContext.Provider value={{ ...authState, error, reloadProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthContext() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within AuthProvider.');
  }

  return context;
}

async function fetchProfile(userId: string) {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;

    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }

  return '读取登录状态失败。';
}
