import React, { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../services/api';
import { LeaveRequest } from '../../types';

export function PendingApprovals() {
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [rejectModal, setRejectModal] = useState<{ open: boolean; requestId: string | null }>({ open: false, requestId: null });
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState('');

  // Approval emails link here as /manager/pending?request=<id>.
  const [searchParams] = useSearchParams();
  const highlightId = searchParams.get('request');
  const highlightRef = useRef<HTMLTableRowElement | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => { loadPendingRequests(); }, []);

  // Scroll the linked request into view once the list has rendered.
  useEffect(() => {
    if (loading || !highlightId) return;

    if (requests.some(r => r.id === highlightId)) {
      highlightRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      // Already actioned by someone else, or not this manager's to approve.
      setNotFound(true);
    }
  }, [loading, highlightId, requests]);

  const loadPendingRequests = async () => {
    try {
      const res = await api.get('/manager/pending-requests');
      setRequests(res.data);
    } catch (error) {
      console.error('Error loading pending requests:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (id: string) => {
    if (actionLoading) return;
    setActionLoading(id);
    // Immediately remove from UI
    setRequests(prev => prev.filter(r => r.id !== id));
    try {
      await api.patch(`/manager/requests/${id}/approve`);
    } catch (err: any) {
      // If failed, reload the list
      alert(err.response?.data?.message || 'Failed to approve request');
      loadPendingRequests();
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async () => {
    if (!rejectModal.requestId) return;
    if (!remarks || remarks.length < 1) {
      setError('Remarks are required');
      return;
    }

    const requestId = rejectModal.requestId;
    setRejectModal({ open: false, requestId: null });
    // Immediately remove from UI
    setRequests(prev => prev.filter(r => r.id !== requestId));

    try {
      await api.patch(`/manager/requests/${requestId}/reject`, { remarks });
      setRemarks('');
      setError('');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to reject request');
      loadPendingRequests();
    }
  };

  if (loading) return <div className="loading"><div className="spinner"></div></div>;

  return (
    <div>
      <div className="header">
        <h1>Pending Approvals ({requests.length})</h1>
      </div>

      {/* Explains why an emailed link didn't land on a specific row. */}
      {notFound && (
        <div className="alert alert-info" style={{ marginBottom: 16 }}>
          The request from your email link is no longer pending — it may have already been
          approved, rejected, or cancelled.
        </div>
      )}

      {requests.length === 0 ? (
        <div className="card">
          <div style={{ textAlign: 'center', padding: 50 }}>
            <div style={{ fontSize: '3rem', marginBottom: 12 }}>✅</div>
            <p style={{ color: '#666', fontSize: '1.1rem' }}>No pending leave requests. All caught up!</p>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Leave Type</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Days</th>
                  <th>Reason</th>
                  <th>Balance</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {requests.map(req => {
                  const isHighlighted = req.id === highlightId;
                  return (
                  <tr
                    key={req.id}
                    ref={isHighlighted ? highlightRef : null}
                    style={{
                      transition: 'all 0.3s',
                      background: isHighlighted ? '#fffbea' : undefined,
                      boxShadow: isHighlighted ? 'inset 3px 0 0 #f59e0b' : undefined,
                    }}
                  >
                    <td>
                      <strong>{req.employee_name}</strong>
                      {isHighlighted && (
                        <span style={{ marginLeft: 6, fontSize: '0.7rem', background: '#f59e0b', color: '#fff', padding: '1px 6px', borderRadius: 8, verticalAlign: 'middle' }}>
                          from email
                        </span>
                      )}
                    </td>
                    <td>
                      <span style={{ background: '#fef3c7', color: '#92400e', padding: '3px 8px', borderRadius: 4, fontSize: '0.8rem' }}>
                        {req.leave_type_name}
                      </span>
                    </td>
                    <td>{new Date(req.from_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</td>
                    <td>{new Date(req.to_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</td>
                    <td style={{ fontWeight: 600 }}>{req.days_count}</td>
                    <td title={req.reason} style={{ maxWidth: 180, fontSize: '0.85rem', color: '#555' }}>{req.reason?.substring(0, 40)}{(req.reason?.length || 0) > 40 ? '...' : ''}</td>
                    <td style={{ fontWeight: 600, color: '#10b981' }}>{req.current_balance}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          onClick={() => handleApprove(req.id)}
                          disabled={actionLoading === req.id}
                          style={{
                            background: '#10b981', color: '#fff', border: '2px solid #10b981',
                            borderRadius: 6, padding: '6px 14px', fontSize: '0.82rem',
                            cursor: 'pointer', fontWeight: 600, transition: 'all 0.2s',
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.color = '#10b981'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = '#10b981'; e.currentTarget.style.color = '#fff'; }}
                        >
                          {actionLoading === req.id ? '...' : '✓ Approve'}
                        </button>
                        <button
                          onClick={() => setRejectModal({ open: true, requestId: req.id })}
                          style={{
                            background: '#ef4444', color: '#fff', border: '2px solid #ef4444',
                            borderRadius: 6, padding: '6px 14px', fontSize: '0.82rem',
                            cursor: 'pointer', fontWeight: 600, transition: 'all 0.2s',
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.color = '#ef4444'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = '#ef4444'; e.currentTarget.style.color = '#fff'; }}
                        >
                          ✗ Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {rejectModal.open && (
        <div className="modal-overlay" onClick={() => setRejectModal({ open: false, requestId: null })}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Reject Leave Request</h2>
            {error && <div className="alert alert-error">{error}</div>}
            <div className="form-group">
              <label>Remarks * (why are you rejecting?)</label>
              <textarea
                value={remarks}
                onChange={e => setRemarks(e.target.value)}
                rows={4}
                maxLength={500}
                placeholder="e.g. Insufficient team availability during this period"
                autoFocus
              />
              <small style={{ color: '#999' }}>{remarks.length}/500</small>
            </div>
            <div className="modal-actions">
              <button className="btn btn-outline" onClick={() => { setRejectModal({ open: false, requestId: null }); setRemarks(''); setError(''); }}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                onClick={handleReject}
                style={{ transition: 'all 0.2s' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.border = '2px solid #ef4444'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#ef4444'; e.currentTarget.style.color = '#fff'; e.currentTarget.style.border = '2px solid #ef4444'; }}
              >
                Reject Request
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
