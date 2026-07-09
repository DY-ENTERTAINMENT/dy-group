import { usePermissionContext } from '../contexts/PermissionContext';

export function usePermissions() {
  return usePermissionContext();
}
