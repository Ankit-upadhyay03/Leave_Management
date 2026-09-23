import React, { useEffect, useState } from 'react';
import api from '../../services/api';

interface TeamMember {
  id: string;
  employee_code: string;
  name: string;
  is_active: boolean;
}

export function TeamHistory() {
  const [requests, setRequests] = useState<any[]>([]);
  const [balances, setBalances] = useState<any[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [filters, setFilters] = useState({ employee_id: '', status: '', from_date: '', to_date: '' });
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // Team roster drives the employee filter, so it only needs loading once.
  useEffect(() => {
    api.get('/manager/team')
      .then(res => setTeam(res.data))
      .catch(err => console.error('Error loading team:', err));
  }, []);

  useEffect(() => { loadTeamHistory(); }, [filters, page]);

  const loadTeamHistory = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (filters.employee_id) params.set('employee_id', filters.employee_id);
      if (filters.status) params.set('status', filters.status);
      if (filters.from_date) params.set('from_date', filters.from_date);
      if (filters.to_date) params.set('to_date', filters.to_date);

      const { data } = await api.get(`/manager/team-history?${params}`);
      setRequests(data.requests || []);
      setBalances(data.balances || []);
      setTotal(data.total ?? 0);
      setTotalPages(data.totalPages ?? 1);
    } catch (error) {
      console.error('Error loading team history:', error);
    } finally {
      setLoading(false);
    }
  };

  // Changing a filter must reset to page 1, or a page-3 filter shows an empty table.
  const updateFilter = (patch: Partial<typeof filters>) => {
    setFilters(f => ({ ...f, ...patch }));
    setPage(1);
  };

  const statusColor = (status: string) => {
    const map: Record<string, string> = {
      Pending: '#f59e0b', Approved: '#10b981', Rejected: '#ef4444', Cancelled: '#6b7280',
    };
    return map[status] || '#6b7280';
  };

  // Group balances by employee for a compact per-person summary.
  const balancesByEmployee = balances.reduce((acc: Record<string, any[]>, b) => {
    (acc[b.employee_name] ||= []).push(b);
    return acc;
  }, {});

  return (
    <div>
      <div className="header">
        <h1>Team Leave History</h1>
      </div>

      <div className="filters">
        <div className="form-group">
          <label>Employee</label>
          <select value={filters.employee_id} onChange={e => updateFilter({ employee_id: e.target.value })}>
            <option value="">All Team Members</option>
            {team.map(m => (
              <option key={m.id} value={m.id}>
                {m.name}{m.employee_code ? ` (${m.employee_code})` : ''}{!m.is_active ? ' — inactive' : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label>Status</label>
          <select value={filters.status} onChange={e => updateFilter({ status: e.target.value })}>
            <option value="">All</option>
            <option value="Pending">Pending</option>
            <option value="Approved">Approved</option>
            <option value="Rejected">Rejected</option>
            <option value="Cancelled">Cancelled</option>
          </select>
        </div>
        <div className="form-group">
          <label>From</label>
          <input type="date" value={filters.from_date} onChange={e => updateFilter({ from_date: e.target.value })} />
        </div>
        <div className="form-group">
          <label>To</label>
          <input type="date" value={filters.to_date} onChange={e => updateFilter({ to_date: e.target.value })} />
        </div>
      </div>

      {Object.keys(balancesByEmployee).length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Team Leave Balances</h3>
          <div className="table-container">
            <table>
              <thead>
                <tr><th>Employee</th><th>Leave Type</th><th>Available</th><th>Allocated</th></tr>
              </thead>
              <tbody>
                {Object.entries(balancesByEmployee).map(([name, rows]) =>
                  rows.map((b, i) => (
                    <tr key={`${name}-${b.leave_type_name}`}>
                      {i === 0 && <td rowSpan={rows.length} style={{ fontWeight: 600, verticalAlign: 'top' }}>{name}</td>}
                      <td>{b.leave_type_name}</td>
                      <td style={{ fontWeight: 600, color: parseFloat(b.balance) > 0 ? '#10b981' : '#ef4444' }}>
                        {b.balance}
                      </td>
                      <td style={{ color: '#888' }}>{b.yearly_allocation}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <div style={{ marginBottom: 12, color: '#666', fontSize: '0.88rem' }}>
          {total} request{total === 1 ? '' : 's'} found
        </div>

        {loading ? (
          <div className="loading"><div className="spinner"></div></div>
        ) : requests.length === 0 ? (
          <div className="empty-state"><p>No leave requests found for the selected filters</p></div>
        ) : (
          <>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Employee</th><th>Leave Type</th><th>From</th><th>To</th>
                    <th>Days</th><th>Status</th><th>Reason</th><th>Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map(req => (
                    <tr key={req.id}>
                      <td>
                        <strong>{req.employee_name}</strong>
                        {req.employee_code && (
                          <div style={{ fontSize: '0.75rem', color: '#999' }}>{req.employee_code}</div>
                        )}
                      </td>
                      <td>{req.leave_type_name}</td>
                      <td>{new Date(req.from_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })}</td>
                      <td>{new Date(req.to_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })}</td>
                      <td style={{ fontWeight: 600 }}>{req.days_count}</td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor(req.status) }} />
                          <span style={{ fontSize: '0.82rem', color: statusColor(req.status), fontWeight: 500 }}>{req.status}</span>
                        </span>
                      </td>
                      <td title={req.reason} style={{ fontSize: '0.82rem', color: '#555', maxWidth: 160 }}>
                        {req.reason?.slice(0, 30)}{(req.reason?.length || 0) > 30 ? '…' : ''}
                      </td>
                      <td title={req.manager_remarks || ''} style={{ fontSize: '0.82rem', color: '#555', maxWidth: 160 }}>
                        {req.manager_remarks ? `${req.manager_remarks.slice(0, 30)}${req.manager_remarks.length > 30 ? '…' : ''}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="pagination">
                <button disabled={page === 1} onClick={() => setPage(p => p - 1)}>‹ Prev</button>
                {Array.from({ length: totalPages }, (_, i) => (
                  <button key={i + 1} className={page === i + 1 ? 'active' : ''} onClick={() => setPage(i + 1)}>
                    {i + 1}
                  </button>
                ))}
                <button disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next ›</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
