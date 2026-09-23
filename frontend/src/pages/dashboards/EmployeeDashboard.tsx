import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';
import {
  SparkPulse, SparkBars, SparkWave,
  LeaveTypePill, StatusPill, formatRange, StatTile,
} from './dashboardUI';

export function EmployeeDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [balances, setBalances] = useState<any[]>([]);
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [recentRequests, setRecentRequests] = useState<any[]>([]);
  const [approvedCount, setApprovedCount] = useState(0);
  const [upcomingHolidays, setUpcomingHolidays] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [balanceRes, pendingRes, approvedRes, allRes, holidaysRes] = await Promise.all([
        api.get('/leave-balances'),
        api.get('/leave-requests?status=Pending'),
        api.get('/leave-requests?status=Approved'),
        api.get('/leave-requests'),
        api.get('/holidays'),
      ]);

      const pending = pendingRes.data.requests || [];
      setPendingRequests(pending);

      const approved = approvedRes.data.requests || [];
      setApprovedCount(approved.length);

      const all = allRes.data.requests || [];
      setRecentRequests(all.slice(0, 5));

      const usedMap: Record<string, number> = {};
      approved.forEach((r: any) => {
        const ltId = r.leave_type_id;
        usedMap[ltId] = (usedMap[ltId] || 0) + parseFloat(r.days_count);
      });

      setBalances(balanceRes.data.map((b: any) => ({
        ...b,
        balance: parseFloat(b.balance),
        used: usedMap[b.leave_type_id] || 0,
        total: parseFloat(b.balance) + (usedMap[b.leave_type_id] || 0),
      })));

      const today = new Date();
      const upcoming = (holidaysRes.data || []).filter((h: any) => new Date(h.holiday_date) >= today).slice(0, 5);
      setUpcomingHolidays(upcoming);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async (id: string) => {
    if (!confirm('Cancel this leave request?')) return;
    try { await api.patch(`/leave-requests/${id}/cancel`); loadData(); }
    catch (err: any) { alert(err.response?.data?.message || 'Failed'); }
  };

  if (loading) return <div className="loading"><div className="spinner"></div></div>;

  const totalAvailable = balances.reduce((s, b) => s + b.balance, 0);
  const tiles: StatTile[] = [
    { key: 'avail', value: totalAvailable, label: 'Days Available', accent: 'green', spark: <SparkBars color="#10b981" /> },
    { key: 'pend', value: pendingRequests.length, label: 'Pending Requests', accent: 'amber', spark: <SparkPulse color="#f59e0b" /> },
    { key: 'appr', value: approvedCount, label: 'Approved Leaves', accent: 'blue', spark: <SparkWave color="#0ea5e9" /> },
    { key: 'hol', value: upcomingHolidays.length, label: 'Upcoming Holidays', accent: 'purple', spark: <SparkBars color="#8b5cf6" />, to: '/holidays' },
  ];

  return (
    <div className="dash">
      {/* Header */}
      <div className="dash-header">
        <div>
          <h1>Welcome back, {user?.name?.split(' ')[0]} 👋</h1>
          <p className="subtitle">Here's your leave overview</p>
        </div>
        <div className="dash-controls">
          <button className="qa-btn primary" onClick={() => navigate('/leave/apply')}>
            <span aria-hidden="true">＋</span> Apply Leave
          </button>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="dash-stats" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
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

      {/* Balance cards */}
      <div className="dash-section">
        <div className="dash-section-head">
          <h3><span aria-hidden="true">📊</span> Leave Balances</h3>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
          {balances.map(b => {
            const pct = b.total > 0 ? (b.used / b.total) * 100 : 0;
            return (
              <div key={b.leave_type_id} style={{ border: '1px solid #eef0f4', borderRadius: 12, padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <LeaveTypePill name={b.leave_type_name} />
                  <span style={{ fontWeight: 700, fontSize: '1.3rem', color: '#1e293b' }}>{b.balance}</span>
                </div>
                <div style={{ background: '#f1f5f9', borderRadius: 10, height: 7, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, background: '#10b981', height: '100%', borderRadius: 10 }} />
                </div>
                <div style={{ fontSize: '0.74rem', color: '#94a3b8', marginTop: 6, display: 'flex', justifyContent: 'space-between' }}>
                  <span>Used {b.used}</span>
                  <span>Allocated {b.total}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20 }}>
        <div>
          {/* Pending Requests */}
          {pendingRequests.length > 0 && (
            <div className="dash-section">
              <div className="dash-section-head">
                <h3><span aria-hidden="true">⏳</span> Pending Requests</h3>
              </div>
              <div className="table-container">
                <table className="req-table">
                  <thead>
                    <tr>
                      <th>TYPE</th><th>PERIOD</th><th>DAYS</th><th>REASON</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingRequests.map(req => (
                      <tr key={req.id}>
                        <td><LeaveTypePill name={req.leave_type_name} /></td>
                        <td>{formatRange(req.from_date, req.to_date)}</td>
                        <td style={{ fontWeight: 700, color: '#1e293b' }}>{Number(req.days_count).toFixed(1)}</td>
                        <td style={{ color: '#64748b' }}>{req.reason?.substring(0, 30)}</td>
                        <td>
                          <button
                            className="qa-btn"
                            onClick={() => handleCancel(req.id)}
                            style={{ height: 30, padding: '0 12px', background: '#fee2e2', borderColor: '#fecaca', color: '#b91c1c' }}
                          >
                            Cancel
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Recent history */}
          <div className="dash-section">
            <div className="dash-section-head">
              <h3><span aria-hidden="true">📋</span> Recent Leave Applications</h3>
              <button className="pill-btn" onClick={() => navigate('/leave/history')}>View All →</button>
            </div>
            {recentRequests.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 30, color: '#94a3b8' }}>No leave applications yet</div>
            ) : (
              <div className="table-container">
                <table className="req-table">
                  <thead>
                    <tr>
                      <th>STATUS</th><th>LEAVE TYPE</th><th>PERIOD</th><th>DAYS</th><th>REASON</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentRequests.map(req => (
                      <tr key={req.id}>
                        <td><StatusPill status={req.status} /></td>
                        <td><LeaveTypePill name={req.leave_type_name} /></td>
                        <td>{formatRange(req.from_date, req.to_date)}</td>
                        <td style={{ fontWeight: 700, color: '#1e293b' }}>{Number(req.days_count).toFixed(1)}</td>
                        <td style={{ color: '#64748b' }}>
                          {req.reason?.substring(0, 25)}{req.reason?.length > 25 ? '…' : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Upcoming holidays */}
        <div className="dash-section">
          <div className="dash-section-head">
            <h3><span aria-hidden="true">🗓️</span> Upcoming Holidays</h3>
            <button className="pill-btn" onClick={() => navigate('/holidays')}>All</button>
          </div>
          {upcomingHolidays.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 20, color: '#94a3b8', fontSize: '0.9rem' }}>No upcoming holidays</div>
          ) : (
            <div>
              {upcomingHolidays.map(h => {
                const d = new Date(h.holiday_date);
                const monthNames = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
                return (
                  <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
                    <div style={{
                      background: '#f5f3ff', borderRadius: 10, width: 46, height: 46,
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                    }}>
                      <span style={{ fontSize: '0.62rem', color: '#8b5cf6', fontWeight: 700 }}>{monthNames[d.getMonth()]}</span>
                      <span style={{ fontSize: '1.05rem', fontWeight: 700, color: '#1e293b', lineHeight: 1 }}>{d.getDate()}</span>
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#1e293b' }}>{h.name}</div>
                      <div style={{ fontSize: '0.76rem', color: '#94a3b8' }}>{d.toLocaleDateString('en-IN', { weekday: 'long' })}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
