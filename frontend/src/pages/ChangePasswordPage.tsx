import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';

interface Rule {
  label: string;
  test: (pw: string) => boolean;
}

// Mirrors AuthService.validatePasswordStrength on the server.
const RULES: Rule[] = [
  { label: 'At least 8 characters', test: pw => pw.length >= 8 },
  { label: 'One uppercase letter (A-Z)', test: pw => /[A-Z]/.test(pw) },
  { label: 'One lowercase letter (a-z)', test: pw => /[a-z]/.test(pw) },
  { label: 'One number (0-9)', test: pw => /[0-9]/.test(pw) },
  { label: 'One special character (!@#$%^&*)', test: pw => /[!@#$%^&*()_+\-=\[\]{};':"|,.<>?]/.test(pw) },
];

export function ChangePasswordPage() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { logout } = useAuth();

  const allRulesPass = RULES.every(r => r.test(newPassword));
  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!passwordsMatch) {
      setError('New passwords do not match');
      return;
    }
    if (!allRulesPass) {
      setError('Password does not meet all requirements');
      return;
    }
    if (currentPassword === newPassword) {
      setError('New password must be different from your current password');
      return;
    }

    setLoading(true);
    try {
      await api.post('/auth/change-password', {
        current_password: currentPassword,
        new_password: newPassword,
      });
      // Force a fresh sign-in with the new credentials.
      await logout();
      sessionStorage.setItem('authMessage', 'Password changed successfully. Please sign in with your new password.');
      navigate('/login', { replace: true });
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to change password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card" style={{ maxWidth: 460 }}>
        <h1>Change Password</h1>
        <p>Choose a strong password you have not used before.</p>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="currentPassword">Current / Temporary Password</label>
            <input
              id="currentPassword"
              type="password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              required
              autoComplete="current-password"
              autoFocus
            />
          </div>

          <div className="form-group">
            <label htmlFor="newPassword">New Password</label>
            <input
              id="newPassword"
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              required
              autoComplete="new-password"
            />
          </div>

          {/* Live checklist so failures are visible before submitting. */}
          {newPassword.length > 0 && (
            <div style={{ background: '#f8f9fa', borderRadius: 6, padding: '10px 14px', marginBottom: 14, fontSize: '0.8rem' }}>
              {RULES.map(rule => {
                const ok = rule.test(newPassword);
                return (
                  <div key={rule.label} style={{ color: ok ? '#10b981' : '#9ca3af', padding: '2px 0' }}>
                    {ok ? '✓' : '○'} {rule.label}
                  </div>
                );
              })}
            </div>
          )}

          <div className="form-group">
            <label htmlFor="confirmPassword">Confirm New Password</label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              required
              autoComplete="new-password"
            />
            {confirmPassword.length > 0 && !passwordsMatch && (
              <small style={{ color: '#ef4444' }}>Passwords do not match</small>
            )}
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%' }}
            disabled={loading || !allRulesPass || !passwordsMatch || !currentPassword}
          >
            {loading ? 'Changing...' : 'Change Password'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: 16 }}>
          <button
            onClick={async () => { await logout(); navigate('/login', { replace: true }); }}
            style={{ background: 'none', border: 'none', color: '#666', fontSize: '0.82rem', cursor: 'pointer', textDecoration: 'underline' }}
          >
            Sign out instead
          </button>
        </p>
      </div>
    </div>
  );
}
