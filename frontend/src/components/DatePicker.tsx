import React, { useState, useRef, useEffect } from 'react';

interface DatePickerProps {
  value: string;
  onChange: (date: string) => void;
  min?: string;
  max?: string;
  holidays?: string[];
  holidayNames?: Record<string, string>;
  disabled?: boolean;
  placeholder?: string;
}

export function DatePicker({ value, onChange, min, max, holidays = [], holidayNames = {}, disabled, placeholder }: DatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => {
    if (value) return new Date(value).getMonth();
    return new Date().getMonth();
  });
  const [viewYear, setViewYear] = useState(() => {
    if (value) return new Date(value).getFullYear();
    return new Date().getFullYear();
  });
  const wrapperRef = useRef<HTMLDivElement>(null);

  const holidaySet = new Set(holidays);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const dayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  const getDaysInMonth = (m: number, y: number) => new Date(y, m + 1, 0).getDate();
  const getFirstDay = (m: number, y: number) => new Date(y, m, 1).getDay();

  const formatDate = (y: number, m: number, d: number) =>
    `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  const isWeekend = (day: number) => {
    const d = new Date(viewYear, viewMonth, day).getDay();
    return d === 0 || d === 6;
  };

  const isDisabled = (dateStr: string) => {
    if (min && dateStr < min) return true;
    if (max && dateStr > max) return true;
    return false;
  };

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  };

  const handleSelect = (dateStr: string) => {
    onChange(dateStr);
    setIsOpen(false);
  };

  const displayValue = value
    ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : '';

  const daysInMonth = getDaysInMonth(viewMonth, viewYear);
  const firstDay = getFirstDay(viewMonth, viewYear);
  const todayStr = new Date().toISOString().split('T')[0];

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      {/* Input display */}
      <div
        onClick={() => { if (!disabled) setIsOpen(!isOpen); }}
        style={{
          border: '1px solid #ddd', borderRadius: 6, padding: '10px 12px',
          cursor: disabled ? 'not-allowed' : 'pointer', background: disabled ? '#f5f5f5' : '#fff',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: 42,
        }}
      >
        <span style={{ color: value ? '#333' : '#999' }}>{displayValue || placeholder || 'Select date'}</span>
        <span style={{ color: '#999' }}>📅</span>
      </div>

      {/* Calendar Dropdown */}
      {isOpen && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 1000,
          background: '#fff', border: '1px solid #e0e0e0', borderRadius: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,0.15)', marginTop: 4, width: 300, padding: 16,
        }}>
          {/* Month/Year nav */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <button onClick={prevMonth} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', padding: '4px 8px' }}>‹</button>
            <strong style={{ color: '#1a237e' }}>{monthNames[viewMonth]} {viewYear}</strong>
            <button onClick={nextMonth} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', padding: '4px 8px' }}>›</button>
          </div>

          {/* Day headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, marginBottom: 4 }}>
            {dayNames.map((d, i) => (
              <div key={d} style={{
                textAlign: 'center', fontSize: '0.72rem', fontWeight: 700, padding: '4px 0',
                color: i === 0 || i === 6 ? '#ef4444' : '#888'
              }}>
                {d}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
            {Array.from({ length: firstDay }).map((_, i) => <div key={`e-${i}`}></div>)}

            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1;
              const dateStr = formatDate(viewYear, viewMonth, day);
              const isHol = holidaySet.has(dateStr);
              const isWknd = isWeekend(day);
              const isSelected = dateStr === value;
              const isToday = dateStr === todayStr;
              const isDis = isDisabled(dateStr);

              let bg = 'transparent';
              let color = '#333';
              let border = 'none';
              let cursor = 'pointer';
              let opacity = 1;

              if (isSelected) {
                bg = '#1a237e'; color = '#fff';
              } else if (isHol) {
                bg = '#fef2f2'; color = '#dc2626';
              } else if (isWknd) {
                bg = '#f9fafb'; color = '#9ca3af';
              }

              if (isDis) { opacity = 0.4; cursor = 'not-allowed'; }
              if (isToday && !isSelected) { border = '2px solid #1a237e'; }

              return (
                <div
                  key={day}
                  onClick={() => { if (!isDis) handleSelect(dateStr); }}
                  title={isHol ? (holidayNames[dateStr] || 'Holiday') : isWknd ? 'Weekend' : ''}
                  style={{
                    textAlign: 'center', padding: '7px 2px', borderRadius: 6,
                    background: bg, color, border, cursor, opacity,
                    fontSize: '0.85rem', fontWeight: isHol || isSelected ? 700 : 400,
                    transition: 'all 0.1s',
                  }}
                  onMouseEnter={e => { if (!isDis && !isSelected) e.currentTarget.style.background = '#e8eaf6'; }}
                  onMouseLeave={e => { if (!isDis && !isSelected) e.currentTarget.style.background = isHol ? '#fef2f2' : isWknd ? '#f9fafb' : 'transparent'; }}
                >
                  {day}
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', gap: 12, marginTop: 10, paddingTop: 8, borderTop: '1px solid #f0f0f0', fontSize: '0.7rem' }}>
            <span style={{ color: '#dc2626' }}>🔴 Holiday</span>
            <span style={{ color: '#9ca3af' }}>⚪ Weekend</span>
            <span style={{ color: '#1a237e' }}>🔵 Today</span>
          </div>
        </div>
      )}
    </div>
  );
}
