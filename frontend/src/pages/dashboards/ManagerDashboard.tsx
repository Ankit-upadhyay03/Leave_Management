import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';
import {
  SparkPulse, SparkBars, SparkWave, SparkLine,
  Avatar, LeaveTypePill, formatRange, StatTile,
} from './dashboardUI';

export function ManagerDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [stats, setStats] = useState({ pending: 0, approvedThisMonth: 0, teamMembers: 0, onLeaveToday: 0, upcoming: 0 });
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [pendingRes, calendarRes, historyRes] = await Promise.all([
        api.get('/manager/pending-requests'),
        api.get('/manager/team-calendar'),
        api.get('/manager/team-history'),
      ]);

      const pending = pendingRes.data;
      setPendingRequests(pending);

      const today = new Date().toISOString().split('T')[0];
      const onLeave = calendarRes.data.filter((l: any) => l.from_date <= today && l.to_date >= today);
      const teamBalances = historyRes.data.balances || [];
      const uniqueMembers = new Set(teamBalances.map((b: any) => b.employee_name));

      setStats({
        pending: pending.length,
        approvedThisMonth: calendarRes.data.length,
        teamMembers: uniqueMembers.size,
        onLeaveToday: onLeave.length,
        upcoming: calendarRes.data.length,
      });
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (id: string) => {
    if (actionLoading) return;
    setActionLoading(id);
    try {
      await api.patch(`/manager/requests/${id}/approve`);
      setPendingRequests(prev => prev.filter(r => r.id !== id));
      loadData();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to approve');
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) return <div className="loading"><div className="spinner"></div></div>;

  const tiles: StatTile[] = [
    { key: 'pend', value: stats.pending, label: 'Pending Requests', accent: 'amber', spark: <SparkPulse color="#f59e0b" />, to: '/manager/pending' },
    { key: 'appr', value: stats.approvedThisMonth, label: 'Approved This Month', accent: 'green', spark: <SparkBars color="#10b981" /> },
    { key: 'team', value: stats.teamMembers, label: 'Team Members', accent: 'indigo', spark: <SparkWave color="#6366f1" /> },
    { key: 'today', value: stats.onLeaveToday, label: 'On Leave Today', accent: 'red', spark: <SparkLine color="#ef4444" /> },
    { key: 'up', value: stats.upcoming, label: 'Upcoming Leaves', accent: 'purple', spark: <SparkBars color="#8b5cf6" />, to: '/manager/team-calendar' },
  ];

  return (
    <div className="dash">
      {/* Header */}
      <div className="dash-header">
        <div>
          <h1>Manager Dashboard</h1>
          <p className="subtitle">Hi {user?.name?.split(' ')[0]}, manage your team's leaves</p>
        </div>
        <div className="dash-controls">
          <button className="qa-btn primary" onClick={() => navigate('/leave/apply')}>
            <span aria-hidden="true">＋</span> My Leave
          </button>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="dash-stats">
        {tiles.map(t => (
          <div
            key={t.key}
            className={`stat-tile accent-${t.accent}`}
            onClick={() => t.to && navigate(t.to)}
            style={{ cursor: t.to ? 'pointer' : 'default' }}
          >
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
          <button className="qa-btn primary" onClick={() => navigate('/manager/pending')}>
            <span aria-hidden="true">⏳</span> Review Approvals
          </button>
          <button className="qa-btn" onClick={() => navigate('/manager/team-calendar')}>
            <span aria-hidden="true">👥</span> Team Calendar
          </button>
          <button className="qa-btn" onClick={() => navigate('/manager/team-history')}>
            <span aria-hidden="true">📊</span> Team History
          </button>
          <button className="qa-btn" onClick={() => navigate('/leave/history')}>
            <span aria-hidden="true">🕐</span> My Leaves
          </button>
        </div>
      </div>

      {/* Pending Leave Requests */}
      <div className="dash-section">
        <div className="dash-section-head">
          <h3><span aria-hidden="true">⏳</span> Pending Leave Requests</h3>
          <button className="pill-btn" onClick={() => navigate('/manager/pending')}>View All →</button>
        </div>

        {pendingRequests.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 34, color: '#94a3b8' }}>
            <div style={{ fontSize: '2rem', marginBottom: 6 }}>✅</div>
            No pending requests. All caught up!
          </div>
        ) : (
          <div className="table-container">
            <table className="req-table">
              <thead>
                <tr>
                  <th>EMPLOYEE</th>
                  <th>LEAVE TYPE</th>
                  <th>DATES</th>
                  <th>DAYS</th>
                  <th>REASON</th>
                  <th>BALANCE</th>
                  <th>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {pendingRequests.slice(0, 7).map(req => (
                  <tr key={req.id}>
                    <td><Avatar name={req.employee_name} /></td>
                    <td><LeaveTypePill name={req.leave_type_name} /></td>
                    <td>{formatRange(req.from_date, req.to_date)}</td>
                    <td style={{ fontWeight: 700, color: '#1e293b' }}>{Number(req.days_count).toFixed(1)}</td>
                    <td style={{ maxWidth: 160, color: '#64748b' }}>{req.reason?.substring(0, 30)}</td>
                    <td style={{ fontWeight: 700, color: '#059669' }}>{req.current_balance}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          className="qa-btn"
                          onClick={() => handleApprove(req.id)}
                          disabled={actionLoading === req.id}
                          style={{ height: 32, padding: '0 12px', background: '#dcfce7', borderColor: '#bbf7d0', color: '#15803d' }}
                        >
                          {actionLoading === req.id ? '…' : '✓ Approve'}
                        </button>
                        <button
                          className="qa-btn"
                          onClick={() => navigate('/manager/pending')}
                          style={{ height: 32, padding: '0 12px', background: '#fee2e2', borderColor: '#fecaca', color: '#b91c1c' }}
                        >
                          ✗ Reject
                        </button>
                      </div>
                    </td>
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
