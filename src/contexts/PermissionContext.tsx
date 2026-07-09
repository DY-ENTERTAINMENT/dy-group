import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { permissionRuntimeService, type PermissionAction, type RuntimePermissions } from '../services/permission-runtime.service';
import type { PermissionState } from '../services/permission-management.service';
import { useAuth } from '../hooks/useAuth';

type PermissionContextValue = {
  loading: boolean;
  error: string;
  isSuperAdmin: boolean;
  runtime: RuntimePermissions | null;
  canView: (permissionKey: string) => boolean;
  canUse: (permissionKey: string) => boolean;
  hasPermission: (permissionKey: string, action: PermissionAction) => boolean;
  reloadPermissions: () => Promise<void>;
};

const emptyRuntime: RuntimePermissions = {
  role: null,
  permissions: {} as PermissionState,
};

const PermissionContext = createContext<PermissionContextValue | null>(null);

export function PermissionProvider({ children }: { children: ReactNode }) {
  const { profile, loading: authLoading } = useAuth();
  const [runtime, setRuntime] = useState<RuntimePermissions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;

    async function loadPermissions() {
      if (authLoading) {
        if (mounted) {
          setLoading(true);
        }
        return;
      }

      setLoading(true);
      setError('');

      try {
        const nextRuntime = await permissionRuntimeService.getRuntimePermissions(profile);
        if (mounted) {
          setRuntime(nextRuntime);
        }
      } catch (loadError) {
        console.error('Failed to load runtime permissions', loadError);
        if (mounted) {
          setRuntime({ role: profile?.role ?? null, permissions: {} });
          setError(getErrorMessage(loadError));
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void loadPermissions();

    return () => {
      mounted = false;
    };
  }, [authLoading, profile]);

  async function reloadPermissions() {
    setLoading(true);
    setError('');

    try {
      const nextRuntime = await permissionRuntimeService.getRuntimePermissions(profile);
      setRuntime(nextRuntime);
    } catch (loadError) {
      console.error('Failed to reload runtime permissions', loadError);
      setRuntime({ role: profile?.role ?? null, permissions: {} });
      setError(getErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }

  const value = useMemo<PermissionContextValue>(() => {
    const effectiveRuntime = runtime ?? emptyRuntime;

    return {
      loading,
      error,
      runtime: effectiveRuntime,
      isSuperAdmin: profile?.role === 'super_admin',
      canView: (permissionKey: string) => permissionRuntimeService.hasPermission(effectiveRuntime, permissionKey, 'view'),
      canUse: (permissionKey: string) => permissionRuntimeService.hasPermission(effectiveRuntime, permissionKey, 'use'),
      hasPermission: (permissionKey: string, action: PermissionAction) =>
        permissionRuntimeService.hasPermission(effectiveRuntime, permissionKey, action),
      reloadPermissions,
    };
  }, [error, loading, profile?.role, runtime]);

  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
}

export function usePermissionContext() {
  const context = useContext(PermissionContext);

  if (!context) {
    throw new Error('usePermissions must be used within PermissionProvider.');
  }

  return context;
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

  return '读取权限失败。';
}
