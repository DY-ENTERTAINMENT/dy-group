import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { usePermissions } from '../hooks/usePermissions';

type RequirePermissionProps = {
  permissionKey: string;
  action?: 'view' | 'use';
  children: ReactNode;
};

export function RequirePermission({ permissionKey, action = 'view', children }: RequirePermissionProps) {
  const permissions = usePermissions();
  const location = useLocation();
  const localDesignerMock = permissionKey === 'management-designer' && import.meta.env.DEV && ['127.0.0.1', 'localhost'].includes(window.location.hostname) && location.pathname === '/management/designer' && new URLSearchParams(location.search).get('mock') === 'designer';
  if (localDesignerMock) return children;

  if (permissions.loading) {
    return <div className="route-loading">正在检查权限...</div>;
  }

  if (!permissions.hasPermission(permissionKey, action)) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
