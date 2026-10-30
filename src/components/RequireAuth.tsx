import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export function RequireAuth() {
  const location = useLocation();
  const { user, profile, employeeAccess, loading } = useAuth();
  const localDesignerMock = import.meta.env.DEV && ['127.0.0.1', 'localhost'].includes(window.location.hostname) && location.pathname === '/management/designer' && new URLSearchParams(location.search).get('mock') === 'designer';
  if (localDesignerMock) return <Outlet />;

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
