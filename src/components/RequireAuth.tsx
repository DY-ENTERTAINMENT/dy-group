import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export function RequireAuth() {
  const location = useLocation();
  const { user, profile, employeeAccess, loading } = useAuth();

  if (loading) {
    return <div className="route-loading">正在加载系统...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (profile?.status !== 'approved' || employeeAccess !== 'allowed') {
    return <Navigate to="/login" replace state={{ accountDisabled: true }} />;
  }

  return <Outlet />;
}
