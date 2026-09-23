import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import {
  SparkLine, SparkWave, SparkPulse, SparkBars,
  Avatar, LeaveTypePill, StatusPill, formatRange,
} from './dashboardUI';

export function AdminDashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    totalEmployees: 0, managers: 0, pendingRequests: 0, leaveTypes: 0, holidays: 0,
  });
  const [recentRequests, setRecentRequests] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const monthLabel = useMemo(
    () => new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    []
  );

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [empRes, ltRes, reqRes, holRes] = await Promise.all([
        api.get('/admin/employees'),
        api.get('/admin/leave-types'),
        api.get('/admin/leave-requests?status=Pending'),
        api.get('/holidays'),
      ]);

      const employees = empRes.data;
      setStats({
        totalEmployees: employees.filter((e: any) => e.is_active).length,
        managers: employees.filter((e: any) => (e.role === 'Manager' || e.role === 'Admin') && e.is_active).length,
        pendingRequests: reqRes.data.total || 0,
        leaveTypes: ltRes.data.filter((lt: any) => lt.is_active).length,
        holidays: holRes.data.length,
      });
      setRecentRequests(reqRes.data.requests || []);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredRequests = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? recentRequests.filter((r: any) =>
          (r.employee_name || '').toLowerCase().includes(q) ||
          (r.department_name || '').toLowerCase().includes(q) ||
          (r.leave_type_name || '').toLowerCase().includes(q))
      : recentRequests;
    return list.slice(0, 6);
  }, [recentRequests, search]);

  if (loading) return <div className="loading"><div className="spinner"></div></div>;

  const tiles = [
    { key: 'emp', value: stats.totalEmployees, label: 'Total Employees', accent: 'indigo', color: '#6366f1', spark: <SparkLine color="#6366f1" />, to: '/admin/employees' },
    { key: 'mgr', value: stats.managers, label: 'Managers', accent: 'blue', color: '#0ea5e9', spark: <SparkWave color="#0ea5e9" />, to: '/admin/employees' },
    { key: 'pend', value: stats.pendingRequests, label: 'Pending Requests', accent: 'amber', color: '#f59e0b', spark: <SparkPulse color="#f59e0b" />, to: '/admin/leave-requests' },
    { key: 'lt', value: stats.leaveTypes, label: 'Leave Types', accent: 'green', color: '#10b981', spark: <SparkBars color="#10b981" />, to: '/admin/leave-types' },
    { key: 'hol', value: stats.holidays, label: 'Holidays', accent: 'purple', color: '#8b5cf6', spark: <SparkBars color="#8b5cf6" />, to: '/admin/holidays' },
  ];

  return (
    <div className="dash">
      {/* Header */}
      <div className="dash-header">
        <div>
          <h1>Admin Dashboard</h1>
          <p className="subtitle">System overview &amp; management</p>
        </div>
        <div className="dash-controls">
          <div className="dash-control">
            <span aria-hidden="true">📅</span>
            <span>{monthLabel}</span>
          </div>
          <div className="dash-control search">
            <span aria-hidden="true">🔍</span>
            <input
              placeholder="Search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              aria-label="Search pending requests"
            />
          </div>
          <div className="dash-control">
            <select
              defaultValue=""
              aria-label="User settings"
              onChange={e => {
                const v = e.target.value;
                if (v === 'password') navigate('/change-password');
                else if (v === 'employees') navigate('/admin/employees');
                e.currentTarget.value = '';
              }}
            >
              <option value="" disabled>User settings</option>
              <option value="password">Change Password</option>
              <option value="employees">User Management</option>
            </select>
          </div>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="dash-stats">
        {tiles.map(t => (
          <div key={t.key} className={`stat-tile accent-${t.accent}`} onClick={() => navigate(t.to)}>
            <div className="stat-top">
              <div className="stat-value">{t.value}</div>
              {t.spark}
            </div>
            <div className="stat-label">{t.label}</div>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="dash-section">
        <div className="dash-section-head">
          <h3><span aria-hidden="true">⚡</span> Quick Actions</h3>
        </div>
        <div className="qa-row">
          <button className="qa-btn primary" onClick={() => navigate('/admin/employees')}>
            <span aria-hidden="true">＋</span> Add Employee
          </button>
          <button className="qa-btn" onClick={() => navigate('/admin/leave-types')}>
            <span aria-hidden="true">⚙️</span> Configure Leave Types
          </button>
          <button className="qa-btn" onClick={() => navigate('/admin/holidays')}>
            <span aria-hidden="true">🗓️</span> Manage Holidays
          </button>
          <button className="qa-btn" onClick={() => navigate('/admin/leave-requests')}>
            <span aria-hidden="true">📋</span> View All Requests
          </button>
          <button className="qa-btn" onClick={() => navigate('/admin/reports')}>
            <span aria-hidden="true">📈</span> Generate Reports
          </button>
        </div>
      </div>

      {/* Pending Leave Requests */}
      <div className="dash-section">
        <div className="dash-section-head">
          <h3><span aria-hidden="true">📄</span> Pending Leave Requests</h3>
          <button className="pill-btn" onClick={() => navigate('/admin/leave-requests')}>View All →</button>
        </div>

        {filteredRequests.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 34, color: '#94a3b8' }}>
            {search ? 'No requests match your search.' : 'No pending requests ✓'}
          </div>
        ) : (
          <div className="table-container">
            <table className="req-table">
              <thead>
                <tr>
                  <th>EMPLOYEE</th>
                  <th>DEPARTMENT</th>
                  <th>LEAVE TYPE</th>
                  <th>DATES</th>
                  <th>DAYS</th>
                  <th>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {filteredRequests.map((req: any) => (
                  <tr key={req.id}>
                    <td><Avatar name={req.employee_name} /></td>
                    <td>{req.department_name || '—'}</td>
                    <td><LeaveTypePill name={req.leave_type_name} /></td>
                    <td>{formatRange(req.from_date, req.to_date)}</td>
                    <td style={{ fontWeight: 700, color: '#1e293b' }}>
                      {Number(req.days_count).toFixed(1)}
                    </td>
                    <td><StatusPill status={req.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
