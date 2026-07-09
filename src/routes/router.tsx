import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppLayout } from '../layouts/AppLayout';
import { AuthLayout } from '../layouts/AuthLayout';
import { RequireAuth } from '../components/RequireAuth';
import { DashboardPage } from '../pages/DashboardPage';
import { SchedulePage } from '../pages/SchedulePage';
import { StaffPage } from '../pages/StaffPage';
import { AttendancePage } from '../pages/AttendancePage';
import { AttendanceLocationPage } from '../pages/AttendanceLocationPage';
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
import { ScoutPage } from '../pages/ScoutPage';
import { AgentPage } from '../pages/AgentPage';
import { DesignerPage } from '../pages/DesignerPage';
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
            path: getMenuPath('attendance-locations'),
            element: (
              <RequirePermission permissionKey="attendance-locations">
                <AttendanceLocationPage />
              </RequirePermission>
            ),
          },
          {
            path: getMenuPath('agent-revenue-data'),
            element: (
              <RequirePermission permissionKey="agent-revenue-data">
                <AgentPage mode="revenue" />
              </RequirePermission>
            ),
          },
          {
            path: getMenuPath('agent-creator-data'),
            element: (
              <RequirePermission permissionKey="agent-creator-data">
                <AgentPage mode="creators" />
              </RequirePermission>
            ),
          },
          {
            path: getMenuPath('agent-adjustment-requests'),
            element: (
              <RequirePermission permissionKey="agent-adjustment-requests">
                <AgentPage mode="adjustments" />
              </RequirePermission>
            ),
          },
          {
            path: getMenuPath('agent-design-requests'),
            element: (
              <RequirePermission permissionKey="agent-design-requests">
                <AgentPage mode="design-requests" />
              </RequirePermission>
            ),
          },
          {
            path: getMenuPath('designer-intake'),
            element: (
              <RequirePermission permissionKey="designer-intake">
                <DesignerPage mode="intake" />
              </RequirePermission>
            ),
          },
          {
            path: getMenuPath('designer-progress'),
            element: (
              <RequirePermission permissionKey="designer-progress">
                <DesignerPage mode="progress" />
              </RequirePermission>
            ),
          },
          {
            path: getMenuPath('scout-recruiting-data'),
            element: (
              <RequirePermission permissionKey="scout-recruiting-data">
                <ScoutPage mode="personal-recruiting" />
              </RequirePermission>
            ),
          },
          {
            path: getMenuPath('scout-recruit-list'),
            element: (
              <RequirePermission permissionKey="scout-recruit-list">
                <ScoutPage mode="recruit-list" />
              </RequirePermission>
            ),
          },
          {
            path: getMenuPath('scout-onboarding'),
            element: (
              <RequirePermission permissionKey="scout-onboarding">
                <ScoutPage mode="onboarding" />
              </RequirePermission>
            ),
          },
          {
            path: getMenuPath('scout-streamer-stats'),
            element: (
              <RequirePermission permissionKey="scout-streamer-stats">
                <ScoutPage mode="personal-streamers" />
              </RequirePermission>
            ),
          },
          {
            path: getMenuPath('management-revenue-data'),
            element: (
              <RequirePermission permissionKey="management-revenue-data">
                <AgentPage mode="management-revenue" />
              </RequirePermission>
            ),
          },
          {
            path: getMenuPath('management-streamer-stats'),
            element: (
              <RequirePermission permissionKey="management-streamer-stats">
                <ScoutPage mode="management-streamers" />
              </RequirePermission>
            ),
          },
          {
            path: getMenuPath('management-recruiting-data'),
            element: (
              <RequirePermission permissionKey="management-recruiting-data">
                <ScoutPage mode="management-recruiting" />
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

