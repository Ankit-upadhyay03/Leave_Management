import React, { useEffect, useState } from 'react';
import api from '../services/api';
import { Holiday, LeaveRequest } from '../types';
import { useAuth } from '../context/AuthContext';

export function HolidayCalendar() {
  const { user } = useAuth();
  // Managers and Admins also see who on their team is on leave each day.
  const canSeeTeamLeaves = user?.role === 'Manager' || user?.role === 'Admin';

  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [teamLeaves, setTeamLeaves] = useState<LeaveRequest[]>([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth());
  const [loading, setLoading] = useState(true);
  // The date whose team-leave details are shown in the popup (null = closed).
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => { loadHolidays(); }, [year]);

  // Team leaves are fetched per visible month, and only for roles allowed to see them.
  useEffect(() => {
    if (!canSeeTeamLeaves) return;
    loadTeamLeaves();
  }, [month, year, canSeeTeamLeaves]);

  const loadHolidays = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/holidays?year=${year}`);
      setHolidays(res.data);
    } catch (error) {
      console.error('Error loading holidays:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadTeamLeaves = async () => {
    try {
      const res = await api.get(`/manager/team-calendar?month=${month + 1}&year=${year}`);
      setTeamLeaves(res.data);
    } catch (error) {
      console.error('Error loading team leaves:', error);
      setTeamLeaves([]);
    }
  };

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const getDaysInMonth = (m: number, y: number) => new Date(y, m + 1, 0).getDate();
  const getFirstDayOfMonth = (m: number, y: number) => new Date(y, m, 1).getDay();

  const holidayDates = new Set(holidays.map(h => h.holiday_date.split('T')[0]));
  const holidayMap: Record<string, string> = {};
  holidays.forEach(h => { holidayMap[h.holiday_date.split('T')[0]] = h.name; });

  const isHoliday = (dateStr: string) => holidayDates.has(dateStr);
  const isWeekend = (day: number, m: number, y: number) => {
    const d = new Date(y, m, day).getDay();
    return d === 0 || d === 6;
  };

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  const leavesOnDate = (dateStr: string) =>
    teamLeaves.filter(l => l.from_date <= dateStr && l.to_date >= dateStr);

  const prettyDate = (dateStr: string) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    const weekday = dayNames.length
      ? ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dt.getDay()]
      : '';
    return `${d} ${monthNames[m - 1]} ${y} (${weekday})`;
  };

  const selectedLeaves = selectedDate ? leavesOnDate(selectedDate) : [];

  const daysInMonth = getDaysInMonth(month, year);
  const firstDay = getFirstDayOfMonth(month, year);

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  };

  // Get holidays for current month view
  const monthHolidays = holidays.filter(h => {
    const d = new Date(h.holiday_date);
    return d.getMonth() === month && d.getFullYear() === year;
  });

  if (loading) return <div className="loading"><div className="spinner"></div></div>;

  return (
    <div>
      <div className="header">
        <h1>Holiday Calendar</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-outline btn-sm" onClick={() => setYear(y => y - 1)}>« {year - 1}</button>
          <span style={{ fontWeight: 700, fontSize: '1.1rem', minWidth: 50, textAlign: 'center' }}>{year}</span>
          <button className="btn btn-outline btn-sm" onClick={() => setYear(y => y + 1)}>{year + 1} »</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 24 }}>
        {/* Calendar View */}
        <div className="card">
          {/* Month Navigation */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <button onClick={prevMonth} style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', padding: '4px 12px' }}>←</button>
            <h2 style={{ margin: 0, color: '#1a237e' }}>{monthNames[month]} {year}</h2>
            <button onClick={nextMonth} style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', padding: '4px 12px' }}>→</button>
          </div>

          {/* Day headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
            {dayNames.map((d, i) => (
              <div key={d} style={{
                textAlign: 'center', padding: '8px 0', fontWeight: 700, fontSize: '0.8rem',
                color: i === 0 || i === 6 ? '#ef4444' : '#666',
              }}>
                {d}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
            {/* Empty cells for first day offset */}
            {Array.from({ length: firstDay }).map((_, i) => (
              <div key={`empty-${i}`} style={{ padding: 8 }}></div>
            ))}

            {/* Day cells */}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1;
              const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const isHol = isHoliday(dateStr);
              const isWknd = isWeekend(day, month, year);
              const isToday = dateStr === todayStr;
              const dayLeaves = canSeeTeamLeaves ? leavesOnDate(dateStr) : [];
              const hasLeaves = dayLeaves.length > 0;

              let bgColor = 'transparent';
              let textColor = '#333';
              let borderStyle = 'none';
              let fontWeight = '400';

              if (isHol) {
                bgColor = '#fef2f2';
                textColor = '#dc2626';
                fontWeight = '700';
              } else if (isWknd) {
                bgColor = '#f9fafb';
                textColor = '#9ca3af';
              }

              // A day with team leave gets a soft highlight so it stands out from plain days.
              if (hasLeaves && !isHol) {
                bgColor = '#eef2ff';
              }

              if (isToday) {
                borderStyle = '2px solid #1a237e';
              }

              const clickable = hasLeaves;

              return (
                <div
                  key={day}
                  onClick={clickable ? () => setSelectedDate(dateStr) : undefined}
                  title={
                    hasLeaves
                      ? `${dayLeaves.length} on leave — click for details`
                      : isHol ? holidayMap[dateStr] : isWknd ? 'Weekend' : ''
                  }
                  style={{
                    textAlign: 'center',
                    padding: '10px 4px',
                    borderRadius: 8,
                    background: bgColor,
                    color: textColor,
                    fontWeight: fontWeight as any,
                    border: borderStyle,
                    position: 'relative',
                    cursor: clickable ? 'pointer' : isHol ? 'pointer' : 'default',
                    minHeight: 40,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <span>{day}</span>
                  {isHol && (
                    <span style={{ fontSize: '0.6rem', color: '#dc2626', marginTop: 2, lineHeight: 1 }}>●</span>
                  )}
                  {hasLeaves && (
                    <span
                      style={{
                        marginTop: 3,
                        fontSize: '0.6rem',
                        fontWeight: 700,
                        color: '#fff',
                        background: '#4f46e5',
                        borderRadius: 10,
                        padding: '1px 6px',
                        lineHeight: 1.4,
                      }}
                    >
                      {dayLeaves.length} 🏖
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', gap: 20, marginTop: 16, paddingTop: 12, borderTop: '1px solid #f0f0f0', fontSize: '0.82rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 14, height: 14, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 3 }}></div>
              <span style={{ color: '#dc2626' }}>Company Holiday</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 14, height: 14, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 3 }}></div>
              <span style={{ color: '#9ca3af' }}>Weekend</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 14, height: 14, background: '#fff', border: '2px solid #1a237e', borderRadius: 3 }}></div>
              <span>Today</span>
            </div>
            {canSeeTeamLeaves && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 14, height: 14, background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 3 }}></div>
                <span style={{ color: '#4f46e5' }}>Team on leave</span>
              </div>
            )}
          </div>
        </div>

        {/* Holidays List */}
        <div>
          {/* This month's holidays */}
          {monthHolidays.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <h3 style={{ margin: '0 0 12px', fontSize: '0.95rem', color: '#1a237e' }}>
                {monthNames[month]} Holidays
              </h3>
              {monthHolidays.map(h => {
                const d = new Date(h.holiday_date);
                return (
                  <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #f5f5f5' }}>
                    <div style={{
                      background: '#fef2f2', color: '#dc2626', borderRadius: 6, width: 40, height: 40,
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      fontWeight: 700, fontSize: '0.9rem'
                    }}>
                      {d.getDate()}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{h.name}</div>
                      <div style={{ fontSize: '0.75rem', color: '#888' }}>{d.toLocaleDateString('en-IN', { weekday: 'long' })}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* All holidays this year */}
          <div className="card">
            <h3 style={{ margin: '0 0 12px', fontSize: '0.95rem' }}>All Holidays — {year}</h3>
            {holidays.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 20, color: '#999' }}>No holidays configured</div>
            ) : (
              <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                {holidays.map(h => {
                  const d = new Date(h.holiday_date);
                  const isPast = d < today;
                  return (
                    <div key={h.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0',
                      borderBottom: '1px solid #f5f5f5', opacity: isPast ? 0.5 : 1
                    }}>
                      <div style={{
                        background: '#fef2f2', color: '#dc2626', borderRadius: 6, width: 36, height: 36,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                        fontWeight: 700, fontSize: '0.82rem'
                      }}>
                        {d.getDate()}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 500, fontSize: '0.85rem' }}>{h.name}</div>
                        <div style={{ fontSize: '0.72rem', color: '#888' }}>
                          {d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', weekday: 'short' })}
                          {h.description && ` • ${h.description}`}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ====== TEAM LEAVE DETAILS FOR SELECTED DATE ====== */}
      {selectedDate && (
        <div className="modal-overlay" onClick={() => setSelectedDate(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 780 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
              <div>
                <h2 style={{ margin: 0 }}>Team on Leave — {prettyDate(selectedDate)}</h2>
                <p style={{ color: '#666', margin: '4px 0 0', fontSize: '0.9rem' }}>
                  {selectedLeaves.length} team member{selectedLeaves.length === 1 ? '' : 's'} on approved leave
                </p>
              </div>
              <button className="btn btn-outline btn-sm" onClick={() => setSelectedDate(null)} aria-label="Close">✕</button>
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
                      <td style={{ fontSize: '0.85rem', color: '#555', maxWidth: 220 }}>{l.reason || '—'}</td>
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
