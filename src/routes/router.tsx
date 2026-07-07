import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppLayout } from '../layouts/AppLayout';
import { AuthLayout } from '../layouts/AuthLayout';
import { RequireAuth } from '../components/RequireAuth';
import { DashboardPage } from '../pages/DashboardPage';
import { SchedulePage } from '../pages/SchedulePage';
import { StaffPage } from '../pages/StaffPage';
import { AttendancePage } from '../pages/AttendancePage';
import { AttendanceManagementPage } from '../pages/AttendanceManagementPage';
import { LeavePage } from '../pages/LeavePage';
import { LeaveReviewPage } from '../pages/LeaveReviewPage';
import { RestPlanningPage } from '../pages/RestPlanningPage';
import { PublicHolidayPage } from '../pages/PublicHolidayPage';
import { ItineraryPage } from '../pages/ItineraryPage';
import { ProfilePage } from '../pages/ProfilePage';
import { SettingsPage } from '../pages/SettingsPage';
import { LoginPage } from '../pages/LoginPage';
import { RegisterPage } from '../pages/RegisterPage';
import { ForgotPasswordPage } from '../pages/ForgotPasswordPage';
import { ResetPasswordPage } from '../pages/ResetPasswordPage';
import { RegisterReviewPage } from '../pages/RegisterReviewPage';
import { RegistrationReviewPage } from '../pages/RegistrationReviewPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { getMenuPath } from './menu';
import { RequireRole } from '../components/RequireRole';
import { RequirePermission } from '../components/RequirePermission';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          {
            index: true,
            element: <Navigate to="/dashboard" replace />,
          },
          {
            path: 'dashboard',
            element: <DashboardPage />,
          },
          {
            path: 'schedule',
            element: <SchedulePage />,
          },
          {
            path: getMenuPath('staff'),
            element: (
              <RequirePermission permissionKey="staff">
                <StaffPage />
              </RequirePermission>
            ),
          },
          {
            path: getMenuPath('registration-review'),
            element: (
              <RequirePermission permissionKey="registration-review">
                <RegistrationReviewPage />
              </RequirePermission>
            ),
          },
          {
            path: getMenuPath('leave-review'),
            element: (
              <RequirePermission permissionKey="leave-review">
                <LeaveReviewPage />
              </RequirePermission>
            ),
          },
          {
            path: getMenuPath('attendance-management'),
            element: (
              <RequirePermission permissionKey="attendance-management">
                <AttendanceManagementPage />
              </RequirePermission>
            ),
          },
          {
            path: getMenuPath('public-holidays'),
            element: (
              <RequirePermission permissionKey="public-holidays">
                <PublicHolidayPage />
              </RequirePermission>
            ),
          },
          {
            path: 'attendance',
            element: <AttendancePage />,
          },
          {
            path: 'leave',
            element: <LeavePage />,
          },
          {
            path: 'itinerary',
            element: <ItineraryPage />,
          },
          {
            path: 'rest-planning',
            element: <RestPlanningPage />,
          },
          {
            path: 'profile',
            element: <ProfilePage />,
          },
          {
            path: 'settings',
            element: (
              <RequireRole allowedRoles={['super_admin']}>
                <SettingsPage />
              </RequireRole>
            ),
          },
        ],
      },
    ],
  },
  {
    element: <AuthLayout />,
    children: [
      {
        path: '/login',
        element: <LoginPage />,
      },
      {
        path: '/register',
        element: <RegisterPage />,
      },
      {
        path: '/forgot-password',
        element: <ForgotPasswordPage />,
      },
      {
        path: '/reset-password',
        element: <ResetPasswordPage />,
      },
      {
        path: '/register-review',
        element: <RegisterReviewPage />,
      },
    ],
  },
  {
    path: '*',
    element: <NotFoundPage />,
  },
]);
