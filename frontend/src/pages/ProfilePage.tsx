import React, { useEffect, useRef, useState } from 'react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';

interface Profile {
  id: string;
  employee_code: string;
  name: string;
  email: string;
  mobile: string | null;
  address: string | null;
  avatar_url: string | null;
  role: string;
  designation: string | null;
  department_name: string | null;
  manager_name: string | null;
  date_of_joining: string | null;
}

function initials(name?: string): string {
  const parts = String(name || '').trim().split(/\s+/);
  if (!parts[0]) return '?';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

export function ProfilePage() {
  const { refreshUser } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [address, setAddress] = useState('');
  const [savingAddress, setSavingAddress] = useState(false);

  // Email change flow
  const [newEmail, setNewEmail] = useState('');
  const [otpStage, setOtpStage] = useState<'idle' | 'sent'>('idle');
  const [otpCode, setOtpCode] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);

  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/profile');
      setProfile(data);
      setAddress(data.address || '');
    } catch {
      setError('Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

  const flash = (msg: string) => { setSuccess(msg); setTimeout(() => setSuccess(''), 4000); };

  const saveAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setSavingAddress(true);
    try {
      const { data } = await api.put('/profile', { address });
      setProfile(data);
      flash('Address saved.');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to save address');
    } finally {
      setSavingAddress(false);
    }
  };

  const onPickAvatar = () => fileInput.current?.click();

  const onAvatarSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(''); setUploading(true);
    try {
      const form = new FormData();
      form.append('avatar', file);
      const { data } = await api.post('/profile/avatar', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setProfile(p => (p ? { ...p, avatar_url: data.avatar_url } : p));
      await refreshUser();
      flash('Profile picture updated.');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to upload picture');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const requestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setEmailBusy(true);
    try {
      await api.post('/profile/email/request-otp', { new_email: newEmail });
      setOtpStage('sent');
      flash(`Verification code sent to ${newEmail}.`);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to send code');
    } finally {
      setEmailBusy(false);
    }
  };

  const verifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setEmailBusy(true);
    try {
      const { data } = await api.post('/profile/email/verify-otp', { code: otpCode });
      setProfile(p => (p ? { ...p, email: data.email } : p));
      setOtpStage('idle');
      setNewEmail(''); setOtpCode('');
      await refreshUser();
      flash('Email address updated.');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Verification failed');
    } finally {
      setEmailBusy(false);
    }
  };

  const cancelEmailChange = () => {
    setOtpStage('idle'); setNewEmail(''); setOtpCode(''); setError('');
  };

  if (loading) return <div className="loading"><div className="spinner"></div></div>;
  if (!profile) return <div className="alert alert-error">{error || 'Profile unavailable'}</div>;

  const readOnly = (label: string, value: string | null | undefined) => (
    <div className="form-group">
      <label>{label}</label>
      <input value={value || '—'} disabled style={{ background: '#f5f5f5' }} />
    </div>
  );

  return (
    <div>
      <div className="header"><h1>My Profile</h1></div>

      {success && <div className="alert alert-success" style={{ marginBottom: 16 }}>{success}</div>}
      {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 24, alignItems: 'start' }}>
        {/* Avatar card */}
        <div className="card" style={{ textAlign: 'center' }}>
          <div
            style={{
              width: 140, height: 140, borderRadius: '50%', margin: '0 auto 16px',
              background: '#1a237e', color: '#fff', display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: '2.6rem', fontWeight: 700, overflow: 'hidden',
              border: '3px solid #e8eaf6',
            }}
          >
            {profile.avatar_url
              ? <img src={profile.avatar_url} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : initials(profile.name)}
          </div>
          <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>{profile.name}</div>
          <div style={{ color: '#888', fontSize: '0.85rem', marginBottom: 16 }}>{profile.designation || profile.role}</div>

          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={onAvatarSelected}
            style={{ display: 'none' }}
          />
          <button className="btn btn-outline btn-sm" onClick={onPickAvatar} disabled={uploading} style={{ width: '100%' }}>
            {uploading ? 'Uploading...' : '📷 Change Picture'}
          </button>
          <div style={{ color: '#aaa', fontSize: '0.72rem', marginTop: 8 }}>JPG, PNG, WEBP or GIF, up to 2 MB</div>
        </div>

        {/* Details */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Account info (read-only) */}
          <div className="card">
            <h3 style={{ margin: '0 0 16px', color: '#1a237e' }}>Account Information</h3>
            <div className="form-row">
              {readOnly('Employee ID', profile.employee_code)}
              {readOnly('Role', profile.role)}
            </div>
            <div className="form-row">
              {readOnly('Department', profile.department_name)}
              {readOnly('Reporting Manager', profile.manager_name)}
            </div>
            <div className="form-row">
              {readOnly('Mobile', profile.mobile)}
              {readOnly('Date of Joining', profile.date_of_joining)}
            </div>
            <p style={{ color: '#999', fontSize: '0.8rem', margin: '4px 0 0' }}>
              To change details other than address, email, or picture, contact your administrator.
            </p>
          </div>

          {/* Address */}
          <div className="card">
            <h3 style={{ margin: '0 0 16px', color: '#1a237e' }}>Address</h3>
            <form onSubmit={saveAddress}>
              <div className="form-group">
                <label htmlFor="address">Residential Address</label>
                <textarea
                  id="address"
                  value={address}
                  onChange={e => setAddress(e.target.value)}
                  placeholder="House / street, city, state, postal code"
                  rows={3}
                  maxLength={500}
                  style={{ width: '100%', resize: 'vertical' }}
                />
                <div style={{ textAlign: 'right', color: '#aaa', fontSize: '0.72rem' }}>{address.length}/500</div>
              </div>
              <button type="submit" className="btn btn-primary" disabled={savingAddress}>
                {savingAddress ? 'Saving...' : 'Save Address'}
              </button>
            </form>
          </div>

          {/* Email with OTP */}
          <div className="card">
            <h3 style={{ margin: '0 0 4px', color: '#1a237e' }}>Email Address</h3>
            <p style={{ color: '#666', fontSize: '0.88rem', margin: '0 0 16px' }}>
              Current: <strong>{profile.email}</strong>
            </p>

            {otpStage === 'idle' ? (
              <form onSubmit={requestOtp}>
                <div className="form-group">
                  <label htmlFor="newEmail">New Email Address</label>
                  <input
                    id="newEmail"
                    type="email"
                    value={newEmail}
                    onChange={e => setNewEmail(e.target.value)}
                    placeholder="new.address@example.com"
                    required
                  />
                </div>
                <button type="submit" className="btn btn-primary" disabled={emailBusy || !newEmail}>
                  {emailBusy ? 'Sending...' : 'Send Verification Code'}
                </button>
                <p style={{ color: '#999', fontSize: '0.8rem', margin: '10px 0 0' }}>
                  A 6-digit code will be sent to the new address. Your email changes only after you enter it.
                </p>
              </form>
            ) : (
              <form onSubmit={verifyOtp}>
                <div className="alert alert-info" style={{ fontSize: '0.85rem' }}>
                  We sent a 6-digit code to <strong>{newEmail}</strong>. Enter it below to confirm.
                </div>
                <div className="form-group">
                  <label htmlFor="otp">Verification Code</label>
                  <input
                    id="otp"
                    inputMode="numeric"
                    maxLength={6}
                    value={otpCode}
                    onChange={e => setOtpCode(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="______"
                    style={{ letterSpacing: 6, fontSize: '1.2rem', textAlign: 'center' }}
                    required
                  />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="submit" className="btn btn-primary" disabled={emailBusy || otpCode.length !== 6}>
                    {emailBusy ? 'Verifying...' : 'Verify & Update'}
                  </button>
                  <button type="button" className="btn btn-outline" onClick={cancelEmailChange} disabled={emailBusy}>
                    Cancel
                  </button>
                  <button type="button" className="btn btn-outline" onClick={requestOtp as any} disabled={emailBusy}>
                    Resend
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
