import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { Dashboard } from './pages/Dashboard';
import { LeaveApplicationForm } from './pages/LeaveApplicationForm';
import { LeaveHistory } from './pages/LeaveHistory';
import { HolidayCalendar } from './pages/HolidayCalendar';
import { ProfilePage } from './pages/ProfilePage';
import { PendingApprovals } from './pages/manager/PendingApprovals';
import { TeamCalendar } from './pages/manager/TeamCalendar';
import { TeamHistory } from './pages/manager/TeamHistory';
import { EmployeeManagement } from './pages/admin/EmployeeManagement';
import { LeaveTypeConfig } from './pages/admin/LeaveTypeConfig';
import { HolidayManagement } from './pages/admin/HolidayManagement';
import { AllLeaveRequests } from './pages/admin/AllLeaveRequests';
import { Reports } from './pages/admin/Reports';

// The backend allows Admin into every manager endpoint; the UI now matches, so an
// Admin acting as someone's reporting manager can actually approve their leave.
const MANAGER_ROLES = ['Manager', 'Admin'] as const;
const STAFF_ROLES = ['Employee', 'Manager', 'Admin'] as const;

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          {/* Sits outside Layout but still requires a session. */}
          <Route
            path="/change-password"
            element={<ProtectedRoute><ChangePasswordPage /></ProtectedRoute>}
          />

          <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="profile" element={<ProfilePage />} />

            {/* Personal leave — available to every role, including Admin. */}
            <Route path="leave/apply" element={<ProtectedRoute allowedRoles={[...STAFF_ROLES]}><LeaveApplicationForm /></ProtectedRoute>} />
            <Route path="leave/history" element={<ProtectedRoute allowedRoles={[...STAFF_ROLES]}><LeaveHistory /></ProtectedRoute>} />
            <Route path="holidays" element={<HolidayCalendar />} />

            {/* Team management */}
            <Route path="manager/pending" element={<ProtectedRoute allowedRoles={[...MANAGER_ROLES]}><PendingApprovals /></ProtectedRoute>} />
            <Route path="manager/team-calendar" element={<ProtectedRoute allowedRoles={[...MANAGER_ROLES]}><TeamCalendar /></ProtectedRoute>} />
            <Route path="manager/team-history" element={<ProtectedRoute allowedRoles={[...MANAGER_ROLES]}><TeamHistory /></ProtectedRoute>} />

            {/* Administration */}
            <Route path="admin/employees" element={<ProtectedRoute allowedRoles={['Admin']}><EmployeeManagement /></ProtectedRoute>} />
            <Route path="admin/leave-types" element={<ProtectedRoute allowedRoles={['Admin']}><LeaveTypeConfig /></ProtectedRoute>} />
            <Route path="admin/holidays" element={<ProtectedRoute allowedRoles={['Admin']}><HolidayManagement /></ProtectedRoute>} />
            <Route path="admin/leave-requests" element={<ProtectedRoute allowedRoles={['Admin']}><AllLeaveRequests /></ProtectedRoute>} />
            <Route path="admin/reports" element={<ProtectedRoute allowedRoles={['Admin']}><Reports /></ProtectedRoute>} />
          </Route>

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
