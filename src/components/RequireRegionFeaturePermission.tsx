import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { usePermissions } from '../hooks/usePermissions';
import type { PermissionAction, RegionFeaturePermissionKey } from '../services/permission-runtime.service';

type RequireRegionFeaturePermissionProps = {
  permissionKey: RegionFeaturePermissionKey;
  action?: PermissionAction;
  children: ReactNode;
};

export function RequireRegionFeaturePermission({
  permissionKey,
  action = 'view',
  children,
}: RequireRegionFeaturePermissionProps) {
  const permissions = usePermissions();

  if (permissions.loading) {
    return <div className="route-loading">正在检查权限...</div>;
  }

  if (!permissions.hasRegionFeaturePermission(permissionKey, action)) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
