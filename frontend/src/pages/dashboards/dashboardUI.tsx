import React from 'react';

/* ---- inline sparkline charts (purely decorative) ---- */

export function SparkLine({ color }: { color: string }) {
  return (
    <svg className="stat-spark" width="58" height="30" viewBox="0 0 58 30" fill="none" aria-hidden="true">
      <path d="M1 22 L10 16 L18 20 L27 9 L36 14 L45 5 L57 11"
        stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SparkWave({ color }: { color: string }) {
  return (
    <svg className="stat-spark" width="58" height="30" viewBox="0 0 58 30" fill="none" aria-hidden="true">
      <path d="M1 20 C 8 6, 16 6, 22 16 S 38 28, 45 14 S 54 9, 57 12"
        stroke={color} strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export function SparkPulse({ color }: { color: string }) {
  return (
    <svg className="stat-spark" width="58" height="30" viewBox="0 0 58 30" fill="none" aria-hidden="true">
      <path d="M1 20 H14 L19 6 L25 26 L31 20 H57"
        stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SparkBars({ color }: { color: string }) {
  const heights = [10, 18, 8, 22, 14, 20];
  return (
    <svg className="stat-spark" width="58" height="30" viewBox="0 0 58 30" fill="none" aria-hidden="true">
      {heights.map((h, i) => (
        <rect key={i} x={2 + i * 10} y={28 - h} width="6" height={h} rx="2" fill={color} opacity={0.85} />
      ))}
    </svg>
  );
}

/* ---- helpers ---- */

const AVATAR_COLORS = ['#6366f1', '#0ea5e9', '#f59e0b', '#10b981', '#ec4899', '#8b5cf6', '#ef4444'];

export function initials(name: string): string {
  const parts = String(name || '').trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return '?';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

export function avatarColor(name: string): string {
  let sum = 0;
  for (const ch of String(name || '')) sum += ch.charCodeAt(0);
  return AVATAR_COLORS[sum % AVATAR_COLORS.length];
}

export function leaveTypeClass(name: string): string {
  const n = String(name || '').toLowerCase();
  if (n.includes('sick')) return 'sick';
  if (n.includes('vacation') || n.includes('annual')) return 'vacation';
  if (n.includes('casual')) return 'casual';
  if (n.includes('earned') || n.includes('privilege')) return 'earned';
  return 'default';
}

export function leaveTypeIcon(name: string): string {
  const cls = leaveTypeClass(name);
  if (cls === 'sick') return '🤒';
  if (cls === 'vacation') return '🌴';
  if (cls === 'casual') return '☕';
  if (cls === 'earned') return '⭐';
  return '📅';
}

export function formatRange(from: string, to: string): string {
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  const f = new Date(from).toLocaleDateString('en-IN', opts);
  const t = new Date(to).toLocaleDateString('en-IN', opts);
  return f === t ? f : `${f} – ${t}`;
}

/* ---- reusable presentational components ---- */

export function Avatar({ name }: { name: string }) {
  return (
    <span className="avatar">
      <span className="initials" style={{ background: avatarColor(name) }}>{initials(name)}</span>
      <span className="emp-name">{name}</span>
    </span>
  );
}

export function LeaveTypePill({ name }: { name: string }) {
  return (
    <span className={`lt-pill ${leaveTypeClass(name)}`}>
      <span aria-hidden="true">{leaveTypeIcon(name)}</span>
      {name}
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  return (
    <span className={`status-pill ${String(status || 'pending').toLowerCase()}`}>
      {status || 'Pending'}
    </span>
  );
}

export interface StatTile {
  key: string;
  value: number | string;
  label: string;
  accent: 'indigo' | 'blue' | 'amber' | 'green' | 'purple' | 'red';
  spark: React.ReactNode;
  to?: string;
}
