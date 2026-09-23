import React from 'react';
import { useAuth } from '../context/AuthContext';
import { AdminDashboard } from './dashboards/AdminDashboard';
import { ManagerDashboard } from './dashboards/ManagerDashboard';
import { EmployeeDashboard } from './dashboards/EmployeeDashboard';

export function Dashboard() {
  const { user } = useAuth();

  if (user?.role === 'Admin') return <AdminDashboard />;
  if (user?.role === 'Manager') return <ManagerDashboard />;
  return <EmployeeDashboard />;
}
