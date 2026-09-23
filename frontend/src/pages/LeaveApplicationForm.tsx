import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { DatePicker } from '../components/DatePicker';

interface LeaveTypeBalance {
  leave_type_id: string;
  leave_type_name: string;
  balance: number;
}

export function LeaveApplicationForm() {
  const navigate = useNavigate();
  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeBalance[]>([]);
  const [holidays, setHolidays] = useState<string[]>([]);
  const [holidayNames, setHolidayNames] = useState<Record<string, string>>({});
  const [formData, setFormData] = useState({
    leave_type_id: '',
    from_date: '',
    to_date: '',
    is_half_day: false,
    reason: '',
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const today = new Date().toISOString().split('T')[0];

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [balRes, holRes] = await Promise.all([
        api.get('/leave-balances'),
        api.get('/holidays'),
      ]);
      setLeaveTypes(balRes.data.map((b: any) => ({
        leave_type_id: b.leave_type_id,
        leave_type_name: b.leave_type_name,
        balance: parseFloat(b.balance),
      })));

      const hols = holRes.data || [];
      setHolidays(hols.map((h: any) => h.holiday_date.split('T')[0]));
      const nameMap: Record<string, string> = {};
      hols.forEach((h: any) => { nameMap[h.holiday_date.split('T')[0]] = h.name; });
      setHolidayNames(nameMap);
    } catch (err) {
      console.error('Error loading data:', err);
    }
  };

  const selectedBalance = leaveTypes.find(lt => lt.leave_type_id === formData.leave_type_id)?.balance || 0;

  // Calculate exact max To Date: count forward from From Date, skipping weekends and holidays
  const getMaxToDate = () => {
    if (!formData.from_date || !selectedBalance) return '';
    
    const holidaySet = new Set(holidays);
    let workingDaysLeft = selectedBalance;
    const current = new Date(formData.from_date);
    
    while (workingDaysLeft > 0) {
      const dayOfWeek = current.getDay();
      const dateStr = current.toISOString().split('T')[0];
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const isHoliday = holidaySet.has(dateStr);
      
      if (!isWeekend && !isHoliday) {
        workingDaysLeft--;
      }
      if (workingDaysLeft > 0) {
        current.setDate(current.getDate() + 1);
      }
    }
    
    return current.toISOString().split('T')[0];
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      await api.post('/leave-requests', formData);
      setSuccess('Leave request submitted successfully! 🎉');
      setFormData({ leave_type_id: '', from_date: '', to_date: '', is_half_day: false, reason: '' });
      setTimeout(() => navigate('/leave/history'), 1500);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to submit leave request');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="header">
        <h1>Apply for Leave</h1>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 24 }}>
        {/* Form */}
        <div className="card">
          {error && <div className="alert alert-error">{error}</div>}
          {success && <div className="alert alert-success">{success}</div>}

          <form onSubmit={handleSubmit}>
            {/* Leave Type */}
            <div className="form-group">
              <label>Leave Type *</label>
              <select
                value={formData.leave_type_id}
                onChange={e => setFormData(f => ({ ...f, leave_type_id: e.target.value }))}
                required
              >
                <option value="">Select Leave Type</option>
                {leaveTypes.map(lt => (
                  <option key={lt.leave_type_id} value={lt.leave_type_id} disabled={lt.balance <= 0}>
                    {lt.leave_type_name} — {lt.balance} days available
                  </option>
                ))}
              </select>
              {formData.leave_type_id && (
                <div style={{ marginTop: 6, fontSize: '0.85rem', color: selectedBalance > 0 ? '#10b981' : '#ef4444', fontWeight: 600 }}>
                  Available: {selectedBalance} days
                </div>
              )}
            </div>

            {/* Half Day */}
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={formData.is_half_day}
                  onChange={e => {
                    const checked = e.target.checked;
                    setFormData(f => ({ ...f, is_half_day: checked, to_date: checked ? f.from_date : f.to_date }));
                  }}
                />
                Half Day Leave (0.5 day)
              </label>
            </div>

            {/* Date Selection with Custom Calendar */}
            <div className="form-row">
              <div className="form-group">
                <label>From Date *</label>
                <DatePicker
                  value={formData.from_date}
                  onChange={date => setFormData(f => ({ ...f, from_date: date, to_date: f.is_half_day ? date : f.to_date }))}
                  min={today}
                  holidays={holidays}
                  holidayNames={holidayNames}
                  placeholder="Select from date"
                />
              </div>
              <div className="form-group">
                <label>To Date *</label>
                <DatePicker
                  value={formData.is_half_day ? formData.from_date : formData.to_date}
                  onChange={date => setFormData(f => ({ ...f, to_date: date }))}
                  min={formData.from_date || today}
                  max={getMaxToDate() || undefined}
                  holidays={holidays}
                  holidayNames={holidayNames}
                  disabled={formData.is_half_day}
                  placeholder="Select to date"
                />
                {formData.is_half_day && (
                  <small style={{ color: '#666' }}>Same as From Date (half day)</small>
                )}
              </div>
            </div>

            {/* Info about selected dates */}
            {formData.from_date && formData.to_date && (
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, padding: '10px 14px', marginBottom: 16, fontSize: '0.85rem', color: '#166534' }}>
                ℹ️ Weekends (Sat/Sun) and company holidays within this range will <strong>not</strong> be counted as leave days.
              </div>
            )}

            {/* Reason */}
            <div className="form-group">
              <label>Reason * (1-500 characters)</label>
              <textarea
                value={formData.reason}
                onChange={e => setFormData(f => ({ ...f, reason: e.target.value }))}
                rows={4}
                maxLength={500}
                required
                placeholder="Please provide a reason for your leave..."
              />
              <small style={{ color: '#999' }}>{formData.reason.length}/500</small>
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading || selectedBalance <= 0 || !formData.from_date || !formData.to_date}
              style={{ width: '100%', padding: '12px' }}
            >
              {loading ? 'Submitting...' : 'Submit Leave Request'}
            </button>
          </form>
        </div>

        {/* Right sidebar - Balance Info */}
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '1rem' }}>📊 My Leave Balance</h3>
            {leaveTypes.map(lt => (
              <div key={lt.leave_type_id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f5f5f5' }}>
                <span style={{ fontSize: '0.88rem' }}>{lt.leave_type_name}</span>
                <span style={{ fontWeight: 700, color: lt.balance > 0 ? '#10b981' : '#ef4444' }}>{lt.balance} days</span>
              </div>
            ))}
          </div>

          <div className="card">
            <h3 style={{ margin: '0 0 12px', fontSize: '1rem' }}>💡 Guidelines</h3>
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: '0.82rem', color: '#555', lineHeight: 1.8 }}>
              <li>Weekends & holidays are auto-excluded</li>
              <li>Cannot apply on dates with existing requests</li>
              <li>Half-day: From & To date must be same</li>
              <li>Ensure sufficient balance before applying</li>
              <li><span style={{ color: '#dc2626' }}>🔴 Red dates</span> = Company Holiday</li>
              <li><span style={{ color: '#9ca3af' }}>Grey dates</span> = Weekend</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
