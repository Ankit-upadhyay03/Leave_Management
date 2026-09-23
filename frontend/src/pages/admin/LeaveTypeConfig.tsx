import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import { LeaveType } from '../../types';

export function LeaveTypeConfig() {
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<LeaveType | null>(null);
  const [formData, setFormData] = useState({ name: '', yearly_allocation: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadLeaveTypes();
  }, []);

  const loadLeaveTypes = async () => {
    try {
      const res = await api.get('/admin/leave-types');
      setLeaveTypes(res.data);
    } catch (error) {
      console.error('Error loading leave types:', error);
    } finally {
      setLoading(false);
    }
  };

  const openAdd = () => {
    setEditing(null);
    setFormData({ name: '', yearly_allocation: '' });
    setError('');
    setShowModal(true);
  };

  const openEdit = (lt: LeaveType) => {
    setEditing(lt);
    setFormData({ name: lt.name, yearly_allocation: lt.yearly_allocation.toString() });
    setError('');
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const payload = { name: formData.name, yearly_allocation: parseFloat(formData.yearly_allocation) };

    try {
      if (editing) {
        await api.put(`/admin/leave-types/${editing.id}`, payload);
      } else {
        await api.post('/admin/leave-types', payload);
      }
      setShowModal(false);
      loadLeaveTypes();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Operation failed');
    }
  };

  const handleDeactivate = async (id: string) => {
    if (!confirm('Deactivating will reject all pending requests for this type. Continue?')) return;
    try {
      await api.patch(`/admin/leave-types/${id}/deactivate`);
      loadLeaveTypes();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to deactivate');
    }
  };

  const handleReactivate = async (id: string) => {
    try {
      await api.patch(`/admin/leave-types/${id}/reactivate`);
      loadLeaveTypes();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to reactivate');
    }
  };

  if (loading) return <div className="loading"><div className="spinner"></div></div>;

  return (
    <div>
      <div className="header">
        <h1>Leave Type Configuration</h1>
        <button className="btn btn-primary" onClick={openAdd}>Add Leave Type</button>
      </div>

      <div className="card">
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Yearly Allocation</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {leaveTypes.map(lt => (
                <tr key={lt.id}>
                  <td>{lt.name}</td>
                  <td>{lt.yearly_allocation} days</td>
                  <td>
                    <span className={`badge ${lt.is_active ? 'badge-approved' : 'badge-cancelled'}`}>
                      {lt.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-outline btn-sm" onClick={() => openEdit(lt)}>Edit</button>
                      {lt.is_active ? (
                        <button className="btn btn-danger btn-sm" onClick={() => handleDeactivate(lt.id)}>Deactivate</button>
                      ) : (
                        <button className="btn btn-success btn-sm" onClick={() => handleReactivate(lt.id)}>Reactivate</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>{editing ? 'Edit Leave Type' : 'Add Leave Type'}</h2>
            {error && <div className="alert alert-error">{error}</div>}
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Name * (1-100 characters)</label>
                <input value={formData.name} onChange={e => setFormData(f => ({ ...f, name: e.target.value }))} maxLength={100} required />
              </div>
              <div className="form-group">
                <label>Yearly Allocation * (0.5-365, in 0.5 increments)</label>
                <input type="number" step="0.5" min="0.5" max="365" value={formData.yearly_allocation} onChange={e => setFormData(f => ({ ...f, yearly_allocation: e.target.value }))} required />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">{editing ? 'Update' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
