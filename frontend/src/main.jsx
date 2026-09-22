import React, { useEffect, useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const API = '/api';

async function api(path, opt = {}) {
  const token = localStorage.getItem('token');
  const r = await fetch(API + path, {
    ...opt,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(opt.headers || {})
    }
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(d.message || 'Request failed');
  return d;
}

// Icon Components
const Icons = {
  Dashboard: () => (
    <svg fill="none" viewBox="0 0 24 24" strokeWidth="1.8" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
    </svg>
  ),
  Register: () => (
    <svg fill="none" viewBox="0 0 24 24" strokeWidth="1.8" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM4 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 0110.375 21c-2.331 0-4.512-.645-6.374-1.766z" />
    </svg>
  ),
  Visitors: () => (
    <svg fill="none" viewBox="0 0 24 24" strokeWidth="1.8" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
    </svg>
  ),
  Approvals: () => (
    <svg fill="none" viewBox="0 0 24 24" strokeWidth="1.8" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
    </svg>
  ),
  EntryExit: () => (
    <svg fill="none" viewBox="0 0 24 24" strokeWidth="1.8" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
    </svg>
  ),
  Reports: () => (
    <svg fill="none" viewBox="0 0 24 24" strokeWidth="1.8" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
    </svg>
  ),
  Audit: () => (
    <svg fill="none" viewBox="0 0 24 24" strokeWidth="1.8" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
    </svg>
  ),
  Pass: () => (
    <svg fill="none" viewBox="0 0 24 24" strokeWidth="1.8" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5zM13.5 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5z" />
    </svg>
  ),
  Logout: () => (
    <svg fill="none" viewBox="0 0 24 24" strokeWidth="1.8" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
    </svg>
  ),
  Blocked: () => (
    <svg fill="none" viewBox="0 0 24 24" strokeWidth="1.8" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 11.293V12.5a2.5 2.5 0 006.88-3.363A3.625 3.625 0 0113 19.375H17m0 0l1.5 1.5m-11.25-5.25v2.25a1.5 1.5 0 013 3h-3M15 11.293v-.667a3 3 0 01-3 0l8.25-1.5.375-.375a1.5 1.5 0 013 0l-7.5 4.5M16 11.293v.667a3 3 0 016 0l8.25 1.5.375.375a1.5 1.5 0 01-3 0l-7.5-4.5" />
    </svg>
  ),
  MasterData: () => (
    <svg fill="none" viewBox="0 0 24 24" strokeWidth="1.8" stroke="currentColor">
      <rect x="4.25" y="6.5" width="15.5" height="11" rx="2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M5.75 10.5h12.5M5.75 14.5h12.5" />
    </svg>
  ),
  Bell: () => (
    <svg fill="none" viewBox="0 0 24 24" strokeWidth="1.8" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
    </svg>
  ),
  DownloadApp: () => (
    <svg fill="none" viewBox="0 0 24 24" strokeWidth="1.8" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
  ),
  Mail: () => (
    <svg fill="none" viewBox="0 0 24 24" strokeWidth="1.8" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
    </svg>
  ),
  Menu: () => (
    <svg fill="none" viewBox="0 0 24 24" strokeWidth="1.8" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
    </svg>
  ),
  Close: () => (
    <svg fill="none" viewBox="0 0 24 24" strokeWidth="1.8" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  ),
  Users: () => (
    <svg fill="none" viewBox="0 0 24 24" strokeWidth="1.8" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
    </svg>
  )
};

function StatusBadge({ status }) {
  const map = {
    INSIDE: { label: 'Inside', cls: 'badge-inside' },
    APPROVED: { label: 'Approved', cls: 'badge-approved' },
    PENDING_APPROVAL: { label: 'Pending', cls: 'badge-pending' },
    PENDING: { label: 'Pending', cls: 'badge-pending' },
    REJECTED: { label: 'Rejected', cls: 'badge-rejected' },
    DECLINED: { label: 'Declined', cls: 'badge-rejected' },
    CLOSED: { label: 'Exited', cls: 'badge-closed' }
  };
  const item = map[status] || { label: status || 'Unknown', cls: 'badge-closed' };
  return <span className={`badge ${item.cls}`}>{item.label}</span>;
}

// Digital Pass Modal Component
function PassModal({ passData, onClose }) {
  if (!passData) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="pass-card" onClick={e => e.stopPropagation()}>
        <div className="pass-header">
          <img src="/logo.png" alt="Swagatham Logo" className="pass-header-logo" />
          <h3>Swagatham Visitor Pass</h3>
          <p>Digital Security Badge</p>
        </div>
        <div className="pass-body">
          <div className="pass-code">{passData.visitor_code}</div>
          {passData.photo && (
            <div style={{ textAlign: 'center', marginBottom: '15px' }}>
              <img src={passData.photo} alt="Visitor Photo" style={{ width: '100px', height: '100px', borderRadius: '50%', objectFit: 'cover', border: '3px solid #e2e8f0' }} />
            </div>
          )}
          {passData.qr && (
            <div className="pass-qr">
              <img src={passData.qr} alt="Visitor QR Code" />
            </div>
          )}
          <div className="pass-details-list">
            <div className="pass-detail-item">
              <span>Visitor Name</span>
              <span>{passData.name}</span>
            </div>
            <div className="pass-detail-item">
              <span>Organization</span>
              <span>{passData.company || 'Individual'}</span>
            </div>
            <div className="pass-detail-item">
              <span>Host / Department</span>
              <span>{passData.host_name || 'N/A'} ({passData.department || 'General'})</span>
            </div>
            <div className="pass-detail-item">
              <span>Purpose</span>
              <span>{passData.purpose}</span>
            </div>
            <div className="pass-detail-item">
              <span>Status</span>
              <StatusBadge status={passData.status} />
            </div>
            <div className="pass-detail-item">
              <span>Expected Check-in</span>
              <span>{passData.expected_checkin ? new Date(passData.expected_checkin).toLocaleString() : '—'}</span>
            </div>
            <div className="pass-detail-item">
              <span>Expected Check-out</span>
              <span>{passData.expected_checkout ? new Date(passData.expected_checkout).toLocaleString() : '—'}</span>
            </div>
            <div className="pass-detail-item">
              <span>Pass Valid Until</span>
              <span>{passData.valid_until ? new Date(passData.valid_until).toLocaleString() : '—'}</span>
            </div>
          </div>
          <div style={{ marginTop: '20px', display: 'flex', gap: '10px' }}>
            <button className="btn-primary" style={{ flex: 1 }} onClick={() => window.print()}>
              Print Badge
            </button>
            <button className="btn-secondary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Login Screen with Host Registration
function Login({ onLogin }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [u, setU] = useState('admin');
  const [p, setP] = useState('admin123');
  
  // Registration state
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPass, setRegPass] = useState('');
  const [regConfirm, setRegConfirm] = useState('');
  const [regDept, setRegDept] = useState('');
  
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const doLogin = async (username, password) => {
    setLoading(true);
    setErr('');
    try {
      const d = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });
      localStorage.setItem('token', d.token);
      localStorage.setItem('user', JSON.stringify(d.user));
      onLogin(d.user);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  const doRegister = async (e) => {
    e.preventDefault();
    if (!regName || !regEmail || !regPass) {
      setErr('Full name, email address, and password are required');
      return;
    }
    if (!regEmail.includes('@')) {
      setErr('Please enter a valid email address');
      return;
    }
    if (regPass.length < 4) {
      setErr('Password must be at least 4 characters');
      return;
    }
    if (regPass !== regConfirm) {
      setErr('Passwords do not match');
      return;
    }

    setLoading(true);
    setErr('');
    try {
      const d = await api('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: regName,
          email: regEmail,
          password: regPass,
          department: regDept
        })
      });
      localStorage.setItem('token', d.token);
      localStorage.setItem('user', JSON.stringify(d.user));
      onLogin(d.user);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-brand">
          <div className="login-logo-box">
            <img src="/logo.png" alt="Swagatham Logo" className="login-logo-img" />
          </div>
          <p>Enterprise Visitor Access Management System</p>
        </div>

        {/* Tab Switcher for Sign In vs Host Registration */}
        <div style={{ display: 'flex', gap: '6px', background: 'var(--bg-card-subtle)', padding: '4px', borderRadius: '10px', marginBottom: '16px' }}>
          <button
            type="button"
            className={`btn-secondary ${mode === 'login' ? 'btn-primary' : ''}`}
            style={{ flex: 1, padding: '8px', fontSize: '13px', fontWeight: '700' }}
            onClick={() => { setMode('login'); setErr(''); }}
          >
            Sign In
          </button>
          <button
            type="button"
            className={`btn-secondary ${mode === 'register' ? 'btn-primary' : ''}`}
            style={{ flex: 1, padding: '8px', fontSize: '13px', fontWeight: '700' }}
            onClick={() => { setMode('register'); setErr(''); }}
          >
            Register Host Profile
          </button>
        </div>

        {err && <div className="alert-box alert-error">{err}</div>}

        {mode === 'login' ? (
          <div>
            <div className="form-group">
              <label className="form-label">Username or Email ID</label>
              <input
                className="form-control"
                placeholder="Enter username or email"
                value={u}
                onChange={e => setU(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Password</label>
              <input
                className="form-control"
                type="password"
                placeholder="Enter password"
                value={p}
                onChange={e => setP(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && doLogin(u, p)}
              />
            </div>

            <button
              className="btn-primary"
              style={{ width: '100%', marginBottom: '16px' }}
              disabled={loading}
              onClick={() => doLogin(u, p)}
            >
              {loading ? 'Authenticating...' : 'Sign In'}
            </button>

            <div>
              <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-muted)' }}>
                DEMO ONE-CLICK ROLES:
              </span>
              <div className="quick-login-pills">
                <button className="quick-login-btn" onClick={() => { setU('superadmin'); setP('admin123'); doLogin('superadmin', 'admin123'); }}>
                  👑 Super Admin
                </button>
                <button className="quick-login-btn" onClick={() => { setU('admin'); setP('admin123'); doLogin('admin', 'admin123'); }}>
                  🛡️ Admin
                </button>
                <button className="quick-login-btn" onClick={() => { setU('ceo'); setP('ceo123'); doLogin('ceo', 'ceo123'); }}>
                  💼 Executive (CEO)
                </button>
                <button className="quick-login-btn" onClick={() => { setU('reception'); setP('reception123'); doLogin('reception', 'reception123'); }}>
                  🏢 Reception (Sanjiv)
                </button>
                <button className="quick-login-btn" onClick={() => { setU('guard'); setP('guard123'); doLogin('guard', 'guard123'); }}>
                  🚪 Guard
                </button>
                <button className="quick-login-btn" onClick={() => { setU('host_ravi'); setP('host123'); doLogin('host_ravi', 'host123'); }}>
                  👤 Standard Host
                </button>
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={doRegister}>
            <div className="form-group">
              <label className="form-label">Full Name <span className="req">*</span></label>
              <input
                required
                className="form-control"
                placeholder="e.g. Dr. Ananya Sharma"
                value={regName}
                onChange={e => setRegName(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Work Email ID <span className="req">*</span></label>
              <input
                required
                type="email"
                className="form-control"
                placeholder="ananya.sharma@opsvision.com"
                value={regEmail}
                onChange={e => setRegEmail(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Department / Unit</label>
              <input
                className="form-control"
                placeholder="e.g. Information Technology"
                value={regDept}
                onChange={e => setRegDept(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Custom Password <span className="req">*</span></label>
              <input
                required
                type="password"
                className="form-control"
                placeholder="Create password"
                value={regPass}
                onChange={e => setRegPass(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Confirm Password <span className="req">*</span></label>
              <input
                required
                type="password"
                className="form-control"
                placeholder="Confirm password"
                value={regConfirm}
                onChange={e => setRegConfirm(e.target.value)}
              />
            </div>

            <button
              type="submit"
              className="btn-primary"
              style={{ width: '100%' }}
              disabled={loading}
            >
              {loading ? 'Creating Host Profile...' : 'Register Host Profile & Sign In'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// App Shell with Left Sidebar
function App() {
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem('user') || 'null'));

  if (!user) return <Login onLogin={setUser} />;
  return (
    <Shell
      user={user}
      setUser={setUser}
      logout={() => {
        localStorage.clear();
        setUser(null);
      }}
    />
  );
}

// WebAPK / PWA Installation Modal
function WebapkModal({ onClose, deferredPrompt }) {
  const installPwa = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      console.log('WebAPK User Choice:', choice.outcome);
      if (choice.outcome === 'accepted') {
        alert('WebAPK is installing into your Android Apps Screen (App Drawer)!');
      }
      onClose();
    } else {
      alert('To install WebAPK into your Android Apps Screen (App Drawer):\n\n1. Tap Chrome menu (⋮) at top right\n2. Tap "Install App" or "Add to Home Screen"\n3. Android will automatically package and install the native WebAPK into your Apps Drawer!');
    }
  };

  const downloadApkPackage = () => {
    // Generates/opens WebAPK package link or PWABuilder Android APK builder
    const pwaUrl = encodeURIComponent(window.location.origin);
    window.open(`https://www.pwabuilder.com/url?url=${pwaUrl}`, '_blank');
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="webapk-modal-card" onClick={e => e.stopPropagation()}>
        <div className="webapk-hero-box">
          <span className="webapk-badge-pill">Android WebAPK Native Package</span>
          <h2 style={{ margin: '0 0 8px 0', fontSize: '22px' }}>Install OpsVision VAMS WebAPK</h2>
          <p style={{ margin: 0, opacity: 0.95, fontSize: '13px' }}>
            Installs as a native app directly in your <strong>Android Apps Screen (App Drawer)</strong> with system notification support.
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'var(--bg-card-subtle)', padding: '12px 16px', borderRadius: '10px' }}>
            <span style={{ fontSize: '24px' }}>📱</span>
            <div>
              <div style={{ fontWeight: '700', fontSize: '13px' }}>App Drawer & Apps Screen Integration</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Listed alongside native apps in Android Settings & Apps Drawer</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'var(--bg-card-subtle)', padding: '12px 16px', borderRadius: '10px' }}>
            <span style={{ fontSize: '24px' }}>🔔</span>
            <div>
              <div style={{ fontWeight: '700', fontSize: '13px' }}>Native Push & Arrival Notifications</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Instant visitor check-in alerts delivered directly to your device</div>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <button className="btn-webapk" style={{ justifyContent: 'center', padding: '12px', fontSize: '14px' }} onClick={installPwa}>
            <Icons.DownloadApp /> Install WebAPK (App Drawer)
          </button>
          <button className="btn-secondary" style={{ padding: '10px', fontSize: '13px' }} onClick={downloadApkPackage}>
            📦 Build / Download Standalone .APK Package
          </button>
          <button className="btn-secondary" style={{ padding: '8px' }} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// Google Workspace SMTP Settings Modal
function SmtpSettingsModal({ onClose }) {
  const [form, setForm] = useState({ host: 'smtp.gmail.com', port: 465, secure: true, user: '', pass: '', from: '' });
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    api('/admin/smtp-settings')
      .then(data => {
        setForm({
          host: data.host || 'smtp.gmail.com',
          port: data.port || 465,
          secure: data.secure !== false,
          user: data.user || '',
          pass: data.pass || '',
          from: data.from || ''
        });
      })
      .catch(e => setMsg('Error loading SMTP settings: ' + e.message))
      .finally(() => setLoading(false));
  }, []);

  const saveSettings = async (e) => {
    e.preventDefault();
    setMsg('');
    try {
      await api('/admin/smtp-settings', {
        method: 'POST',
        body: JSON.stringify(form)
      });
      setMsg('SMTP settings saved successfully!');
    } catch (err) {
      setMsg('Error saving SMTP: ' + err.message);
    }
  };

  const testEmail = async () => {
    setTesting(true); setMsg('');
    try {
      const res = await api('/admin/test-email', { method: 'POST', body: JSON.stringify({}) });
      setMsg(res.message);
    } catch (err) {
      setMsg('Error: ' + err.message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="pass-card" style={{ maxWidth: '580px' }} onClick={e => e.stopPropagation()}>
        <div className="pass-header" style={{ background: 'linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%)' }}>
          <h3>Google Workspace SMTP Configuration</h3>
          <p>Hostinger VPS Visitor & Host Email Dispatch Credentials</p>
        </div>
        <div className="pass-body">
          {msg && <div className={`alert-box ${msg.startsWith('Error') ? 'alert-error' : 'alert-success'}`}><strong>{msg}</strong></div>}
          {loading ? <div>Loading settings...</div> : (
            <form onSubmit={saveSettings} className="form-grid">
              <div className="form-group">
                <label className="form-label">SMTP Host</label>
                <input className="form-control" value={form.host} onChange={e => setForm({ ...form, host: e.target.value })} placeholder="smtp.gmail.com" required />
              </div>
              <div className="form-group">
                <label className="form-label">Port</label>
                <input className="form-control" type="number" value={form.port} onChange={e => setForm({ ...form, port: Number(e.target.value) })} placeholder="465 or 587" required />
              </div>
              <div className="form-group">
                <label className="form-label">Google Workspace Email <span className="req">*</span></label>
                <input className="form-control" type="email" value={form.user} onChange={e => setForm({ ...form, user: e.target.value })} placeholder="notifications@yourcompany.com" required />
              </div>
              <div className="form-group">
                <label className="form-label">Google App Password (16 chars) <span className="req">*</span></label>
                <input className="form-control" type="password" value={form.pass} onChange={e => setForm({ ...form, pass: e.target.value })} placeholder="App password from Google Security" required />
              </div>
              <div className="form-group full-width">
                <label className="form-label">Sender From Header</label>
                <input className="form-control" value={form.from} onChange={e => setForm({ ...form, from: e.target.value })} placeholder='"OpsVision VAMS" <notifications@yourcompany.com>' />
              </div>
              <div className="form-group full-width" style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                <button type="submit" className="btn-primary" style={{ flex: 1 }}>Save Settings</button>
                <button type="button" className="btn-secondary" disabled={testing} onClick={testEmail}>
                  {testing ? 'Sending...' : '🧪 Send Test Email'}
                </button>
                <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function Shell({ user, setUser, logout }) {
  const [tab, setTab] = useState('dashboard');
  const [currentTime, setCurrentTime] = useState(new Date().toLocaleTimeString());
  const [passData, setPassData] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);

  // App Notifications & WebAPK state
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifDropdown, setShowNotifDropdown] = useState(false);
  const [toastAlert, setToastAlert] = useState(null);
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showWebapkModal, setShowWebapkModal] = useState(false);
  const [showSmtpModal, setShowSmtpModal] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const lastNotifCountRef = useRef(0);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Theme handling (light/dark mode)
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');
  useEffect(() => {
    document.body.classList.toggle('dark-theme', theme === 'dark');
  }, [theme]);
  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
  };

  // Audio alert chime
  const playAlertSound = () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } catch (e) { }
  };

  // PWA beforeinstallprompt listener
  useEffect(() => {
    const handleBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
  }, []);

  // Poll Notifications & Approvals
  const fetchNotifications = () => {
    api('/notifications')
      .then(res => {
        setNotifications(res.notifications || []);
        const unread = res.unreadCount || 0;
        if (unread > lastNotifCountRef.current && lastNotifCountRef.current !== 0) {
          playAlertSound();
          const newest = (res.notifications || [])[0];
          if (newest) {
            setToastAlert(newest);
            setTimeout(() => setToastAlert(null), 6000);
          }
        }
        lastNotifCountRef.current = unread;
        setUnreadCount(unread);
      })
      .catch(() => { });
  };

  const refreshPending = () => {
    api('/approvals')
      .then(res => {
        const p = res.filter(x => x.status === 'PENDING').length;
        setPendingCount(p);
      })
      .catch(() => { });
  };

  useEffect(() => {
    refreshPending();
    fetchNotifications();
    const interval = setInterval(() => {
      refreshPending();
      fetchNotifications();
    }, 5000);
    return () => clearInterval(interval);
  }, [user]);

  const markAllNotifsRead = async () => {
    try {
      await api('/notifications/read-all', { method: 'PUT' });
      fetchNotifications();
    } catch (e) { }
  };

  const viewPass = async (visitId) => {
    try {
      const data = await api(`/visits/${visitId}/pass`);
      setPassData(data);
    } catch (e) {
      alert('Could not load pass: ' + e.message);
    }
  };

  const isHostRole = user.role === 'HOST' || user.role === 'EMPLOYEE';

  const navItems = isHostRole
    ? [
        { id: 'hostpanel', label: 'My Host Panel', icon: Icons.Dashboard, badge: pendingCount > 0 ? pendingCount : null }
      ]
    : [
        { id: 'dashboard', label: 'Dashboard', icon: Icons.Dashboard },
        { id: 'register', label: 'Visitor Registration', icon: Icons.Register, roles: ['SUPER_ADMIN', 'ADMIN', 'RECEPTION', 'GUARD'] },
        { id: 'visitors', label: 'Visitor Directory', icon: Icons.Visitors, roles: ['SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'RECEPTION', 'GUARD'] },
        { id: 'reports', label: 'Reports & Analytics', icon: Icons.Reports, roles: ['SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'RECEPTION'] },
        { id: 'audit', label: 'Digital Audit Trail', icon: Icons.Audit, roles: ['SUPER_ADMIN', 'ADMIN', 'EXECUTIVE'] },
        { id: 'masterdata', label: 'Master Data', icon: Icons.MasterData, roles: ['SUPER_ADMIN', 'ADMIN'] },
        { id: 'usermanagement', label: 'User & Role Control', icon: Icons.Users, roles: ['SUPER_ADMIN', 'ADMIN'] }
      ].filter(item => !item.roles || item.roles.includes(user.role));

  const allowedTabIds = navItems.map(item => item.id);
  const activeTab = allowedTabIds.includes(tab) ? tab : (allowedTabIds[0] || (isHostRole ? 'hostpanel' : 'dashboard'));
  const currentNav = navItems.find(x => x.id === activeTab) || { label: isHostRole ? 'My Host Panel' : 'Dashboard' };

  return (
    <div className="app-container">
      {/* Mobile Drawer Backdrop */}
      {mobileMenuOpen && (
        <div className="sidebar-backdrop" onClick={() => setMobileMenuOpen(false)}></div>
      )}

      {/* Live Toast Alert Banner */}
      {toastAlert && (
        <div className="vams-toast-alert" onClick={() => setToastAlert(null)}>
          <span className="vams-toast-icon">🔔</span>
          <div className="vams-toast-content">
            <strong>{toastAlert.title}</strong>
            <p>{toastAlert.message}</p>
          </div>
        </div>
      )}

      {/* ================= LEFT SIDEBAR ================= */}
      <aside className={`sidebar ${mobileMenuOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-brand">
          <img src="/logo.png" alt="Swagatham Logo" className="sidebar-logo-img" />
          <div className="brand-text">
            <h1>Swagatham</h1>
          </div>
          <button className="mobile-close-btn" onClick={() => setMobileMenuOpen(false)} title="Close Menu">
            <Icons.Close />
          </button>
        </div>

        <div className="sidebar-nav-container">
          <div className="nav-section-title">Navigation</div>
          {navItems.map(item => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                className={`nav-item ${isActive ? 'active' : ''}`}
                onClick={() => {
                  setTab(item.id);
                  setMobileMenuOpen(false);
                }}
              >
                <Icon />
                <span>{item.label}</span>
                {item.badge && <span className="nav-badge">{item.badge}</span>}
              </button>
            );
          })}
        </div>

        <div className="sidebar-user">
          <div className="user-card">
            <div className="user-avatar">
              {user.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
            </div>
            <div className="user-info">
              <div className="user-name">{user.name}</div>
              <span className="user-role-badge">{user.role}</span>
            </div>
          </div>
          <button className="logout-btn" onClick={logout}>
            <Icons.Logout />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* ================= MAIN CONTENT WRAPPER ================= */}
      <div className="main-wrapper">
        <header className="top-header">
          <div className="header-left">
            <button className="hamburger-btn" onClick={() => setMobileMenuOpen(!mobileMenuOpen)} title="Toggle Navigation">
              <Icons.Menu />
            </button>
            <h2 className="page-heading">{currentNav.label}</h2>
          </div>

          <div className="header-right">
            {/* Download WebAPK Button - Admin / Super Admin */}
            {['SUPER_ADMIN', 'ADMIN'].includes(user.role) && (
              <button className="btn-webapk" onClick={() => setShowWebapkModal(true)} title="Download Android WebAPK Native Package">
                <Icons.DownloadApp /> Download WebAPK
              </button>
            )}

            {/* Notification Bell Dropdown */}
            <div className="nav-actions">
              <button className="notification-bell-btn" onClick={() => setShowNotifDropdown(!showNotifDropdown)} title="Notifications">
                <Icons.Bell />
                {unreadCount > 0 && <span className="notification-unread-badge">{unreadCount}</span>}
              </button>

              {showNotifDropdown && (
                <>
                  <div
                    style={{ position: 'fixed', inset: 0, zIndex: 1050, background: 'transparent' }}
                    onClick={() => setShowNotifDropdown(false)}
                  />
                  <div className="notification-dropdown">
                    <div className="notification-header">
                      <h4>Notifications ({unreadCount} new)</h4>
                      {unreadCount > 0 && (
                        <button className="btn-secondary" style={{ padding: '2px 8px', fontSize: '11px' }} onClick={markAllNotifsRead}>
                          Mark all read
                        </button>
                      )}
                    </div>
                    <div className="notification-list">
                      {notifications.length === 0 ? (
                        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                          No notifications yet.
                        </div>
                      ) : (
                        notifications.map(n => (
                          <div key={n.id} className={`notification-item ${!n.read ? 'unread' : ''}`} onClick={() => {
                            if (isHostRole) {
                              setTab('hostpanel');
                            } else {
                              if (n.type === 'VISITOR_REGISTERED' && allowedTabIds.includes('visitors')) setTab('visitors');
                              else if (n.type === 'VISITOR_ENTRY' && allowedTabIds.includes('visitors')) setTab('visitors');
                            }
                            setShowNotifDropdown(false);
                          }}>
                            <span className="notif-title">{n.title}</span>
                            <span className="notif-msg">{n.message}</span>
                            <span className="notif-time">{new Date(n.created_at).toLocaleTimeString()}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* SMTP Settings Button - Admin / Super Admin */}
            {['SUPER_ADMIN', 'ADMIN'].includes(user.role) && (
              <button className="btn-secondary" onClick={() => setShowSmtpModal(true)} title="Email SMTP Settings" style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '8px 12px' }}>
                <Icons.Mail /> SMTP
              </button>
            )}

            <div className="clock-badge">{currentTime}</div>
            <button className="btn-secondary theme-toggle-btn" onClick={toggleTheme} style={{ marginLeft: '4px' }} title="Toggle Theme">
              {theme === 'light' ? '🌙 Dark' : '☀️ Light'}
            </button>
          </div>
        </header>

        <div className="content-body">
          {activeTab === 'hostpanel' && <HostPanel user={user} viewPass={viewPass} refreshPending={refreshPending} />}
          {activeTab === 'dashboard' && <Dashboard user={user} setTab={setTab} viewPass={viewPass} />}
          {activeTab === 'register' && <Register user={user} setTab={setTab} viewPass={viewPass} />}
          {activeTab === 'visitors' && <Visitors user={user} viewPass={viewPass} />}
          {activeTab === 'approvals' && <Approvals user={user} refreshPending={refreshPending} />}
          {activeTab === 'reports' && <Reports />}
          {activeTab === 'audit' && <Audit />}
          {activeTab === 'masterdata' && <MasterData />}
          {activeTab === 'usermanagement' && <UserManagement currentUser={user} />}
        </div>
      </div>

      <PassModal passData={passData} onClose={() => setPassData(null)} />
      {showWebapkModal && <WebapkModal onClose={() => setShowWebapkModal(false)} deferredPrompt={deferredPrompt} />}
      {showSmtpModal && <SmtpSettingsModal onClose={() => setShowSmtpModal(false)} />}
    </div>
  );
}


// ================= UPGRADED DASHBOARD VIEW =================
function Dashboard({ user, setTab, viewPass }) {
  const [stats, setStats] = useState({});
  const [recentVisitors, setRecentVisitors] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadData = () => {
    setLoading(true);
    Promise.all([
      api('/dashboard'),
      api('/visitors')
    ]).then(([d, v]) => {
      setStats(d || {});
      setRecentVisitors((v || []).slice(0, 5));
    }).finally(() => setLoading(false));
  };

  useEffect(loadData, []);

  const kpis = [
    {
      title: 'Visitors Today',
      val: stats.visitorsToday ?? 0,
      icon: Icons.Visitors,
      accent: '#2563eb',
      bg: '#eff6ff',
      footer: 'Logged today'
    },
    {
      title: 'Currently Inside',
      val: stats.currentVisitors ?? 0,
      icon: Icons.EntryExit,
      accent: '#10b981',
      bg: '#ecfdf5',
      footer: 'On Premise'
    },
    {
      title: 'Pending Approvals',
      val: stats.pendingApprovals ?? 0,
      icon: Icons.Approvals,
      accent: '#f59e0b',
      bg: '#fffbeb',
      footer: 'Awaiting host'
    },
    {
      title: 'Approved Passes',
      val: stats.approved ?? 0,
      icon: Icons.Pass,
      accent: '#8b5cf6',
      bg: '#f5f3ff',
      footer: 'Ready for check-in'
    },
    {
      title: 'Declined / Rejected',
      val: stats.rejected ?? 0,
      icon: Icons.Logout,
      accent: '#ef4444',
      bg: '#fef2f2',
      footer: 'Access denied'
    },
    {
      title: 'Completed Visits',
      val: stats.exitedToday ?? 0,
      icon: Icons.Reports,
      accent: '#06b6d4',
      bg: '#ecfeff',
      footer: 'Checked out today'
    },
    {
      title: 'Blocked',
      val: stats.blocked ?? 0,
      icon: Icons.Blocked,
      accent: '#b91c1c',
      bg: '#fef2f2',
      footer: 'Blacklisted'
    }
  ];

  return (
    <div>
      {/* Top Stat Cards */}
      <div className="dashboard-grid">
        {kpis.map((kpi, idx) => {
          const Icon = kpi.icon;
          return (
            <div
              key={idx}
              className="kpi-card"
              style={{ '--kpi-accent': kpi.accent, '--kpi-bg': kpi.bg }}
            >
              <div>
                <div className="kpi-header">
                  <span className="kpi-title">{kpi.title}</span>
                  <div className="kpi-icon">
                    <Icon />
                  </div>
                </div>
                <div className="kpi-value">{loading ? '...' : kpi.val}</div>
              </div>
              <div className="kpi-footer">
                <span>●</span> {kpi.footer}
              </div>
            </div>
          );
        })}
      </div>

      {/* Main 2-Column Split */}
      <div className="dashboard-columns">
        {/* Left column: Recent Visitors & Fast Search */}
        <div className="panel">
          <div className="panel-header">
            <h3 className="panel-title">
              <Icons.Visitors /> {(user.role === 'HOST' || user.role === 'EMPLOYEE') ? 'My Visitor Movements' : 'Recent Visitor Movements'}
            </h3>
            <button className="btn-secondary" onClick={() => setTab('visitors')}>
              {(user.role === 'HOST' || user.role === 'EMPLOYEE') ? 'View My Visitors' : 'View All Directory'}
            </button>
          </div>
          <div className="panel-body" style={{ padding: '0' }}>
            {recentVisitors.length === 0 ? (
              <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)' }}>
                No visitor activity recorded today yet.
              </div>
            ) : (
              <div className="table-container" style={{ border: 'none', borderRadius: 0, boxShadow: 'none' }}>
                <table className="custom-table">
                  <thead>
                    <tr>
                      <th>Pass Code</th>
                      <th>Visitor</th>
                      <th>Host / Dept</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentVisitors.map(v => (
                      <tr key={v.visit_id || v.id}>
                        <td>
                          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: '700', color: 'var(--primary)' }}>
                            {v.visitor_code}
                          </span>
                        </td>
                        <td>
                          <div style={{ fontWeight: '700' }}>{v.name}</div>
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{v.company || 'Individual'} • {v.mobile}</div>
                        </td>
                        <td>
                          <div style={{ fontWeight: '600' }}>{v.host_name || 'N/A'}</div>
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{v.department || 'General'}</div>
                        </td>
                        <td>
                          <StatusBadge status={v.status} />
                        </td>
                        <td>
                          <button
                            className="btn-secondary"
                            style={{ padding: '5px 10px', fontSize: '12px' }}
                            onClick={() => viewPass(v.visit_id)}
                          >
                            Digital Pass
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Right column: Quick Actions & Workflow Guide */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div className="panel">
            <div className="panel-header">
              <h3 className="panel-title">Quick Actions</h3>
            </div>
            <div className="panel-body">
              <div className="quick-actions-grid">
                {(user.role === 'ADMIN' || user.role === 'GUARD' || user.role === 'RECEPTION') && (
                  <button className="quick-action-btn" onClick={() => setTab('register')}>
                    <Icons.Register />
                    <span>+ New Visitor</span>
                  </button>
                )}
                <button className="quick-action-btn" onClick={() => setTab('approvals')}>
                  <Icons.Approvals />
                  <span>Approvals</span>
                </button>
                <button className="quick-action-btn" onClick={() => setTab('visitors')}>
                  <Icons.Visitors />
                  <span>{(user.role === 'HOST' || user.role === 'EMPLOYEE') ? 'My Visitors' : 'Visitor Logs'}</span>
                </button>
                {(user.role === 'ADMIN' || user.role === 'RECEPTION') && (
                  <button className="quick-action-btn" onClick={() => setTab('reports')}>
                    <Icons.Reports />
                    <span>Print Report</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <h3 className="panel-title">Access Lifecycle</h3>
            </div>
            <div className="panel-body">
              <div className="workflow-steps">
                <div className="workflow-step">
                  <div className="step-num">1</div>
                  <div className="step-info">
                    <h4>Host Approval</h4>
                    <p>Host receives notification & approves request</p>
                  </div>
                </div>
                <div className="workflow-step">
                  <div className="step-num">2</div>
                  <div className="step-info">
                    <h4>Pass Issuance & Entry</h4>
                    <p>QR badge scanned at gate for instant check-in</p>
                  </div>
                </div>
                <div className="workflow-step">
                  <div className="step-num">3</div>
                  <div className="step-info">
                    <h4>Exit & Audit Logging</h4>
                    <p>stamped with audit compliance</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
// ================= WEBCAM CAPTURE =================
function WebcamCapture({ onCapture, onCancel, mandatory }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [stream, setStream] = useState(null);

  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ video: true })
      .then(s => {
        setStream(s);
        if (videoRef.current) videoRef.current.srcObject = s;
      })
      .catch(err => console.error('Error accessing webcam:', err));
    return () => {
      if (stream) stream.getTracks().forEach(t => t.stop());
    };
  }, []);

  const capture = () => {
    if (videoRef.current && canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      canvasRef.current.width = videoRef.current.videoWidth;
      canvasRef.current.height = videoRef.current.videoHeight;
      ctx.drawImage(videoRef.current, 0, 0, canvasRef.current.width, canvasRef.current.height);
      const dataUrl = canvasRef.current.toDataURL('image/jpeg');
      onCapture(dataUrl);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', marginTop: '15px' }}>
      <video ref={videoRef} autoPlay playsInline style={{ width: '100%', maxWidth: '300px', borderRadius: '8px' }} />
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      <div style={{ display: 'flex', gap: '10px' }}>
        <button className="btn-primary" onClick={capture}>Take Photo</button>
        {!mandatory && <button className="btn-secondary" onClick={onCancel}>Skip</button>}
      </div>
    </div>
  );
}

// ================= REGISTRATION VIEW =================
function Register({ setTab, viewPass }) {
  const [hosts, setHosts] = useState([]);
  const [form, setForm] = useState({ consent: true });
  const [out, setOut] = useState(null);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [photoSaved, setPhotoSaved] = useState(false);
  const [departments, setDepartments] = useState([]);
  const [purposes, setPurposes] = useState([]);
  const [purposeOther, setPurposeOther] = useState(false);
  const [departmentOther, setDepartmentOther] = useState(false);

  useEffect(() => {
    api('/hosts').then(setHosts).catch(() => { });
    api('/master/departments').then(setDepartments).catch(() => { });
    api('/master/purposes').then(setPurposes).catch(() => { });
  }, []);

  const setField = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    if (!/^\d{10}$/.test(form.mobile || '')) {
      setMsg('Error: Mobile number must be exactly 10 digits');
      return;
    }
    if (!form.expected_checkin || !form.expected_checkout) {
      setMsg('Error: Expected check-in and check-out time are required');
      return;
    }
    if (new Date(form.expected_checkout) <= new Date(form.expected_checkin)) {
      setMsg('Error: Check-out time must be later than check-in time');
      return;
    }
    setLoading(true);
    setMsg('');
    try {
      const d = await api('/visitors/register', {
        method: 'POST',
        body: JSON.stringify(form)
      });
      setOut(d);
      setShowCamera(true);
      setPhotoSaved(false);
      setMsg('Visitor registered successfully! Demo OTP and Pass Code generated.');
    } catch (err) {
      setMsg('Error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="panel" style={{ maxWidth: '840px', margin: '0 auto' }}>
      <div className="panel-header">
        <h3 className="panel-title">
          <Icons.Register /> Register New Visitor
        </h3>
      </div>
      <div className="panel-body">
        {msg && (
          <div className={`alert-box ${msg.startsWith('Error') ? 'alert-error' : 'alert-success'}`}>
            <div>
              <strong>{msg}</strong>
              {out && (
                <div style={{ marginTop: '8px', fontSize: '13px' }}>
                  <div><b>Visitor Code:</b> {out.visitorCode}</div>
                  <div><b>Demo OTP:</b> <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 'bold', fontSize: '15px' }}>{out.otp}</span> (Use this or 123456 to verify)</div>
                </div>
              )}
            </div>
            {out && (
              <div style={{ marginTop: '15px' }}>
                {showCamera ? (
                  <div style={{ padding: '15px', border: '1px solid var(--border-color)', borderRadius: '8px', backgroundColor: 'var(--bg-card-subtle)' }}>
                    <h4 style={{ margin: '0 0 10px 0', textAlign: 'center' }}>Capture Visitor Photo (Mandatory)</h4>
                    <WebcamCapture
                      mandatory={true}
                      onCapture={async (dataUrl) => {
                        try {
                          await api(`/visitors/${out.id}/photo`, {
                            method: 'POST',
                            body: JSON.stringify({ photo: dataUrl })
                          });
                          setPhotoSaved(true);
                          setShowCamera(false);
                          setMsg(prev => prev + ' Photo saved successfully.');
                        } catch (err) {
                          setMsg('Error saving photo: ' + err.message);
                        }
                      }}
                      onCancel={() => setShowCamera(false)}
                    />
                  </div>
                ) : (
                  <button
                    className="btn-primary"
                    onClick={() => viewPass(out.visitId)}
                  >
                    View Digital Pass
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="form-grid">
          <div className="form-group">
            <label className="form-label">Full Name <span className="req">*</span></label>
            <input
              required
              className="form-control"
              placeholder="e.g. Ramesh Kumar"
              onChange={e => setField('name', e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Mobile Number <span className="req">*</span></label>
            <input
              required
              type="tel"
              inputMode="numeric"
              maxLength={10}
              pattern="[0-9]{10}"
              className="form-control"
              placeholder="10-digit number (e.g. 9876543210)"
              value={form.mobile || ''}
              onChange={e => {
                const val = e.target.value.replace(/\D/g, '').slice(0, 10);
                setField('mobile', val);
              }}
            />
            <small style={{ fontSize: '11.5px', color: (form.mobile && form.mobile.length !== 10) ? 'var(--danger)' : 'var(--text-muted)' }}>
              {form.mobile ? `${form.mobile.length}/10 digits` : 'Must be exactly 10 digits (digits only)'}
            </small>
          </div>

          <div className="form-group">
            <label className="form-label">Email Address</label>
            <input
              type="email"
              className="form-control"
              placeholder="e.g. spoorthy@company.com"
              onChange={e => setField('email', e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Company / Organization</label>
            <input
              className="form-control"
              placeholder="e.g. Spandana Technologies"
              onChange={e => setField('company', e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Person to Meet (Host) <span className="req">*</span></label>
            <select
              required
              className="form-control"
              value={form.host_id || ''}
              onChange={e => setField('host_id', e.target.value)}
            >
              <option value="">Select Person to Meet (Host)</option>
              {hosts.map(x => (
                <option value={x.id} key={x.id}>
                  {x.name} ({x.department || x.role})
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Purpose of Visit <span className="req">*</span></label>
            <select
              required
              className="form-control"
              value={purposeOther ? '__other__' : (form.purpose || '')}
              onChange={e => {
                if (e.target.value === '__other__') {
                  setPurposeOther(true);
                } else {
                  setField('purpose', e.target.value);
                  setPurposeOther(false);
                }
              }}
            >
              <option value="">Select Purpose</option>
              {purposes.map(p => <option value={p.name} key={p.id}>{p.name}</option>)}
              <option value="__other__">Other (specify below)</option>
            </select>
            {purposeOther && (
              <input
                required
                className="form-control"
                style={{ marginTop: '8px' }}
                placeholder="Specify purpose of visit..."
                value={form.purpose || ''}
                onChange={e => setField('purpose', e.target.value)}
              />
            )}
          </div>

          <div className="form-group">
            <label className="form-label">Department / Area</label>
            <select
              className="form-control"
              value={departmentOther ? '__other__' : (form.department || '')}
              onChange={e => {
                if (e.target.value === '__other__') {
                  setDepartmentOther(true);
                } else {
                  setField('department', e.target.value);
                  setDepartmentOther(false);
                }
              }}
            >
              <option value="">Select Department</option>
              {departments.map(d => <option value={d.name} key={d.id}>{d.name}{d.code ? ` [${d.code}]` : ''}</option>)}
              <option value="__other__">Other (specify below)</option>
            </select>
            {departmentOther && (
              <input
                className="form-control"
                style={{ marginTop: '8px' }}
                placeholder="Specify department / area..."
                value={form.department || ''}
                onChange={e => setField('department', e.target.value)}
              />
            )}
          </div>

          <div className="form-group">
            <label className="form-label">Check-in Time <span className="req">*</span></label>
            <input
              required
              type="datetime-local"
              className="form-control"
              value={form.expected_checkin || ''}
              onChange={e => setField('expected_checkin', e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label"> Check-out Time <span className="req">*</span></label>
            <input
              required
              type="datetime-local"
              className="form-control"
              value={form.expected_checkout || ''}
              onChange={e => setField('expected_checkout', e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Vehicle Registration (Optional)</label>
            <input
              className="form-control"
              placeholder="e.g. KA-02-AB-1234"
              onChange={e => setField('vehicle', e.target.value)}
            />
          </div>

          <div className="form-group full-width">
            <label className="checkbox-label">
              <input
                type="checkbox"
                defaultChecked
                onChange={e => setField('consent', e.target.checked)}
              />
              <span>I confirm that the visitor has consented to health, security, and digital badge policies.</span>
            </label>
          </div>

          <div className="form-group full-width" style={{ marginTop: '10px' }}>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Registering...' : 'Submit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ================= VISITOR DIRECTORY VIEW =================
// Robustly format timestamps stored by SQLite (CURRENT_TIMESTAMP -> "YYYY-MM-DD HH:MM:SS", UTC)
// or as ISO-8601 strings (e.g. valid_until). Returns "" for empty/invalid input.
function fmtDateTime(val) {
  if (!val) return '';
  let s = String(val).trim();
  // SQLite CURRENT_TIMESTAMP stores UTC without a timezone marker
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
    s = s.replace(' ', 'T') + 'Z'; // interpret as UTC
  }
  const d = s === 'Z' ? null : new Date(s);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString();
}
function Visitors({ user, viewPass }) {
  const [data, setData] = useState([]);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [err, setErr] = useState('');
  const [hosts, setHosts] = useState([]);
  const [purposes, setPurposes] = useState([]);
  const [editRow, setEditRow] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editMsg, setEditMsg] = useState('');

  const load = () => {
    setLoading(true);
    let url = `/visitors?name=${encodeURIComponent(q)}`;
    if (statusFilter) url += `&status=${encodeURIComponent(statusFilter)}`;
    api(url)
      .then(setData)
      .finally(() => setLoading(false));
  };

  useEffect(load, [statusFilter]);

  const canGate = user && ['GUARD', 'RECEPTION', 'ADMIN'].includes(user.role);

  useEffect(() => {
    if (canGate) api('/hosts').then(setHosts).catch(() => { });
    api('/master/purposes').then(setPurposes).catch(() => { });
  }, [canGate]);

  const doCheckIn = async (r) => {
    if (!confirm(`Check in ${r.name} now?`)) return;
    setBusyId(r.visit_id); setErr('');
    try {
      await api(`/visits/${r.visit_id}/entry`, { method: 'POST' });
      load();
    } catch (e) { setErr('Error: ' + e.message); }
    finally { setBusyId(null); }
  };

  const doCheckOut = async (r) => {
    if (!confirm(`Check out ${r.name} now?`)) return;
    setBusyId(r.visit_id); setErr('');
    try {
      await api(`/visits/${r.visit_id}/exit`, { method: 'POST' });
      load();
    } catch (e) { setErr('Error: ' + e.message); }
    finally { setBusyId(null); }
  };

  // Convert a stored timestamp to a value usable by <input type="datetime-local">
  const toLocalDl = (val) => {
    if (!val) return '';
    const m = String(val).match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/);
    return m ? m[1] : '';
  };

  const openEdit = (r) => {
    setEditForm({
      name: r.name || '',
      mobile: r.mobile || '',
      email: r.email || '',
      company: r.company || '',
      purpose: r.purpose || '',
      host_id: r.host_id || '',
      department: r.department || '',
      vehicle: r.vehicle || '',
      expected_checkin: toLocalDl(r.expected_checkin),
      expected_checkout: toLocalDl(r.expected_checkout)
    });
    setEditMsg('');
    setEditRow(r);
  };

  const saveEdit = async () => {
    if (!/^\d{10}$/.test(editForm.mobile || '')) { setEditMsg('Mobile number must be exactly 10 digits'); return; }
    if (!editForm.expected_checkin || !editForm.expected_checkout) { setEditMsg('Expected check-in and check-out time are required'); return; }
    if (new Date(editForm.expected_checkout) <= new Date(editForm.expected_checkin)) { setEditMsg('Check-out time must be later than check-in time'); return; }
    setBusyId(editRow.visit_id); setEditMsg(''); setErr('');
    try {
      await api(`/visitors/${editRow.id}`, {
        method: 'PUT', body: JSON.stringify({
          name: editForm.name, mobile: editForm.mobile, email: editForm.email, company: editForm.company,
          purpose: editForm.purpose, host_id: editForm.host_id, department: editForm.department, vehicle: editForm.vehicle,
          expected_checkin: editForm.expected_checkin, expected_checkout: editForm.expected_checkout
        })
      });
      setEditRow(null);
      load();
    } catch (e) { setEditMsg('Error: ' + e.message); }
    finally { setBusyId(null); }
  };

  const doDelete = async (r) => {
    if (!confirm(`Delete visitor record for ${r.name}? This cannot be undone.`)) return;
    setBusyId(r.visit_id); setErr('');
    try {
      await api(`/visitors/${r.id}`, { method: 'DELETE' });
      load();
    } catch (e) { setErr('Error: ' + e.message); }
    finally { setBusyId(null); }
  };

  const setEdit = (k, v) => setEditForm(prev => ({ ...prev, [k]: v }));

  return (
    <div>
      <div className="toolbar-container">
        <div className="search-input-group">
          <input
            className="form-control"
            placeholder="Search by visitor name..."
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && load()}
          />
          <button className="btn-primary" onClick={load}>Search</button>
        </div>

        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {['', 'INSIDE', 'APPROVED', 'PENDING_APPROVAL', 'CLOSED'].map(s => (
            <button
              key={s}
              className={`btn-secondary ${statusFilter === s ? 'btn-primary' : ''}`}
              style={{ padding: '7px 12px', fontSize: '12px' }}
              onClick={() => setStatusFilter(s)}
            >
              {s === '' ? 'All Visitors' : s.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      {err && <div className="alert-box alert-error" style={{ marginBottom: '12px' }}><strong>{err}</strong></div>}

      <div className="table-container">
        <table className="custom-table">
          <thead>
            <tr>
              <th>Pass ID</th>
              <th>Visitor Details</th>
              <th>Host Contact</th>
              <th>Status</th>
              <th>Entry Time</th>
              <th>Exit Time</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="7" style={{ textAlign: 'center', padding: '30px' }}>Loading visitor records...</td></tr>
            ) : data.length === 0 ? (
              <tr><td colSpan="7" style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>No visitors match criteria.</td></tr>
            ) : (
              data.map(r => (
                <tr key={r.visit_id || r.id}>
                  <td>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: '700', color: 'var(--primary)' }}>
                      {r.visitor_code}
                    </span>
                  </td>
                  <td>
                    <div style={{ fontWeight: '700' }}>{r.name}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{r.company || 'Individual'} • {r.mobile}</div>
                  </td>
                  <td>
                    <div style={{ fontWeight: '600' }}>{r.host_name || 'N/A'}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{r.purpose}</div>
                  </td>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                  <td>{fmtDateTime(r.entry_time) || '-'}</td>
                  <td>{fmtDateTime(r.exit_time) || '-'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                      <button
                        className="btn-secondary"
                        style={{ padding: '6px 10px', fontSize: '12px' }}
                        onClick={() => viewPass(r.visit_id)}
                      >
                        Pass QR
                      </button>
                      {canGate && r.status === 'APPROVED' && (
                        <button
                          className="btn-primary"
                          style={{ padding: '6px 10px', fontSize: '12px' }}
                          disabled={busyId === r.visit_id}
                          onClick={() => doCheckIn(r)}
                        >
                          {busyId === r.visit_id ? '...' : 'Check In'}
                        </button>
                      )}
                      {canGate && r.status === 'INSIDE' && (
                        <button
                          className="btn-secondary"
                          style={{ padding: '6px 10px', fontSize: '12px', color: 'var(--danger)', borderColor: 'var(--danger-border)' }}
                          disabled={busyId === r.visit_id}
                          onClick={() => doCheckOut(r)}
                        >
                          {busyId === r.visit_id ? '...' : 'Check Out'}
                        </button>
                      )}
                      {canGate && (
                        <>
                          <button
                            className="btn-secondary"
                            style={{ padding: '6px 10px', fontSize: '12px' }}
                            disabled={busyId === r.visit_id}
                            onClick={() => openEdit(r)}
                          >
                            Edit
                          </button>
                          <button
                            className="btn-secondary"
                            style={{ padding: '6px 10px', fontSize: '12px', color: 'var(--danger)', borderColor: 'var(--danger-border)' }}
                            disabled={busyId === r.visit_id}
                            onClick={() => doDelete(r)}
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editRow && (
        <div className="modal-overlay" onClick={() => setEditRow(null)}>
          <div className="pass-card" style={{ maxWidth: '640px' }} onClick={e => e.stopPropagation()}>
            <div className="pass-header">
              <h3>Edit Visitor — {editRow.name}</h3>
            </div>
            <div className="pass-body">
              {editMsg && <div className={`alert-box ${editMsg.startsWith('Error') ? 'alert-error' : 'alert-success'}`}><strong>{editMsg}</strong></div>}
              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label">Full Name <span className="req">*</span></label>
                  <input className="form-control" value={editForm.name || ''} onChange={e => setEdit('name', e.target.value)} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Mobile <span className="req">*</span></label>
                  <input className="form-control" inputMode="numeric" maxLength={10} value={editForm.mobile || ''}
                    onChange={e => setEdit('mobile', e.target.value.replace(/\D/g, '').slice(0, 10))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input type="email" className="form-control" value={editForm.email || ''} onChange={e => setEdit('email', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Company</label>
                  <input className="form-control" value={editForm.company || ''} onChange={e => setEdit('company', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Person to Meet (Host) <span className="req">*</span></label>
                  <select className="form-control" value={editForm.host_id || ''} onChange={e => setEdit('host_id', e.target.value)}>
                    <option value="">Select Host</option>
                    {hosts.map(x => <option value={x.id} key={x.id}>{x.name} ({x.department || x.role})</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Purpose <span className="req">*</span></label>
                  <select className="form-control" value={editForm.purpose || ''} onChange={e => setEdit('purpose', e.target.value)}>
                    <option value="">Select Purpose</option>
                    {purposes.map(p => <option value={p.name} key={p.id}>{p.name}</option>)}
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Department / Area</label>
                  <input className="form-control" value={editForm.department || ''} onChange={e => setEdit('department', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Vehicle Registration</label>
                  <input className="form-control" value={editForm.vehicle || ''} onChange={e => setEdit('vehicle', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Expected Check-in <span className="req">*</span></label>
                  <input type="datetime-local" className="form-control" value={editForm.expected_checkin || ''} onChange={e => setEdit('expected_checkin', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Expected Check-out <span className="req">*</span></label>
                  <input type="datetime-local" className="form-control" value={editForm.expected_checkout || ''} onChange={e => setEdit('expected_checkout', e.target.value)} />
                </div>
              </div>
              <div style={{ marginTop: '16px', display: 'flex', gap: '10px' }}>
                <button className="btn-primary" style={{ flex: 1 }} disabled={busyId === editRow.visit_id} onClick={saveEdit}>Save Changes</button>
                <button className="btn-secondary" onClick={() => setEditRow(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ================= DEDICATED HOST PANEL (ISOLATED WORKSPACE) =================
function HostPanel({ user, viewPass, refreshPending }) {
  const [approvals, setApprovals] = useState([]);
  const [visitors, setVisitors] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [busyVisitId, setBusyVisitId] = useState(null);

  const loadHostData = () => {
    setLoading(true);
    let vUrl = `/visitors?name=${encodeURIComponent(q)}`;
    if (statusFilter) vUrl += `&status=${encodeURIComponent(statusFilter)}`;

    Promise.all([
      api('/approvals'),
      api(vUrl),
      api('/dashboard')
    ])
      .then(([a, v, s]) => {
        setApprovals(a || []);
        setVisitors(v || []);
        setStats(s || {});
      })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(loadHostData, [statusFilter]);

  const actOnApproval = async (visitId, action) => {
    setBusyVisitId(visitId);
    setMsg('');
    setErr('');
    try {
      await api('/approvals/' + visitId, {
        method: 'POST',
        body: JSON.stringify({ action })
      });
      setMsg(`Visit successfully ${action === 'APPROVE' ? 'Approved' : 'Declined'}`);
      loadHostData();
      if (refreshPending) refreshPending();
    } catch (e) {
      setErr('Error: ' + e.message);
    } finally {
      setBusyVisitId(null);
    }
  };

  const pendingList = approvals.filter(a => a.status === 'PENDING');

  return (
    <div className="host-panel-container">
      {/* Host Banner */}
      <div className="panel" style={{ marginBottom: '20px', background: 'linear-gradient(135deg, rgba(37,99,235,0.08) 0%, rgba(59,130,246,0.02) 100%)', border: '1px solid rgba(37,99,235,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
              <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 800 }}>Welcome, {user.name}</h2>
              <span className="badge badge-inside" style={{ fontSize: '11px' }}>Host Profile</span>
            </div>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>
              🔒 <b>Private Host Workspace:</b> You are viewing visitor movements and approval requests specifically assigned to you ({user.department || 'General'}).
            </p>
          </div>
          <button className="btn-secondary" onClick={loadHostData} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span>🔄 Refresh Panel</span>
          </button>
        </div>
      </div>

      {msg && <div className="alert-box alert-success" style={{ marginBottom: '16px' }}>{msg}</div>}
      {err && <div className="alert-box alert-error" style={{ marginBottom: '16px' }}>{err}</div>}

      {/* Host Metrics */}
      <div className="dashboard-grid" style={{ marginBottom: '24px' }}>
        <div className="kpi-card" style={{ '--kpi-accent': '#f59e0b', '--kpi-bg': '#fffbeb' }}>
          <div>
            <div className="kpi-header">
              <span className="kpi-title">Pending Approvals</span>
              <div className="kpi-icon"><Icons.Approvals /></div>
            </div>
            <div className="kpi-value">{loading ? '...' : (pendingList.length)}</div>
          </div>
          <div className="kpi-footer"><span>●</span> Awaiting your review</div>
        </div>
        <div className="kpi-card" style={{ '--kpi-accent': '#10b981', '--kpi-bg': '#ecfdf5' }}>
          <div>
            <div className="kpi-header">
              <span className="kpi-title">Currently Inside</span>
              <div className="kpi-icon"><Icons.EntryExit /></div>
            </div>
            <div className="kpi-value">{loading ? '...' : (stats.currentVisitors ?? 0)}</div>
          </div>
          <div className="kpi-footer"><span>●</span> With you in facility</div>
        </div>
        <div className="kpi-card" style={{ '--kpi-accent': '#2563eb', '--kpi-bg': '#eff6ff' }}>
          <div>
            <div className="kpi-header">
              <span className="kpi-title">Today\'s Visitors</span>
              <div className="kpi-icon"><Icons.Visitors /></div>
            </div>
            <div className="kpi-value">{loading ? '...' : (stats.visitorsToday ?? 0)}</div>
          </div>
          <div className="kpi-footer"><span>●</span> Scheduled today</div>
        </div>
        <div className="kpi-card" style={{ '--kpi-accent': '#06b6d4', '--kpi-bg': '#ecfeff' }}>
          <div>
            <div className="kpi-header">
              <span className="kpi-title">Completed Visits</span>
              <div className="kpi-icon"><Icons.Reports /></div>
            </div>
            <div className="kpi-value">{loading ? '...' : (stats.exitedToday ?? 0)}</div>
          </div>
          <div className="kpi-footer"><span>●</span> Checked out today</div>
        </div>
      </div>

      {/* Section 1: Pending Approvals for this Host */}
      <div className="panel" style={{ marginBottom: '24px' }}>
        <div className="panel-header">
          <h3 className="panel-title">
            <Icons.Approvals /> Action Required: My Pending Approvals
            {pendingList.length > 0 && (
              <span className="nav-badge" style={{ marginLeft: '8px', background: 'var(--danger)', color: '#fff' }}>
                {pendingList.length}
              </span>
            )}
          </h3>
        </div>
        <div className="panel-body" style={{ padding: 0 }}>
          {loading ? (
            <div style={{ padding: '30px', textAlign: 'center' }}>Loading approvals...</div>
          ) : pendingList.length === 0 ? (
            <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)' }}>
              ✅ You have no pending visitor approval requests. All caught up!
            </div>
          ) : (
            <div className="table-container" style={{ border: 'none', boxShadow: 'none' }}>
              <table className="custom-table">
                <thead>
                  <tr>
                    <th>Visitor Details</th>
                    <th>Organization</th>
                    <th>Purpose of Meeting</th>
                    <th>Pass ID</th>
                    <th>Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingList.map(a => (
                    <tr key={a.id}>
                      <td>
                        <div style={{ fontWeight: 700 }}>{a.visitor_name}</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>📱 {a.mobile}</div>
                      </td>
                      <td>{a.company || 'Individual Guest'}</td>
                      <td>
                        <span style={{ fontWeight: 600 }}>{a.purpose}</span>
                      </td>
                      <td>
                        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--primary)' }}>
                          {a.visitor_code}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            className="btn-success"
                            disabled={busyVisitId === a.visit_id}
                            onClick={() => actOnApproval(a.visit_id, 'APPROVE')}
                          >
                            {busyVisitId === a.visit_id ? '...' : '✓ Approve'}
                          </button>
                          <button
                            className="btn-danger"
                            disabled={busyVisitId === a.visit_id}
                            onClick={() => actOnApproval(a.visit_id, 'DECLINE')}
                          >
                            {busyVisitId === a.visit_id ? '...' : '✕ Decline'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Section 2: My Visitors Directory & Passes */}
      <div className="panel">
        <div className="panel-header">
          <h3 className="panel-title">
            <Icons.Visitors /> My Visitor Records & Digital Passes
          </h3>
        </div>
        <div className="panel-body">
          <div className="toolbar-container" style={{ marginBottom: '16px' }}>
            <div className="search-input-group">
              <input
                className="form-control"
                placeholder="Search by visitor name..."
                value={q}
                onChange={e => setQ(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && loadHostData()}
              />
              <button className="btn-primary" onClick={loadHostData}>Search</button>
            </div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {['', 'INSIDE', 'APPROVED', 'PENDING_APPROVAL', 'CLOSED', 'REJECTED'].map(s => (
                <button
                  key={s}
                  className={`btn-secondary ${statusFilter === s ? 'btn-primary' : ''}`}
                  style={{ padding: '7px 12px', fontSize: '12px' }}
                  onClick={() => setStatusFilter(s)}
                >
                  {s === '' ? 'All My Visitors' : s.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>

          <div className="table-container" style={{ border: 'none', boxShadow: 'none' }}>
            <table className="custom-table">
              <thead>
                <tr>
                  <th>Pass Code</th>
                  <th>Visitor</th>
                  <th>Purpose</th>
                  <th>Status</th>
                  <th>Entry / Exit</th>
                  <th>Digital Badge</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan="6" style={{ textAlign: 'center', padding: '30px' }}>Loading visitors...</td></tr>
                ) : visitors.length === 0 ? (
                  <tr><td colSpan="6" style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>No visitors found matching filter.</td></tr>
                ) : (
                  visitors.map(v => (
                    <tr key={v.visit_id || v.id}>
                      <td>
                        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--primary)' }}>
                          {v.visitor_code}
                        </span>
                      </td>
                      <td>
                        <div style={{ fontWeight: 700 }}>{v.name}</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                          {v.company || 'Individual'} • {v.mobile}
                        </div>
                      </td>
                      <td>{v.purpose}</td>
                      <td><StatusBadge status={v.status} /></td>
                      <td>
                        <div style={{ fontSize: '12px' }}>
                          <div>In: {v.entry_time ? fmtDateTime(v.entry_time) : <span style={{ color: 'var(--text-muted)' }}>-</span>}</div>
                          <div>Out: {v.exit_time ? fmtDateTime(v.exit_time) : <span style={{ color: 'var(--text-muted)' }}>-</span>}</div>
                        </div>
                      </td>
                      <td>
                        <button
                          className="btn-secondary"
                          style={{ padding: '5px 10px', fontSize: '12px' }}
                          onClick={() => viewPass(v.visit_id)}
                        >
                          Digital Pass
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ================= HOST APPROVALS VIEW =================
function Approvals({ user, refreshPending }) {
  const [approvals, setApprovals] = useState([]);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api('/approvals')
      .then(setApprovals)
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const act = async (visitId, action) => {
    try {
      await api('/approvals/' + visitId, {
        method: 'POST',
        body: JSON.stringify({ action })
      });
      setMsg(`Visit successfully ${action === 'APPROVE' ? 'Approved' : 'Declined'}`);
      load();
      if (refreshPending) refreshPending();
    } catch (e) {
      setMsg('Error: ' + e.message);
    }
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <h3 className="panel-title">
          <Icons.Approvals /> Host Access Approvals
        </h3>
        <button className="btn-secondary" onClick={load}>Refresh</button>
      </div>
      <div className="panel-body">
        {msg && <div className="alert-box alert-success">{msg}</div>}

        <div className="table-container" style={{ border: 'none', boxShadow: 'none' }}>
          <table className="custom-table">
            <thead>
              <tr>
                <th>Visitor</th>
                <th>Company</th>
                <th>Purpose</th>
                <th>Host</th>
                <th>Status</th>
                <th>Decision Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="6" style={{ textAlign: 'center', padding: '30px' }}>Loading approvals...</td></tr>
              ) : approvals.length === 0 ? (
                <tr><td colSpan="6" style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>No pending approval requests.</td></tr>
              ) : (
                approvals.map(a => (
                  <tr key={a.id}>
                    <td>
                      <div style={{ fontWeight: '700' }}>{a.visitor_name}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{a.mobile}</div>
                    </td>
                    <td>{a.company || 'Individual'}</td>
                    <td>{a.purpose}</td>
                    <td>{a.host_name}</td>
                    <td><StatusBadge status={a.status} /></td>
                    <td>
                      {a.status === 'PENDING' ? (
                        user && user.role === 'EXECUTIVE' ? (
                          <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: '600' }}>🔒 Executive View (Read-Only)</span>
                        ) : (
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button className="btn-success" onClick={() => act(a.visit_id, 'APPROVE')}>
                              Approve
                            </button>
                            <button className="btn-danger" onClick={() => act(a.visit_id, 'DECLINE')}>
                              Decline
                            </button>
                          </div>
                        )
                      ) : (
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: '600' }}>Completed</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ================= GATE CHECK-IN & CHECK-OUT =================

// ================= INTERACTIVE PIE CHART COMPONENT =================
function PieChart({ data, size = 220 }) {
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (total === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: size, color: 'var(--text-muted)', fontSize: '14px' }}>
        No data available
      </div>
    );
  }

  const cx = size / 2, cy = size / 2, radius = size / 2 - 16;
  let cumAngle = -Math.PI / 2;
  const slices = data.map((d, i) => {
    const angle = (d.value / total) * 2 * Math.PI;
    const startAngle = cumAngle;
    cumAngle += angle;
    const endAngle = cumAngle;
    const largeArc = angle > Math.PI ? 1 : 0;
    const midAngle = startAngle + angle / 2;
    const isHovered = hoveredIndex === i;
    const pullOut = isHovered ? 8 : 0;
    const dx = Math.cos(midAngle) * pullOut;
    const dy = Math.sin(midAngle) * pullOut;
    const x1 = cx + Math.cos(startAngle) * radius + dx;
    const y1 = cy + Math.sin(startAngle) * radius + dy;
    const x2 = cx + Math.cos(endAngle) * radius + dx;
    const y2 = cy + Math.sin(endAngle) * radius + dy;
    const path = `M ${cx + dx} ${cy + dy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;
    const pct = ((d.value / total) * 100).toFixed(1);
    // Label position
    const labelR = radius * 0.65;
    const lx = cx + Math.cos(midAngle) * labelR + dx;
    const ly = cy + Math.sin(midAngle) * labelR + dy;
    return { ...d, path, pct, lx, ly, isHovered, idx: i };
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.08))' }}>
        <defs>
          {data.map((d, i) => (
            <filter key={i} id={`pie-glow-${i}`}>
              <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor={d.color} floodOpacity="0.4" />
            </filter>
          ))}
        </defs>
        {slices.map(s => (
          <g key={s.idx}>
            <path
              d={s.path}
              fill={s.color}
              stroke="#fff"
              strokeWidth="2"
              style={{
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                filter: s.isHovered ? `url(#pie-glow-${s.idx})` : 'none',
                opacity: hoveredIndex !== null && !s.isHovered ? 0.55 : 1,
                cursor: 'pointer'
              }}
              onMouseEnter={() => setHoveredIndex(s.idx)}
              onMouseLeave={() => setHoveredIndex(null)}
            />
            {s.value / total > 0.06 && (
              <text
                x={s.lx} y={s.ly}
                textAnchor="middle" dominantBaseline="central"
                fill="#fff" fontSize="11" fontWeight="700"
                style={{ pointerEvents: 'none', textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}
              >
                {s.pct}%
              </text>
            )}
          </g>
        ))}
        {/* Center donut hole */}
        <circle cx={cx} cy={cy} r={radius * 0.38} fill="var(--bg-card, #fff)" stroke="none" />
        <text x={cx} y={cy - 8} textAnchor="middle" fill="var(--text-main)" fontSize="20" fontWeight="800">{total}</text>
        <text x={cx} y={cy + 10} textAnchor="middle" fill="var(--text-muted)" fontSize="10" fontWeight="600">TOTAL</text>
      </svg>

      {/* Legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', justifyContent: 'center' }}>
        {data.map((d, i) => (
          <div
            key={i}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: '600',
              padding: '4px 10px', borderRadius: '20px',
              background: hoveredIndex === i ? d.color + '18' : 'transparent',
              border: hoveredIndex === i ? `1px solid ${d.color}40` : '1px solid transparent',
              cursor: 'pointer', transition: 'all 0.2s ease'
            }}
            onMouseEnter={() => setHoveredIndex(i)}
            onMouseLeave={() => setHoveredIndex(null)}
          >
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: d.color, flexShrink: 0, boxShadow: `0 0 0 2px ${d.color}30` }} />
            <span style={{ color: 'var(--text-main)' }}>{d.label}</span>
            <span style={{ color: 'var(--text-muted)', fontWeight: '700' }}>({d.value})</span>
          </div>
        ))}
      </div>

      {/* Hover tooltip */}
      {hoveredIndex !== null && (
        <div style={{
          background: 'var(--bg-card, #fff)', border: '1px solid var(--border-color)', borderRadius: '10px',
          padding: '10px 16px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', fontSize: '13px', textAlign: 'center',
          animation: 'fadeIn 0.15s ease-out'
        }}>
          <div style={{ fontWeight: '800', color: data[hoveredIndex].color }}>{data[hoveredIndex].label}</div>
          <div style={{ color: 'var(--text-muted)' }}>
            {data[hoveredIndex].value} visitors · {((data[hoveredIndex].value / total) * 100).toFixed(1)}%
          </div>
        </div>
      )}
    </div>
  );
}

// ================= INTERACTIVE BAR CHART COMPONENT =================
function BarChart({ data, height = 280 }) {
  const [hoveredIndex, setHoveredIndex] = useState(null);
  if (!data.length) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height, color: 'var(--text-muted)', fontSize: '14px' }}>
        No data available
      </div>
    );
  }

  const maxVal = Math.max(...data.map(d => d.value), 1);
  const chartPadLeft = 48, chartPadRight = 16, chartPadTop = 16, chartPadBottom = 56;
  const barAreaW = 600 - chartPadLeft - chartPadRight;
  const barAreaH = height - chartPadTop - chartPadBottom;
  const barW = Math.min(48, (barAreaW / data.length) * 0.6);
  const gap = (barAreaW - barW * data.length) / (data.length + 1);

  // Grid lines
  const gridLines = 5;
  const gridVals = Array.from({ length: gridLines + 1 }, (_, i) => Math.round((maxVal / gridLines) * i));

  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <svg width="100%" viewBox={`0 0 600 ${height}`} style={{ minWidth: '400px' }}>
        <defs>
          {data.map((d, i) => (
            <linearGradient key={i} id={`bar-grad-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={d.color} stopOpacity="1" />
              <stop offset="100%" stopColor={d.color} stopOpacity="0.65" />
            </linearGradient>
          ))}
        </defs>

        {/* Grid lines */}
        {gridVals.map((val, i) => {
          const y = chartPadTop + barAreaH - (val / maxVal) * barAreaH;
          return (
            <g key={i}>
              <line x1={chartPadLeft} y1={y} x2={600 - chartPadRight} y2={y} stroke="var(--border-color)" strokeWidth="1" strokeDasharray={i === 0 ? "0" : "4 3"} />
              <text x={chartPadLeft - 8} y={y + 4} textAnchor="end" fill="var(--text-muted)" fontSize="10" fontWeight="600">{val}</text>
            </g>
          );
        })}

        {/* Bars */}
        {data.map((d, i) => {
          const barH = (d.value / maxVal) * barAreaH;
          const x = chartPadLeft + gap * (i + 1) + barW * i;
          const y = chartPadTop + barAreaH - barH;
          const isHovered = hoveredIndex === i;
          return (
            <g key={i}
              onMouseEnter={() => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex(null)}
              style={{ cursor: 'pointer' }}
            >
              {/* Glow behind bar on hover */}
              {isHovered && (
                <rect x={x - 4} y={y - 4} width={barW + 8} height={barH + 8} rx="8" fill={d.color} opacity="0.12" />
              )}
              <rect
                x={x} y={y} width={barW} height={barH}
                rx="6" ry="6"
                fill={`url(#bar-grad-${i})`}
                stroke={isHovered ? d.color : 'none'}
                strokeWidth="2"
                style={{
                  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                  filter: isHovered ? `drop-shadow(0 4px 8px ${d.color}50)` : 'none',
                  opacity: hoveredIndex !== null && !isHovered ? 0.5 : 1
                }}
              />
              {/* Value label on top */}
              <text
                x={x + barW / 2} y={y - 8}
                textAnchor="middle" fill={isHovered ? d.color : 'var(--text-muted)'}
                fontSize={isHovered ? "13" : "11"} fontWeight="700"
                style={{ transition: 'all 0.2s ease' }}
              >
                {d.value}
              </text>
              {/* X-axis label */}
              <text
                x={x + barW / 2} y={chartPadTop + barAreaH + 20}
                textAnchor="middle" fill={isHovered ? 'var(--text-main)' : 'var(--text-muted)'}
                fontSize="10" fontWeight={isHovered ? "700" : "600"}
                style={{ transition: 'all 0.2s ease' }}
              >
                {d.label.length > 10 ? d.label.slice(0, 9) + '…' : d.label}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Hover tooltip */}
      {hoveredIndex !== null && (
        <div style={{
          display: 'flex', justifyContent: 'center', marginTop: '8px',
          animation: 'fadeIn 0.15s ease-out'
        }}>
          <div style={{
            background: 'var(--bg-card, #fff)', border: '1px solid var(--border-color)', borderRadius: '10px',
            padding: '8px 16px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', fontSize: '13px',
            display: 'flex', alignItems: 'center', gap: '8px'
          }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '3px', background: data[hoveredIndex].color }} />
            <span style={{ fontWeight: '700' }}>{data[hoveredIndex].label}</span>
            <span style={{ color: 'var(--text-muted)' }}>-</span>
            <span style={{ fontWeight: '800', color: data[hoveredIndex].color }}>{data[hoveredIndex].value} visitors</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ================= UPGRADED REPORTS VIEW =================
function Reports() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('charts');

  useEffect(() => {
    api('/reports/visitors')
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  // Compute analytics from data
  const analytics = React.useMemo(() => {
    if (!data.length) return { statusCounts: {}, deptCounts: {}, purposeCounts: {}, totalVisitors: 0, withEntry: 0, withExit: 0, avgDuration: 0 };

    const statusCounts = {};
    const deptCounts = {};
    const purposeCounts = {};
    let withEntry = 0, withExit = 0;
    const durations = [];

    data.forEach(r => {
      const st = r.status || 'UNKNOWN';
      statusCounts[st] = (statusCounts[st] || 0) + 1;

      const dept = r.department || 'Unspecified';
      deptCounts[dept] = (deptCounts[dept] || 0) + 1;

      const purpose = r.purpose || 'Other';
      purposeCounts[purpose] = (purposeCounts[purpose] || 0) + 1;

      if (r.entry_time) withEntry++;
      if (r.exit_time) withExit++;
      if (r.entry_time && r.exit_time) {
        const diff = new Date(r.exit_time) - new Date(r.entry_time);
        if (diff > 0) durations.push(diff / 60000); // minutes
      }
    });

    const avgDuration = durations.length ? (durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
    return { statusCounts, deptCounts, purposeCounts, totalVisitors: data.length, withEntry, withExit, avgDuration };
  }, [data]);

  // Chart color palettes
  const statusColors = {
    INSIDE: '#2563eb',
    APPROVED: '#10b981',
    PENDING: '#f50bb7ff',
    PENDING_APPROVAL: '#f59e0b',
    REJECTED: '#ef4444',
    DECLINED: '#ef4444',
    CLOSED: '#64748b',
    UNKNOWN: '#94a3b8'
  };

  const deptColorPalette = ['#6366f1', '#ec4899', '#14b8a6', '#f97316', '#8b5cf6', '#06b6d4', '#eab308', '#ef4444', '#22c55e', '#3b82f6'];

  const statusPieData = Object.entries(analytics.statusCounts).map(([label, value]) => ({
    label: label.replace('_', ' '),
    value,
    color: statusColors[label] || '#94a3b8'
  }));

  const deptBarData = Object.entries(analytics.deptCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([label, value], i) => ({
      label,
      value,
      color: deptColorPalette[i % deptColorPalette.length]
    }));

  const purposePieData = Object.entries(analytics.purposeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([label, value], i) => ({
      label: label.length > 20 ? label.slice(0, 18) + '…' : label,
      value,
      color: deptColorPalette[(i + 3) % deptColorPalette.length]
    }));

  if (loading) {
    return (
      <div className="panel">
        <div className="panel-body" style={{ textAlign: 'center', padding: '60px' }}>
          <div style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-muted)' }}>
            ⏳ Generating analytics report...
          </div>
        </div>
      </div>
    );
  }

  const kpis = [
    { title: 'Total Visits', value: analytics.totalVisitors, icon: '📊', accent: '#6366f1', bg: '#eef2ff' },
    { title: 'Checked In', value: analytics.withEntry, icon: '🚪', accent: '#10b981', bg: '#ecfdf5' },
    { title: 'Checked Out', value: analytics.withExit, icon: '🏃', accent: '#f59e0b', bg: '#fffbeb' },
    { title: 'Avg Duration', value: analytics.avgDuration > 0 ? `${Math.round(analytics.avgDuration)}m` : 'N/A', icon: '⏱️', accent: '#06b6d4', bg: '#ecfeff' }
  ];

  const tabs = [
    { id: 'charts', label: '📈 Visual Analytics' },
    { id: 'table', label: '📋 Data Table' }
  ];

  return (
    <div>
      {/* ---- Report KPI Summary Cards ---- */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        {kpis.map((k, i) => (
          <div key={i} className="report-kpi-card" style={{
            background: 'var(--bg-card, #fff)', borderRadius: '14px', padding: '20px 22px',
            border: '1px solid var(--border-color)', boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
            display: 'flex', alignItems: 'center', gap: '16px',
            transition: 'all 0.25s ease', position: 'relative', overflow: 'hidden'
          }}>
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, height: '3px',
              background: `linear-gradient(90deg, ${k.accent}, ${k.accent}80)`
            }} />
            <div style={{
              width: '46px', height: '46px', borderRadius: '12px', background: k.bg,
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', flexShrink: 0
            }}>
              {k.icon}
            </div>
            <div>
              <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{k.title}</div>
              <div style={{ fontSize: '26px', fontWeight: '800', color: 'var(--text-main)', letterSpacing: '-1px', lineHeight: 1.1, marginTop: '2px' }}>{k.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ---- Tab Switcher ---- */}
      <div style={{
        display: 'flex', gap: '4px', background: 'var(--bg-card-subtle)', padding: '4px',
        borderRadius: '12px', marginBottom: '20px', width: 'fit-content',
        border: '1px solid var(--border-color)'
      }}>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              padding: '10px 20px', borderRadius: '10px', border: 'none',
              background: activeTab === t.id ? 'var(--bg-card, #fff)' : 'transparent',
              color: activeTab === t.id ? 'var(--text-main)' : 'var(--text-muted)',
              fontWeight: activeTab === t.id ? '700' : '600',
              fontSize: '13px', cursor: 'pointer',
              boxShadow: activeTab === t.id ? '0 2px 8px rgba(0,0,0,0.08)' : 'none',
              transition: 'all 0.2s ease'
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ---- Charts Tab ---- */}
      {activeTab === 'charts' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>
          {/* Status Distribution Pie Chart */}
          <div className="panel">
            <div className="panel-header">
              <h3 className="panel-title" style={{ fontSize: '15px' }}>
                <span style={{ fontSize: '18px' }}>🥧</span> Visitor Status Distribution
              </h3>
            </div>
            <div className="panel-body" style={{ display: 'flex', justifyContent: 'center' }}>
              <PieChart data={statusPieData} size={240} />
            </div>
          </div>

          {/* Purpose Breakdown Pie Chart */}
          <div className="panel">
            <div className="panel-header">
              <h3 className="panel-title" style={{ fontSize: '15px' }}>
                <span style={{ fontSize: '18px' }}>🎯</span> Visit Purpose Breakdown
              </h3>
            </div>
            <div className="panel-body" style={{ display: 'flex', justifyContent: 'center' }}>
              <PieChart data={purposePieData} size={240} />
            </div>
          </div>

          {/* Department Bar Chart - full width */}
          <div className="panel" style={{ gridColumn: '1 / -1' }}>
            <div className="panel-header">
              <h3 className="panel-title" style={{ fontSize: '15px' }}>
                <span style={{ fontSize: '18px' }}>📊</span> Visitors by Department
              </h3>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: '600' }}>
                Top {deptBarData.length} departments
              </span>
            </div>
            <div className="panel-body">
              <BarChart data={deptBarData} height={300} />
            </div>
          </div>
        </div>
      )}

      {/* ---- Data Table Tab ---- */}
      {activeTab === 'table' && (
        <div className="panel">
          <div className="panel-header">
            <h3 className="panel-title">
              <Icons.Reports /> Visitor Audit & Access Reports
            </h3>
            <button className="btn-primary" onClick={() => window.print()}>
              Print / Export Report
            </button>
          </div>
          <div className="panel-body">
            <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '16px', fontWeight: '600' }}>
              Showing {data.length} visitor record{data.length !== 1 ? 's' : ''}
            </div>
            <div className="table-container" style={{ border: 'none', boxShadow: 'none' }}>
              <table className="custom-table">
                <thead>
                  <tr>
                    <th>Pass Code</th>
                    <th>Visitor Name</th>
                    <th>Company</th>
                    <th>Purpose</th>
                    <th>Department</th>
                    <th>Host</th>
                    <th>Entry Time</th>
                    <th>Exit Time</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.length === 0 ? (
                    <tr><td colSpan="9" style={{ textAlign: 'center', padding: '30px' }}>No report data available.</td></tr>
                  ) : (
                    data.map((r, i) => (
                      <tr key={i}>
                        <td style={{ fontFamily: 'var(--font-mono)', fontWeight: '700' }}>{r.visitor_code}</td>
                        <td><b>{r.name}</b></td>
                        <td>{r.company || '-'}</td>
                        <td>{r.purpose}</td>
                        <td>{r.department || '-'}</td>
                        <td>{r.host_name || '-'}</td>
                        <td>{r.entry_time || '-'}</td>
                        <td>{r.exit_time || '-'}</td>
                        <td><StatusBadge status={r.status} /></td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ================= DIGITAL AUDIT TRAIL =================
function Audit() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/audit')
      .then(setLogs)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="panel">
      <div className="panel-header">
        <h3 className="panel-title">
          <Icons.Audit /> Security Audit Logs
        </h3>
      </div>
      <div className="panel-body">
        <div className="table-container" style={{ border: 'none', boxShadow: 'none' }}>
          <table className="custom-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Actor</th>
                <th>Security Action</th>
                <th>Entity</th>
                <th>Record ID</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="6" style={{ textAlign: 'center', padding: '30px' }}>Loading audit records...</td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan="6" style={{ textAlign: 'center', padding: '30px' }}>No security logs found.</td></tr>
              ) : (
                logs.map((l, i) => (
                  <tr key={i}>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>{l.created_at}</td>
                    <td><b>{l.actor_name || 'System'}</b></td>
                    <td>
                      <span className="badge badge-inside">{l.action}</span>
                    </td>
                    <td>{l.entity}</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>#{l.entity_id}</td>
                    <td>{l.details || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ================= MASTER DATA MANAGEMENT VIEW =================
function MasterData() {
  const [tab, setTab] = useState('departments');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({});

  const isDept = tab === 'departments';
  const isHost = tab === 'hosts';
  const entity = isDept ? 'Department' : isHost ? 'Host / Person to Meet' : 'Purpose';

  const resetForm = () => setForm(isHost ? { name: '', department: '', active: true } : isDept ? { name: '', code: '', description: '', active: true } : { name: '', description: '', active: true });

  const load = () => {
    setLoading(true);
    api(`/master/${tab}/all`)
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { resetForm(); load(); setEditId(null); }, [tab]);

  const setField = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const toBody = () => isHost
    ? { name: form.name, department: form.department, active: form.active }
    : isDept
      ? { name: form.name, code: form.code, description: form.description, active: form.active }
      : { name: form.name, description: form.description, active: form.active };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (editId) return saveEdit();
    submitAdd(e);
  };
  const submitAdd = async (e) => {
    if (!form.name) return setMsg('Name is required');
    try {
      await api(`/master/${tab}`, { method: 'POST', body: JSON.stringify(toBody()) });
      setMsg(`${entity} added`);
      resetForm();
      load();
    } catch (err) { setMsg('Error: ' + err.message); }
  };

  const startEdit = (item) => {
    setEditId(item.id);
    setForm(isHost ? { name: item.name, department: item.department || '', active: !!item.active } : isDept ? { name: item.name, code: item.code || '', description: item.description || '', active: !!item.active } : { name: item.name, description: item.description || '', active: !!item.active });
  };

  const saveEdit = async () => {
    if (!form.name) return setMsg('Name is required');
    try {
      await api(`/master/${tab}/${editId}`, { method: 'PUT', body: JSON.stringify(toBody()) });
      setMsg(`${entity} updated`);
      setEditId(null);
      resetForm();
      load();
    } catch (err) { setMsg('Error: ' + err.message); }
  };

  const remove = async (id) => {
    if (!confirm(`Remove this ${entity.toLowerCase()}?`)) return;
    try {
      await api(`/master/${tab}/${id}`, { method: 'DELETE' });
      setMsg(`${entity} removed`);
      load();
    } catch (err) { setMsg('Error: ' + err.message); }
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <h3 className="panel-title">
          <Icons.MasterData /> Master Data Management
        </h3>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px' }}>
          <button className={`nav-item ${tab === 'departments' ? 'active' : ''}`} style={{ height: '32px', padding: '0 12px', fontSize: '13px' }} onClick={() => setTab('departments')}>Departments</button>
          <button className={`nav-item ${tab === 'purposes' ? 'active' : ''}`} style={{ height: '32px', padding: '0 12px', fontSize: '13px' }} onClick={() => setTab('purposes')}>Visit Purposes</button>
          <button className={`nav-item ${tab === 'hosts' ? 'active' : ''}`} style={{ height: '32px', padding: '0 12px', fontSize: '13px' }} onClick={() => setTab('hosts')}>People to Meet (Hosts)</button>
        </div>
      </div>

      <div className="panel-body">
        {msg && <div className={`alert-box ${msg.startsWith('Error') ? 'alert-error' : 'alert-success'}`}><strong>{msg}</strong></div>}

        <div className="panel" style={{ marginBottom: '16px' }}>
          <div className="panel-header">
            <h4 style={{ margin: 0 }}>{editId ? `Edit ${entity}` : `Add New ${entity}`}</h4>
          </div>
          <div className="panel-body">
            <form onSubmit={handleSubmit} className="form-grid">
              <div className="form-group">
                <label className="form-label">{entity} Name <span className="req">*</span></label>
                <input className="form-control" placeholder={isDept ? 'e.g. IT, Operations' : isHost ? 'e.g. Ravi Sharma' : 'e.g. Client Meeting, Audit'} value={form.name || ''} onChange={e => setField('name', e.target.value)} required />
              </div>
              {isDept && (
                <div className="form-group">
                  <label className="form-label">Code (Short)</label>
                  <input className="form-control" placeholder="e.g. IT, OPS" value={form.code || ''} onChange={e => setField('code', e.target.value)} />
                </div>
              )}
              {isHost ? (
                <div className="form-group">
                  <label className="form-label">Department / Designation</label>
                  <input className="form-control" placeholder="e.g. Operations" value={form.department || ''} onChange={e => setField('department', e.target.value)} />
                </div>
              ) : (
                <div className="form-group">
                  <label className="form-label">Description</label>
                  <input className="form-control" placeholder="Optional description" value={form.description || ''} onChange={e => setField('description', e.target.value)} />
                </div>
              )}
              <div className="form-group full-width" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input type="checkbox" checked={form.active !== false} onChange={e => setField('active', e.target.checked)} />
                <label className="checkbox-label" style={{ marginBottom: 0 }}>Active (visible in forms)</label>
              </div>
              <div className="form-group full-width">
                {editId ? (
                  <>
                    <button type="submit" className="btn-primary">Save Changes</button>
                    <button type="button" className="btn-secondary" style={{ marginLeft: '8px' }} onClick={() => { setEditId(null); resetForm(); }}>Cancel</button>
                  </>
                ) : (
                  <button type="submit" className="btn-primary">Add {entity}</button>
                )}
              </div>
            </form>
          </div>
        </div>

        <div className="table-container" style={{ border: 'none', boxShadow: 'none' }}>
          <table className="custom-table">
            <thead>
              <tr>
                <th>Name</th>
                {isDept && <th>Code</th>}
                {isHost && <th>Department</th>}
                {!isHost && <th>Description</th>}
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={isDept ? 5 : 4} style={{ textAlign: 'center', padding: '30px' }}>Loading master data...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={isDept ? 5 : 4} style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>No records found.</td></tr>
              ) : (
                items.map(it => (
                  <tr key={it.id}>
                    <td><b>{it.name}</b></td>
                    {isDept && <td>{it.code || <span style={{ color: 'var(--text-light)' }}>-</span>}</td>}
                    {isHost && <td>{it.department || <span style={{ color: 'var(--text-light)' }}>-</span>}</td>}
                    {!isHost && <td>{it.description || <span style={{ color: 'var(--text-light)' }}>-</span>}</td>}
                    <td>{it.active ? <span style={{ color: 'var(--success)', fontWeight: 700 }}>Active</span> : <span style={{ color: 'var(--danger)', fontWeight: 700 }}>Inactive</span>}</td>
                    <td>
                      <button className="btn-secondary" style={{ padding: '4px 8px', fontSize: '12px', marginRight: '4px' }} onClick={() => startEdit(it)}>Edit</button>
                      <button className="btn-secondary" style={{ padding: '4px 8px', fontSize: '12px', color: 'var(--danger)', borderColor: 'var(--danger-border)' }} onClick={() => remove(it.id)}>Remove</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ================= USER ROLE MANAGEMENT VIEW =================
function UserManagement({ currentUser }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [search, setSearch] = useState('');
  const [editId, setEditId] = useState(null);

  // Form State
  const [form, setForm] = useState({
    username: '',
    password: '',
    name: '',
    role: 'HOST',
    department: '',
    email: '',
    active: true
  });

  const resetForm = () => {
    setForm({
      username: '',
      password: '',
      name: '',
      role: 'HOST',
      department: '',
      email: '',
      active: true
    });
    setEditId(null);
  };

  const loadUsers = () => {
    setLoading(true);
    api('/users')
      .then(setUsers)
      .catch(err => setMsg('Error loading users: ' + err.message))
      .finally(() => setLoading(false));
  };

  useEffect(loadUsers, []);

  const handleFieldChange = (key, val) => {
    setForm(prev => ({ ...prev, [key]: val }));
  };

  const startEdit = (u) => {
    setEditId(u.id);
    setForm({
      username: u.username || '',
      password: '',
      name: u.name || '',
      role: u.role || 'HOST',
      department: u.department || '',
      email: u.email || '',
      active: u.active !== 0
    });
    setMsg('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMsg('');
    if (!form.name || !form.role) {
      setMsg('Error: Full Name and User Role are required.');
      return;
    }

    try {
      if (editId) {
        await api(`/users/${editId}`, {
          method: 'PUT',
          body: JSON.stringify(form)
        });
        setMsg(`User profile "${form.name}" updated successfully!`);
      } else {
        if (!form.username || !form.password) {
          setMsg('Error: Username and Password are required for new user accounts.');
          return;
        }
        await api('/users', {
          method: 'POST',
          body: JSON.stringify(form)
        });
        setMsg(`New user account "${form.name}" created successfully!`);
      }
      resetForm();
      loadUsers();
    } catch (err) {
      setMsg('Error: ' + err.message);
    }
  };

  const toggleDeactivate = async (u) => {
    if (!confirm(`Are you sure you want to ${u.active ? 'deactivate' : 'reactivate'} ${u.name}?`)) return;
    try {
      if (u.active) {
        await api(`/users/${u.id}`, { method: 'DELETE' });
      } else {
        await api(`/users/${u.id}`, {
          method: 'PUT',
          body: JSON.stringify({ active: true })
        });
      }
      setMsg(`User "${u.name}" status updated.`);
      loadUsers();
    } catch (err) {
      setMsg('Error: ' + err.message);
    }
  };

  const filteredUsers = users.filter(u =>
    (u.name && u.name.toLowerCase().includes(search.toLowerCase())) ||
    (u.username && u.username.toLowerCase().includes(search.toLowerCase())) ||
    (u.email && u.email.toLowerCase().includes(search.toLowerCase())) ||
    (u.role && u.role.toLowerCase().includes(search.toLowerCase()))
  );

  const getRoleBadgeClass = (role) => {
    switch (role) {
      case 'SUPER_ADMIN': return 'badge-inside';
      case 'ADMIN': return 'badge-approved';
      case 'EXECUTIVE': return 'badge-pending';
      case 'RECEPTION': return 'badge-inside';
      case 'GUARD': return 'badge-closed';
      default: return 'badge-approved';
    }
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <h3 className="panel-title">
          <Icons.Users /> Role & User Access Control
        </h3>
        <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: '600' }}>
          Logged in as: <strong>{currentUser.role}</strong>
        </span>
      </div>

      <div className="panel-body">
        {msg && (
          <div className={`alert-box ${msg.startsWith('Error') ? 'alert-error' : 'alert-success'}`}>
            <strong>{msg}</strong>
          </div>
        )}

        {/* User Account Form (Create / Edit) */}
        <div className="panel" style={{ marginBottom: '24px', background: 'var(--bg-card-subtle)' }}>
          <div className="panel-header" style={{ padding: '12px 20px' }}>
            <h4 style={{ margin: 0, fontSize: '15px' }}>
              {editId ? `✏️ Edit User Account (#${editId})` : '➕ Add New System User'}
            </h4>
          </div>
          <div className="panel-body">
            <form onSubmit={handleSubmit} className="form-grid">
              <div className="form-group">
                <label className="form-label">Full Name <span className="req">*</span></label>
                <input
                  className="form-control"
                  placeholder="e.g. Sanjiv Kumar"
                  value={form.name}
                  onChange={e => handleFieldChange('name', e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Username / Login ID <span className="req">*</span></label>
                <input
                  className="form-control"
                  placeholder="e.g. sanjiv.reception"
                  value={form.username}
                  onChange={e => handleFieldChange('username', e.target.value)}
                  disabled={!!editId}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">
                  {editId ? 'New Password (leave blank to keep current)' : 'Account Password *'}
                </label>
                <input
                  type="password"
                  className="form-control"
                  placeholder={editId ? '••••••••' : 'Enter password'}
                  value={form.password}
                  onChange={e => handleFieldChange('password', e.target.value)}
                  required={!editId}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Role Assignment <span className="req">*</span></label>
                <select
                  className="form-control"
                  value={form.role}
                  onChange={e => handleFieldChange('role', e.target.value)}
                >
                  {currentUser.role === 'SUPER_ADMIN' && (
                    <option value="SUPER_ADMIN">👑 Super Admin / Developer</option>
                  )}
                  <option value="ADMIN">🛡️ Admin</option>
                  <option value="EXECUTIVE">💼 CEO / Executive View</option>
                  <option value="RECEPTION">🏢 Reception Access (General Check-In/Out)</option>
                  <option value="GUARD">🚪 Security Guard (Gate Check-In/Out)</option>
                  <option value="HOST">👤 Standard Host (Restricted to Own Data)</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Department / Unit</label>
                <input
                  className="form-control"
                  placeholder="e.g. Front Desk, Executive"
                  value={form.department}
                  onChange={e => handleFieldChange('department', e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Work Email Address</label>
                <input
                  type="email"
                  className="form-control"
                  placeholder="e.g. sanjiv@opsvision.com"
                  value={form.email}
                  onChange={e => handleFieldChange('email', e.target.value)}
                />
              </div>

              <div className="form-group full-width" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="checkbox"
                  id="userActiveCheck"
                  checked={form.active}
                  onChange={e => handleFieldChange('active', e.target.checked)}
                />
                <label htmlFor="userActiveCheck" className="checkbox-label" style={{ marginBottom: 0 }}>
                  Active Account (Allowed to sign in)
                </label>
              </div>

              <div className="form-group full-width" style={{ display: 'flex', gap: '10px' }}>
                <button type="submit" className="btn-primary">
                  {editId ? 'Save Account Changes' : 'Create User Account'}
                </button>
                {editId && (
                  <button type="button" className="btn-secondary" onClick={resetForm}>
                    Cancel Edit
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>

        {/* Search Toolbar */}
        <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
          <input
            className="form-control"
            style={{ maxWidth: '360px' }}
            placeholder="Search users by name, email, or role..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: '600' }}>
            Showing {filteredUsers.length} user{filteredUsers.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Users Table */}
        <div className="table-container" style={{ border: 'none', boxShadow: 'none' }}>
          <table className="custom-table">
            <thead>
              <tr>
                <th>User Details</th>
                <th>Username</th>
                <th>Assigned Matrix Role</th>
                <th>Department</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="6" style={{ textAlign: 'center', padding: '30px' }}>Loading system users...</td></tr>
              ) : filteredUsers.length === 0 ? (
                <tr><td colSpan="6" style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>No user accounts found matching criteria.</td></tr>
              ) : (
                filteredUsers.map(u => (
                  <tr key={u.id}>
                    <td>
                      <div style={{ fontWeight: '700' }}>{u.name}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{u.email || 'No email registered'}</div>
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontWeight: '600' }}>{u.username}</td>
                    <td>
                      <span className={`badge ${getRoleBadgeClass(u.role)}`}>
                        {u.role}
                      </span>
                    </td>
                    <td>{u.department || '—'}</td>
                    <td>
                      {u.active !== 0 ? (
                        <span style={{ color: 'var(--success)', fontWeight: 700 }}>Active</span>
                      ) : (
                        <span style={{ color: 'var(--danger)', fontWeight: 700 }}>Inactive</span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          className="btn-secondary"
                          style={{ padding: '4px 10px', fontSize: '12px' }}
                          onClick={() => startEdit(u)}
                        >
                          Edit Profile
                        </button>
                        <button
                          className="btn-secondary"
                          style={{
                            padding: '4px 10px',
                            fontSize: '12px',
                            color: u.active !== 0 ? 'var(--danger)' : 'var(--success)',
                            borderColor: u.active !== 0 ? 'var(--danger-border)' : 'var(--success)'
                          }}
                          onClick={() => toggleDeactivate(u)}
                        >
                          {u.active !== 0 ? 'Deactivate' : 'Reactivate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
