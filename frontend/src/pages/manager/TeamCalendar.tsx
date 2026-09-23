import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import { LeaveRequest } from '../../types';

const COLORS = ['#e3f2fd', '#fce4ec', '#e8f5e9', '#fff3e0', '#f3e5f5', '#e0f2f1', '#fff9c4'];

export function TeamCalendar() {
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);
  // The date whose leave details are shown in the popup (null = closed).
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    loadTeamCalendar();
  }, [month, year]);

  const loadTeamCalendar = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/manager/team-calendar?month=${month}&year=${year}`);
      setLeaves(res.data);
    } catch (error) {
      console.error('Error loading team calendar:', error);
    } finally {
      setLoading(false);
    }
  };

  const getDaysInMonth = (m: number, y: number) => new Date(y, m, 0).getDate();
  const getFirstDayOfMonth = (m: number, y: number) => new Date(y, m - 1, 1).getDay();

  const dateStrFor = (day: number) =>
    `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  const leavesOnDate = (dateStr: string) =>
    leaves.filter(l => l.from_date <= dateStr && l.to_date >= dateStr);

  const isLeaveOnDay = (day: number) => leavesOnDate(dateStrFor(day));

  const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June', 
    'July', 'August', 'September', 'October', 'November', 'December'];

  // Human-friendly heading for the popup, e.g. "15 August 2026 (Saturday)".
  const prettyDate = (dateStr: string) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    const weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dt.getDay()];
    return `${d} ${monthNames[m]} ${y} (${weekday})`;
  };

  const selectedLeaves = selectedDate ? leavesOnDate(selectedDate) : [];

  const daysInMonth = getDaysInMonth(month, year);
  const firstDay = getFirstDayOfMonth(month, year);

  // Map employees to colors
  const employeeColors: Record<string, string> = {};
  leaves.forEach((l, i) => {
    if (!employeeColors[l.employee_name || '']) {
      employeeColors[l.employee_name || ''] = COLORS[Object.keys(employeeColors).length % COLORS.length];
    }
  });

  return (
    <div>
      <div className="header">
        <h1>Team Leave Calendar</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-outline btn-sm" onClick={() => {
            if (month === 1) { setMonth(12); setYear(y => y - 1); }
            else setMonth(m => m - 1);
          }}>←</button>
          <span style={{ fontWeight: 600, minWidth: 140, textAlign: 'center' }}>{monthNames[month]} {year}</span>
          <button className="btn btn-outline btn-sm" onClick={() => {
            if (month === 12) { setMonth(1); setYear(y => y + 1); }
            else setMonth(m => m + 1);
          }}>→</button>
        </div>
      </div>

      {/* Legend */}
      {Object.keys(employeeColors).length > 0 && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
          {Object.entries(employeeColors).map(([name, color]) => (
            <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 16, height: 16, borderRadius: 3, background: color, border: '1px solid #ddd' }}></div>
              <span style={{ fontSize: '0.85rem' }}>{name}</span>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="loading"><div className="spinner"></div></div>
      ) : (
        <div className="card">
          {leaves.length === 0 ? (
            <div className="empty-state"><p>No team leaves scheduled for this period</p></div>
          ) : (
            <div className="calendar-grid">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                <div key={d} className="calendar-header">{d}</div>
              ))}
              {Array.from({ length: firstDay }).map((_, i) => (
                <div key={`empty-${i}`} className="calendar-day" style={{ background: '#fafafa' }}></div>
              ))}
              {Array.from({ length: daysInMonth }, (_, i) => {
                const day = i + 1;
                const dayLeaves = isLeaveOnDay(day);
                const hasLeaves = dayLeaves.length > 0;
                return (
                  <div
                    key={day}
                    className="calendar-day"
                    onClick={hasLeaves ? () => setSelectedDate(dateStrFor(day)) : undefined}
                    style={{
                      cursor: hasLeaves ? 'pointer' : 'default',
                    }}
                    title={hasLeaves ? 'Click to view leave details' : undefined}
                  >
                    <div className="day-number">{day}</div>
                    {dayLeaves.map(l => (
                      <div
                        key={l.id}
                        className="leave-indicator"
                        style={{ background: employeeColors[l.employee_name || ''] }}
                        title={`${l.employee_name} - ${l.leave_type_name}`}
                      >
                        {l.employee_name?.split(' ')[0]}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ====== LEAVE DETAILS FOR SELECTED DATE ====== */}
      {selectedDate && (
        <div className="modal-overlay" onClick={() => setSelectedDate(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 760 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
              <div>
                <h2 style={{ margin: 0 }}>Leave on {prettyDate(selectedDate)}</h2>
                <p style={{ color: '#666', margin: '4px 0 0', fontSize: '0.9rem' }}>
                  {selectedLeaves.length} team member{selectedLeaves.length === 1 ? '' : 's'} on approved leave
                </p>
              </div>
              <button
                className="btn btn-outline btn-sm"
                onClick={() => setSelectedDate(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="table-container" style={{ marginTop: 16 }}>
              <table>
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Emp ID</th>
                    <th>Leave Type</th>
                    <th>Duration</th>
                    <th>Days</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedLeaves.map(l => (
                    <tr key={l.id}>
                      <td>
                        <strong>{l.employee_name}</strong>
                        {l.designation && <div style={{ fontSize: '0.78rem', color: '#888' }}>{l.designation}</div>}
                      </td>
                      <td>
                        <code style={{ background: '#f0f0f0', padding: '2px 6px', borderRadius: 3 }}>
                          {l.employee_code || '—'}
                        </code>
                      </td>
                      <td>{l.leave_type_name}</td>
                      <td style={{ fontSize: '0.88rem' }}>
                        {l.from_date === l.to_date ? l.from_date : `${l.from_date} → ${l.to_date}`}
                        {l.is_half_day && <span className="badge badge-pending" style={{ marginLeft: 6 }}>Half day</span>}
                      </td>
                      <td>{l.days_count}</td>
                      <td style={{ fontSize: '0.85rem', color: '#555', maxWidth: 200 }}>{l.reason || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="modal-actions" style={{ marginTop: 20 }}>
              <button className="btn btn-primary" onClick={() => setSelectedDate(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
