import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

function initials(name?: string): string {
  const parts = String(name || '').trim().split(/\s+/);
  if (!parts[0]) return '?';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [unreadCount, setUnreadCount] = useState(0);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  // Pull the avatar once so the sidebar can show the picture instead of initials.
  useEffect(() => {
    let cancelled = false;
    api.get('/profile')
      .then(({ data }) => { if (!cancelled) setAvatarUrl(data.avatar_url || null); })
      .catch(() => { /* fall back to initials */ });
    return () => { cancelled = true; };
  }, [user?.email]);

  // Poll the notification count so approvals/rejections surface without a reload.
  useEffect(() => {
    let cancelled = false;

    const fetchCount = async () => {
      try {
        const { data } = await api.get('/notifications/unread-count');
        if (!cancelled) setUnreadCount(data.count);
      } catch { /* non-critical */ }
    };

    fetchCount();
    const interval = setInterval(fetchCount, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const getNavLinks = () => {
    const links: { to: string; label: string; icon: string }[] = [
      { to: '/dashboard', label: 'Dashboard', icon: '🏠' },
      { to: '/profile', label: 'My Profile', icon: '👤' },
    ];

    // Every role has personal leave, including Admin.
    links.push(
      { to: '/leave/apply', label: 'Apply Leave', icon: '✏️' },
      { to: '/leave/history', label: 'Leave History', icon: '📋' },
      { to: '/holidays', label: 'Holiday Calendar', icon: '🗓️' }
    );

    // Admins also get the team views so they can action their own direct reports.
    if (user?.role === 'Manager' || user?.role === 'Admin') {
      links.push(
        { to: '/manager/pending', label: 'Pending Approvals', icon: '⏳' },
        { to: '/manager/team-calendar', label: 'Team Calendar', icon: '👥' },
        { to: '/manager/team-history', label: 'Team History', icon: '📊' }
      );
    }

    if (user?.role === 'Admin') {
      links.push(
        { to: '/admin/employees', label: 'User Management', icon: '🧑‍💼' },
        { to: '/admin/leave-types', label: 'Leave Config', icon: '⚙️' },
        { to: '/admin/holidays', label: 'Holidays', icon: '📅' },
        { to: '/admin/leave-requests', label: 'All Requests', icon: '📄' },
        { to: '/admin/reports', label: 'Reports', icon: '📈' }
      );
    }

    return links;
  };

  return (
    <div className="app-container">
      <aside className="sidebar">
        {/* Brand */}
        <div className="sb-brand">
          <div className="sb-brand-left">
            <span className="sb-logo" aria-hidden="true">🌿</span>
            <span className="sb-brand-name">LeaveMGT</span>
          </div>
          <button
            className="sb-bell"
            title={`${unreadCount} unread notification(s)`}
            aria-label={`${unreadCount} unread notifications`}
          >
            🔔
            {unreadCount > 0 && <span className="dot">{unreadCount}</span>}
          </button>
        </div>

        {/* Identity — click to open the profile page */}
        <NavLink
          to="/profile"
          className="sb-identity"
          style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}
          title="View and edit your profile"
        >
          <span className="sb-avatar" style={{ overflow: 'hidden', padding: 0 }}>
            {avatarUrl
              ? <img src={avatarUrl} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
              : initials(user?.name)}
          </span>
          <div className="who">
            <div className="nm">{user?.name}</div>
            <div className="rl">{user?.role}</div>
          </div>
        </NavLink>

        {/* Nav */}
        <nav>
          {getNavLinks().map(link => (
            <NavLink key={link.to} to={link.to} className={({ isActive }) => (isActive ? 'active' : '')}>
              <span className="nav-ico" aria-hidden="true">{link.icon}</span>
              {link.label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="sb-footer">
          <div className="sb-settings-row">
            <span className="lbl"><span aria-hidden="true">👤</span> Settings</span>
            <button
              className="gear"
              aria-label="Settings"
              onClick={() => navigate('/change-password')}
            >
              ⚙️
            </button>
          </div>
          <div className="sb-email">{user?.email}</div>
          <NavLink to="/change-password" className="sb-change-pwd">Change Password</NavLink>
          <button className="sb-logout" onClick={logout}>
            <span aria-hidden="true">🚪</span> Logout
          </button>
        </div>
      </aside>

      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
