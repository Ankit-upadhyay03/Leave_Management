import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Surface why the user landed back here (expired session, deactivated account).
  useEffect(() => {
    const message = sessionStorage.getItem('authMessage');
    if (message) {
      setNotice(message);
      sessionStorage.removeItem('authMessage');
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setLoading(true);

    try {
      const { requirePasswordChange } = await login(email, password);

      if (requirePasswordChange) {
        navigate('/change-password', { replace: true });
        return;
      }

      const stored = sessionStorage.getItem('redirectAfterLogin');
      sessionStorage.removeItem('redirectAfterLogin');
      const from = (location.state as any)?.from?.pathname || stored || '/dashboard';
      navigate(from, { replace: true });
    } catch (err: any) {
      setError(err.response?.data?.message || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      {/* Decorative dashboard preview behind the card. Static sample content only. */}
      <div className="login-backdrop" aria-hidden="true">
        <div className="lb-sidebar">
          <div className="lb-brand">Leave Management</div>
          <div className="lb-nav-item active">Dashboard</div>
          <div className="lb-nav-item">My Leaves</div>
          <div className="lb-nav-item">Team Overview</div>
          <div className="lb-nav-item">Calendar</div>
          <div className="lb-nav-item">Reports</div>
          <div className="lb-nav-item">Settings</div>
        </div>
        <div className="lb-main">
          <div className="lb-topbar" />
          <div className="lb-grid">
            <div className="lb-card">
              <div className="lb-line mid" />
              <div className="lb-line short" />
              <div className="lb-line" />
              <div className="lb-line mid" />
            </div>
            <div className="lb-card">
              <div className="lb-line short" />
              <div className="lb-stat" />
              <div className="lb-line short" />
              <div className="lb-stat" />
            </div>
            <div className="lb-card">
              <div className="lb-line mid" />
              <div className="lb-bar a" />
              <div className="lb-bar b" />
              <div className="lb-bar c" />
              <div className="lb-bar b" />
            </div>
          </div>
        </div>
      </div>

      <div className="login-card">
        <h1>Leave Management System</h1>
        <p>Sign in with your company credentials</p>

        {notice && <div className="alert alert-info">{notice}</div>}
        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">Company Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="yourname@company.com"
              required
              autoComplete="email"
              autoFocus
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <div style={{ position: 'relative' }}>
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
                autoComplete="current-password"
                style={{ width: '100%', paddingRight: 44, boxSizing: 'border-box' }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                title={showPassword ? 'Hide password' : 'Show password'}
                style={{
                  position: 'absolute',
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 4,
                  display: 'flex',
                  alignItems: 'center',
                  color: '#666',
                }}
              >
                {showPassword ? (
                  // Eye-off
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  // Eye
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: 20, color: '#999', fontSize: '0.85rem' }}>
          Contact your administrator if you need an account or a password reset.
        </p>
      </div>
    </div>
  );
}
