import React, { useEffect, useState } from 'react';
import api from '../services/api';
import { LeaveRequest } from '../types';

export function LeaveHistory() {
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ status: '', leave_type_id: '', from_date: '', to_date: '' });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadHistory();
  }, [page, filters]);

  const loadHistory = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: page.toString() });
      if (filters.status) params.set('status', filters.status);
      if (filters.leave_type_id) params.set('leave_type_id', filters.leave_type_id);
      if (filters.from_date) params.set('from_date', filters.from_date);
      if (filters.to_date) params.set('to_date', filters.to_date);

      const res = await api.get(`/leave-requests?${params}`);
      setRequests(res.data.requests);
      setTotal(res.data.total);
    } catch (error) {
      console.error('Error loading history:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async (id: string) => {
    if (!confirm('Are you sure you want to cancel this request?')) return;
    try {
      await api.patch(`/leave-requests/${id}/cancel`);
      loadHistory();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to cancel request');
    }
  };

  const getStatusBadge = (status: string) => {
    const classMap: Record<string, string> = {
      Pending: 'badge-pending',
      Approved: 'badge-approved',
      Rejected: 'badge-rejected',
      Cancelled: 'badge-cancelled',
    };
    return <span className={`badge ${classMap[status] || ''}`}>{status}</span>;
  };

  const totalPages = Math.ceil(total / 20);

  return (
    <div>
      <div className="header">
        <h1>Leave History</h1>
      </div>

      {/* Filters */}
      <div className="filters">
        <div className="form-group">
          <label>Status</label>
          <select value={filters.status} onChange={e => { setFilters(f => ({ ...f, status: e.target.value })); setPage(1); }}>
            <option value="">All</option>
            <option value="Pending">Pending</option>
            <option value="Approved">Approved</option>
            <option value="Rejected">Rejected</option>
            <option value="Cancelled">Cancelled</option>
          </select>
        </div>
        <div className="form-group">
          <label>From</label>
          <input type="date" value={filters.from_date} onChange={e => { setFilters(f => ({ ...f, from_date: e.target.value })); setPage(1); }} />
        </div>
        <div className="form-group">
          <label>To</label>
          <input type="date" value={filters.to_date} onChange={e => { setFilters(f => ({ ...f, to_date: e.target.value })); setPage(1); }} />
        </div>
      </div>

      <div className="card">
        {loading ? (
          <div className="loading"><div className="spinner"></div></div>
        ) : requests.length === 0 ? (
          <div className="empty-state"><p>No leave requests found</p></div>
        ) : (
          <>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Leave Type</th>
                    <th>From</th>
                    <th>To</th>
                    <th>Days</th>
                    <th>Status</th>
                    <th>Reason</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map(req => (
                    <tr key={req.id}>
                      <td>{req.leave_type_name}</td>
                      <td>{new Date(req.from_date).toLocaleDateString()}</td>
                      <td>{new Date(req.to_date).toLocaleDateString()}</td>
                      <td>{req.days_count}</td>
                      <td>{getStatusBadge(req.status)}</td>
                      <td title={req.reason}>{req.reason.substring(0, 50)}{req.reason.length > 50 ? '...' : ''}</td>
                      <td>
                        {req.status === 'Pending' && (
                          <button className="btn btn-danger btn-sm" onClick={() => handleCancel(req.id)}>
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="pagination">
                {Array.from({ length: totalPages }, (_, i) => (
                  <button
                    key={i + 1}
                    className={page === i + 1 ? 'active' : ''}
                    onClick={() => setPage(i + 1)}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
