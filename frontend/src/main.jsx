import React, { useEffect, useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const API = '/api';

async function api(path, opt = {}) {
  let token = localStorage.getItem('token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: 'Bearer ' + token } : {}),
    ...(opt.headers || {})
  };

  let r = await fetch(API + path, { ...opt, headers });
  
  // If 401 Unauthorized occurs on an authenticated route, attempt silent token refresh
  if (r.status === 401 && !path.startsWith('/auth/')) {
    const refreshToken = localStorage.getItem('refreshToken');
    if (refreshToken) {
      try {
        const refreshRes = await fetch(API + '/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken })
        });
        if (refreshRes.ok) {
          const refreshData = await refreshRes.json();
          if (refreshData.token) {
            localStorage.setItem('token', refreshData.token);
            if (refreshData.refreshToken) localStorage.setItem('refreshToken', refreshData.refreshToken);
            if (refreshData.user) localStorage.setItem('user', JSON.stringify(refreshData.user));
            
            // Retry original request with new access token
            headers.Authorization = 'Bearer ' + refreshData.token;
            r = await fetch(API + path, { ...opt, headers });
          }
        } else {
          throw new Error('Refresh failed');
        }
      } catch (e) {
        console.warn('[VAMS AUTH] Silent session refresh failed. Clearing credentials.');
        localStorage.clear();
        if (!window.location.search.includes('logout')) {
          window.location.href = '/?logout=true&expired=true';
        }
        throw new Error('Session expired. Please sign in again.');
      }
    }
  }

  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw Error(d.message || 'Request failed');
  }
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
  Help: () => (
    <svg fill="none" viewBox="0 0 24 24" strokeWidth="1.8" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M12 18h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
};

function StatusBadge({ status }) {
  const map = {
    INSIDE: { label: 'Checked In', cls: 'badge-inside' },
    CHECKED_IN: { label: 'Checked In', cls: 'badge-inside' },
    APPROVED: { label: 'Approved', cls: 'badge-approved' },
    PENDING_APPROVAL: { label: 'Pending', cls: 'badge-pending' },
    PENDING_HOST_REVIEW: { label: 'Pending Host Review', cls: 'badge-pending' },
    PENDING: { label: 'Pending', cls: 'badge-pending' },
    REJECTED: { label: 'Rejected', cls: 'badge-rejected' },
    DECLINED: { label: 'Declined', cls: 'badge-rejected' },
    CLOSED: { label: 'Exited', cls: 'badge-closed' },
    CHECKED_OUT: { label: 'Exited', cls: 'badge-closed' }
  };
  const item = map[status] || { label: status || 'Unknown', cls: 'badge-closed' };
  return <span className={`badge ${item.cls}`}>{item.label}</span>;
}

// 4-Part Swagatham Logo Convergence Animation Overlay Component
function LogoAnimationOverlay({ onComplete }) {
  const [disappearing, setDisappearing] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    // Stage 1: Convergence (0ms - 1500ms)
    // Stage 2: Hold merged logo (1500ms - 1900ms)
    // Stage 3: Zoom & vanish (1900ms - 2600ms)
    const timer1 = setTimeout(() => setDisappearing(true), 1900);
    const timer2 = setTimeout(() => setFadeOut(true), 2300);
    // Stage 4: Remove overlay completely from DOM (2600ms)
    const timer3 = setTimeout(() => {
      if (onCompleteRef.current) onCompleteRef.current();
    }, 2600);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
    };
  }, []);

  return (
    <div className={`logo-anim-overlay ${fadeOut ? 'fade-out' : ''}`}>
      <div className={`logo-anim-stage ${disappearing ? 'disappearing' : ''}`}>
        <img src="/logo_parts/part_d_text.png" alt="Swagatham Text Part D" className="logo-part-d" />
        <img src="/logo_parts/part_c_lefthand.png" alt="Left Hand & Leaf Part C" className="logo-part-c" />
        <img src="/logo_parts/part_b_righthand.png" alt="Right Hand & Leaf Part B" className="logo-part-b" />
        <img src="/logo_parts/part_a_flower.png" alt="Lotus Flower Part A" className="logo-part-a" />
      </div>
    </div>
  );
}

// Digital Pass Modal Component
function PassModal({ passData, onClose }) {
  if (!passData) return null;
  const isPreIssue = passData.initiator_type === 'STAFF_CREATED' || passData.is_preissue;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="pass-card" onClick={e => e.stopPropagation()}>
        <div className="pass-header">
          <img src="/logo.png" alt="Swagatham Logo" className="pass-header-logo" />
          <h3>Visitor Pass</h3>
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

            {passData.entry_time ? (
              <div className="pass-detail-item">
                <span>Check-in Time</span>
                <span>{fmtDateTime(passData.entry_time)}</span>
              </div>
            ) : isPreIssue && passData.expected_checkin ? (
              <div className="pass-detail-item">
                <span>Expected Check-in</span>
                <span>{fmtDateTime(passData.expected_checkin)}</span>
              </div>
            ) : null}

            {passData.exit_time ? (
              <div className="pass-detail-item">
                <span>Check-out Time</span>
                <span>{fmtDateTime(passData.exit_time)}</span>
              </div>
            ) : isPreIssue && passData.expected_checkout ? (
              <div className="pass-detail-item">
                <span>Expected Check-out</span>
                <span>{fmtDateTime(passData.expected_checkout)}</span>
              </div>
            ) : null}

            {passData.valid_until && (
              <div className="pass-detail-item">
                <span>Pass Valid Until</span>
                <span>{fmtDateTime(passData.valid_until)}</span>
              </div>
            )}
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

// Public Visitor Reschedule Confirmation Screen
function PublicVisitorRescheduleConfirmScreen({ token, onDone }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [acting, setActing] = useState(false);

  useEffect(() => {
    fetch('/api/public/pass-confirm/' + token)
      .then(r => r.json())
      .then(d => {
        if (d.message && !d.visitor_name) setErr(d.message);
        else setData(d);
      })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  const respond = async (action) => {
    setActing(true);
    setErr('');
    try {
      const r = await fetch('/api/public/pass-confirm/' + token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      const res = await r.json();
      if (!r.ok) throw new Error(res.message || 'Action failed');
      setMsg(res.message);
      const refresh = await fetch('/api/public/pass-confirm/' + token).then(x => x.json());
      setData(refresh);
    } catch (e) {
      setErr(e.message);
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-card" style={{ maxWidth: '520px' }}>
        <div className="login-brand">
          <div className="login-logo-box">
            <img src="/logo.png" alt="Swagatham Logo" className="login-logo-img" />
          </div>
          <h3>Visitor Schedule Confirmation</h3>
          <p>OpsVision Smart Access Pre-Approval Gateway</p>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '30px' }}>Loading schedule details...</div>
        ) : err ? (
          <div className="alert-box alert-error">{err}</div>
        ) : (
          <div>
            {msg && <div className="alert-box alert-success">{msg}</div>}

            <div className="pass-details-list" style={{ background: 'var(--bg-card-subtle)', padding: '16px', borderRadius: '12px', marginBottom: '20px' }}>
              <div className="pass-detail-item">
                <span>Visitor Name</span>
                <strong>{data.visitor_name}</strong>
              </div>
              <div className="pass-detail-item">
                <span>Host / Department</span>
                <span>{data.host_name || 'Host'} ({data.host_department || 'General'})</span>
              </div>
              <div className="pass-detail-item">
                <span>Purpose</span>
                <span>{data.purpose}</span>
              </div>
              <div className="pass-detail-item">
                <span>Current Status</span>
                <StatusBadge status={data.status} />
              </div>
              {data.proposed_arrival_time && (
                <div className="pass-detail-item" style={{ background: '#fffbeb', padding: '10px', borderRadius: '8px', border: '1px solid #fde68a' }}>
                  <span style={{ color: '#b45309', fontWeight: 'bold' }}>Host Proposed New Time</span>
                  <span style={{ color: '#b45309', fontWeight: 'bold' }}>{new Date(data.proposed_arrival_time).toLocaleString()}</span>
                </div>
              )}
            </div>

            {data.status === 'PENDING_VISITOR_CONFIRMATION' && data.proposed_arrival_time && (
              <div style={{ display: 'flex', gap: '12px', marginTop: '15px' }}>
                <button
                  className="btn-primary"
                  style={{ flex: 1, backgroundColor: '#059669' }}
                  disabled={acting}
                  onClick={() => respond('ACCEPT')}
                >
                  {acting ? '...' : '✅ Accept Proposed Time'}
                </button>
                <button
                  className="btn-secondary"
                  style={{ flex: 1, color: 'var(--danger)', borderColor: 'var(--danger-border)' }}
                  disabled={acting}
                  onClick={() => respond('DECLINE')}
                >
                  {acting ? '...' : '❌ Decline'}
                </button>
              </div>
            )}

            <button className="btn-secondary" style={{ width: '100%', marginTop: '16px' }} onClick={onDone}>
              Back to System Login
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Public Visitor Self-Registration Modal
function PublicVisitorSelfRegisterModal({ onClose }) {
  const [hosts, setHosts] = useState([]);
  const [purposes, setPurposes] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [form, setForm] = useState({ name: '', mobile: '', email: '', company: '', purpose: '', host_id: '', department: '', vehicle: '', expected_arrival_time: '' });
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [resData, setResData] = useState(null);

  useEffect(() => {
    fetch('/api/public/hosts').then(r => r.json()).then(setHosts).catch(() => { });
    fetch('/api/public/purposes').then(r => r.json()).then(setPurposes).catch(() => { });
    fetch('/api/public/departments').then(r => r.json()).then(setDepartments).catch(() => { });
  }, []);

  const setField = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!/^\d{10}$/.test(form.mobile || '')) {
      setMsg('Error: Mobile number must be exactly 10 digits');
      return;
    }
    if (!form.expected_arrival_time) {
      setMsg('Error: Expected arrival time is required');
      return;
    }
    setLoading(true);
    setMsg('');
    try {
      const r = await fetch('/api/public/register-visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message || 'Registration failed');
      setResData(d);
      setMsg('Pre-approval registration submitted successfully!');
    } catch (err) {
      setMsg('Error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="pass-card" style={{ maxWidth: '680px' }} onClick={e => e.stopPropagation()}>
        <div className="pass-header" style={{ background: 'linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%)' }}>
          <h3>Public Visitor Pre-Approval Registration</h3>
          <p>Request entry approval prior to site arrival</p>
        </div>
        <div className="pass-body">
          {msg && <div className={`alert-box ${msg.startsWith('Error') ? 'alert-error' : 'alert-success'}`}><strong>{msg}</strong></div>}

          {resData ? (
            <div style={{ textAlign: 'center', padding: '10px 0' }}>
              <div style={{ fontSize: '48px', marginBottom: '10px' }}>🎟️</div>
              <h4>Pre-Approval Request Sent to Host</h4>
              <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
                Your visit request code is: <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--primary)', fontSize: '18px' }}>{resData.visitorCode}</strong>
              </p>
              <div style={{ background: 'var(--bg-card-subtle)', padding: '15px', borderRadius: '10px', marginTop: '15px', textAlign: 'left' }}>
                <div style={{ fontSize: '13px', marginBottom: '6px' }}><strong>Status:</strong> <span className="badge badge-pending">PENDING HOST REVIEW</span></div>
                <div style={{ fontSize: '13px', marginBottom: '6px' }}><strong>Pass Token:</strong> <code>{resData.passToken}</code></div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>An email/notification has been dispatched to your host. You will receive an instant approval notification once reviewed.</div>
              </div>
              <button className="btn-primary" style={{ marginTop: '20px', width: '100%' }} onClick={onClose}>
                Done & Close
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="form-grid">
              <div className="form-group">
                <label className="form-label">Full Name <span className="req">*</span></label>
                <input required className="form-control" placeholder="e.g. Spandana Kumar" value={form.name} onChange={e => setField('name', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Mobile Number (10 digits) <span className="req">*</span></label>
                <input required type="tel" inputMode="numeric" maxLength={10} className="form-control" placeholder="10 digits (e.g. 9876543210)" value={form.mobile} onChange={e => setField('mobile', e.target.value.replace(/\D/g, '').slice(0, 10))} />
              </div>
              <div className="form-group">
                <label className="form-label">Email Address</label>
                <input type="email" className="form-control" placeholder="your.email@company.com" value={form.email} onChange={e => setField('email', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Company / Organization</label>
                <input className="form-control" placeholder="e.g. Spandana Tech" value={form.company} onChange={e => setField('company', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Host / Person to Meet <span className="req">*</span></label>
                <select required className="form-control" value={form.host_id} onChange={e => setField('host_id', e.target.value)}>
                  <option value="">Select Host</option>
                  {hosts.map(h => <option key={h.id} value={h.id}>{h.name} ({h.department || 'Host'})</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Purpose of Visit <span className="req">*</span></label>
                <select required className="form-control" value={form.purpose} onChange={e => setField('purpose', e.target.value)}>
                  <option value="">Select Purpose</option>
                  {purposes.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                  <option value="Client Meeting">Client Meeting</option>
                  <option value="Job Interview">Job Interview</option>
                  <option value="Vendor Meeting">Vendor Meeting</option>
                  <option value="Audit / Inspection">Audit / Inspection</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Department / Area</label>
                <select className="form-control" value={form.department} onChange={e => setField('department', e.target.value)}>
                  <option value="">Select Department</option>
                  {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Expected Arrival Date & Time <span className="req">*</span></label>
                <input required type="datetime-local" className="form-control" value={form.expected_arrival_time} onChange={e => setField('expected_arrival_time', e.target.value)} />
              </div>
              <div className="form-group full-width">
                <label className="form-label">Vehicle Number (Optional)</label>
                <input className="form-control" placeholder="e.g. KA-05-XY-9999" value={form.vehicle} onChange={e => setField('vehicle', e.target.value)} />
              </div>
              <div className="form-group full-width" style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                <button type="submit" className="btn-primary" style={{ flex: 1 }} disabled={loading}>
                  {loading ? 'Submitting...' : 'Submit Pre-Approval Request'}
                </button>
                <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

// Host Account Registration Modal
function HostRegisterModal({ onClose, onRegistered }) {
  const [form, setForm] = useState({ name: '', email: '', password: '', department: 'Operations', phone: '' });
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  const setField = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMsg('');
    try {
      const r = await fetch('/api/auth/register-host', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message || 'Host registration failed');
      localStorage.setItem('token', d.token);
      if (d.refreshToken) localStorage.setItem('refreshToken', d.refreshToken);
      localStorage.setItem('user', JSON.stringify(d.user));
      setMsg('Host account created!');
      setTimeout(() => {
        onRegistered(d.user);
      }, 800);
    } catch (err) {
      setMsg('Error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="pass-card" style={{ maxWidth: '520px' }} onClick={e => e.stopPropagation()}>
        <div className="pass-header" style={{ background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)' }}>
          <h3>Create Host / Employee Account</h3>
          <p>Register as a site host to manage visitor pre-approvals</p>
        </div>
        <div className="pass-body">
          {msg && <div className={`alert-box ${msg.startsWith('Error') ? 'alert-error' : 'alert-success'}`}><strong>{msg}</strong></div>}
          <form onSubmit={handleSubmit} className="form-grid">
            <div className="form-group full-width">
              <label className="form-label">Full Name <span className="req">*</span></label>
              <input required className="form-control" placeholder="e.g. Ramesh Host" value={form.name} onChange={e => setField('name', e.target.value)} />
            </div>
            <div className="form-group full-width">
              <label className="form-label">Company Email <span className="req">*</span></label>
              <input required type="email" className="form-control" placeholder="host.email@opsvision.com" value={form.email} onChange={e => setField('email', e.target.value)} />
            </div>
            <div className="form-group full-width">
              <label className="form-label">Password <span className="req">*</span></label>
              <input required type="password" className="form-control" placeholder="Set secure password" value={form.password} onChange={e => setField('password', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Department</label>
              <input className="form-control" placeholder="e.g. Operations, IT" value={form.department} onChange={e => setField('department', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Mobile Phone</label>
              <input type="tel" className="form-control" placeholder="10 digits" value={form.phone} onChange={e => setField('phone', e.target.value)} />
            </div>
            <div className="form-group full-width" style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
              <button type="submit" className="btn-primary" style={{ flex: 1, backgroundColor: '#059669' }} disabled={loading}>
                {loading ? 'Creating...' : 'Register Host Account'}
              </button>
              <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// Clean Login Screen (No pre-filled credentials, no public buttons)
function Login({ onLogin }) {
  const [u, setU] = useState('');
  const [p, setP] = useState('');
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
      if (d.refreshToken) localStorage.setItem('refreshToken', d.refreshToken);
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

        {err && <div className="alert-box alert-error">{err}</div>}

        <form onSubmit={(e) => { e.preventDefault(); doLogin(u, p); }} autoComplete="off">
          <div className="form-group">
            <label className="form-label">Username / Email</label>
            <input
              className="form-control"
              placeholder="Enter username or email"
              value={u}
              onChange={e => setU(e.target.value)}
              autoComplete="off"
              required
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
              autoComplete="new-password"
              required
            />
          </div>

          <button
            type="submit"
            className="btn-primary"
            style={{ width: '100%' }}
            disabled={loading}
          >
            {loading ? 'Authenticating...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

// App Shell with Left Sidebar & Persistent Session Auth Router
function App() {
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem('user') || 'null'));
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    // Enable browser persistent storage API to prevent mobile OS eviction
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().then(granted => {
        console.log('[VAMS PWA] Persistent storage status:', granted ? 'Granted' : 'Denied');
      }).catch(() => {});
    }

    // App launch silent session validation
    const validateSession = async () => {
      const storedToken = localStorage.getItem('token');
      const storedRefreshToken = localStorage.getItem('refreshToken');

      if (storedToken || storedRefreshToken) {
        try {
          const res = await fetch('/api/auth/me', {
            headers: {
              ...(storedToken ? { Authorization: 'Bearer ' + storedToken } : {}),
              ...(storedRefreshToken ? { 'X-Refresh-Token': storedRefreshToken } : {})
            }
          });

          if (res.ok) {
            const data = await res.json();
            if (data.user) {
              setUser(data.user);
              localStorage.setItem('user', JSON.stringify(data.user));
              if (data.token) localStorage.setItem('token', data.token);
            }
          } else if (storedRefreshToken) {
            // Access token expired, perform silent refresh with refresh token
            const refRes = await fetch('/api/auth/refresh', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ refreshToken: storedRefreshToken })
            });

            if (refRes.ok) {
              const refData = await refRes.json();
              setUser(refData.user);
              localStorage.setItem('user', JSON.stringify(refData.user));
              localStorage.setItem('token', refData.token);
              if (refData.refreshToken) localStorage.setItem('refreshToken', refData.refreshToken);
            } else {
              localStorage.clear();
              setUser(null);
            }
          } else {
            localStorage.clear();
            setUser(null);
          }
        } catch (err) {
          console.warn('[VAMS AUTH] Offline session check fallback:', err.message);
          // Retain local offline session if token exists
        }
      } else {
        setUser(null);
      }
      setInitializing(false);
    };

    validateSession();
  }, []);

  const handleLogout = async () => {
    const refreshToken = localStorage.getItem('refreshToken');
    const token = localStorage.getItem('token');
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: 'Bearer ' + token } : {})
        },
        body: JSON.stringify({ refreshToken })
      });
    } catch (e) {}
    localStorage.clear();
    setUser(null);
  };

  const params = new URLSearchParams(window.location.search);
  const confirmToken = params.get('confirmToken');

  if (confirmToken) {
    return <PublicVisitorRescheduleConfirmScreen token={confirmToken} onDone={() => { window.location.href = '/'; }} />;
  }

  if (initializing) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: '#0f172a',
        color: '#ffffff'
      }}>
        <img src="/logo.png" alt="Swagatham Logo" style={{ width: '130px', height: 'auto', marginBottom: '24px' }} />
        <div style={{
          width: '32px',
          height: '32px',
          border: '3px solid rgba(255,255,255,0.15)',
          borderTopColor: '#6d4ee8',
          borderRadius: '50%',
          animation: 'vams-spin 0.7s linear infinite'
        }} />
        <style>{`@keyframes vams-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!user) return <Login onLogin={setUser} />;
  return (
    <Shell
      user={user}
      setUser={setUser}
      logout={handleLogout}
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
                <input className="form-control" value={form.from} onChange={e => setForm({ ...form, from: e.target.value })} placeholder='"Swagatham VMS" <notifications@yourcompany.com>' />
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
  const [showGlobalLogoAnim, setShowGlobalLogoAnim] = useState(false);
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
            if ('Notification' in window && Notification.permission === 'granted') {
              try {
                new Notification(newest.title || 'Swagatham Notification', {
                  body: newest.message,
                  icon: '/logo.png'
                });
              } catch (e) { }
            }
          }
        }
        lastNotifCountRef.current = unread;
        setUnreadCount(unread);

        // Update WebAPK App Icon Badge (like WhatsApp app icon badge on mobile home screen)
        if (unread > 0) {
          if ('setAppBadge' in navigator) navigator.setAppBadge(unread).catch(() => { });
        } else {
          if ('clearAppBadge' in navigator) navigator.clearAppBadge().catch(() => { });
        }
      })
      .catch(() => { });
  };

  const refreshPending = () => {
    api('/approvals')
      .then(res => {
        if (Array.isArray(res)) {
          const p = res.filter(x => x.status === 'PENDING').length;
          setPendingCount(p);
        }
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
      if ('clearAppBadge' in navigator) navigator.clearAppBadge().catch(() => { });
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

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: Icons.Dashboard, roles: ['SUPER_ADMIN', 'ADMIN', 'CEO', 'RECEPTION', 'GUARD', 'HOST', 'EMPLOYEE'] },
    { id: 'register', label: 'Visitor Registration', icon: Icons.Register, roles: ['SUPER_ADMIN', 'ADMIN', 'CEO', 'RECEPTION', 'GUARD', 'HOST', 'EMPLOYEE'] },
    { id: 'visitors', label: 'Visitor Directory', icon: Icons.Visitors, roles: ['SUPER_ADMIN', 'ADMIN', 'CEO', 'RECEPTION', 'GUARD', 'HOST', 'EMPLOYEE'] },
    { id: 'approvals', label: 'Host Approvals', icon: Icons.Approvals, badge: pendingCount > 0 ? pendingCount : null, roles: ['SUPER_ADMIN', 'ADMIN', 'CEO', 'HOST', 'EMPLOYEE'] },
    { id: 'reports', label: 'Reports & Analytics', icon: Icons.Reports, roles: ['SUPER_ADMIN', 'ADMIN', 'CEO', 'RECEPTION'] },
    { id: 'audit', label: 'Digital Audit Trail', icon: Icons.Audit, roles: ['SUPER_ADMIN', 'ADMIN', 'CEO'] },
    { id: 'masterdata', label: 'Master Data', icon: Icons.MasterData, roles: ['SUPER_ADMIN', 'ADMIN'] },
    { id: 'help', label: 'Help & User Guide', icon: Icons.Help, roles: ['SUPER_ADMIN', 'ADMIN', 'CEO', 'RECEPTION', 'GUARD', 'HOST', 'EMPLOYEE'] }
  ].filter(item => !item.roles || item.roles.includes(user.role));

  const currentNav = navItems.find(x => x.id === tab) || { label: 'Dashboard' };

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
          <img src="/logo.png" alt="Swagatham - Visitor Management System" className="sidebar-logo-img" />
          <button className="mobile-close-btn" onClick={() => setMobileMenuOpen(false)} title="Close Menu">
            <Icons.Close />
          </button>
        </div>

        <div className="sidebar-nav-container">
          <div className="nav-section-title">Navigation</div>
          {navItems.map(item => {
            const Icon = item.icon;
            const isActive = tab === item.id;
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
                            if (n.type === 'VISITOR_REGISTERED') setTab('approvals');
                            else if (n.type === 'VISITOR_ENTRY') setTab('visitors');
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

            {/* SMTP Settings Button - Admin / Super Admin Only */}
            {(user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') && (
              <button className="btn-secondary" onClick={() => setShowSmtpModal(true)} title="Email SMTP Settings" style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '8px 12px' }}>
                <Icons.Mail /> SMTP
              </button>
            )}

            <div className="clock-badge">{currentTime}</div>
            <button className="btn-secondary" onClick={() => setShowGlobalLogoAnim(true)} title="Play Swagatham 4-Part Logo Animation" style={{ marginLeft: '4px', fontSize: '12px' }}>
              ✨ Logo Anim
            </button>
            <button className="btn-secondary theme-toggle-btn" onClick={toggleTheme} style={{ marginLeft: '4px' }} title="Toggle Theme">
              {theme === 'light' ? '🌙 Dark' : '☀️ Light'}
            </button>
          </div>
        </header>

        <div className="content-body">
          {tab === 'dashboard' && <Dashboard user={user} setTab={setTab} viewPass={viewPass} />}
          {tab === 'register' && <Register user={user} setTab={setTab} viewPass={viewPass} />}
          {tab === 'visitors' && <Visitors user={user} viewPass={viewPass} />}
          {tab === 'approvals' && <Approvals user={user} refreshPending={refreshPending} />}
          {tab === 'reports' && <Reports />}
          {tab === 'audit' && <Audit />}
          {tab === 'masterdata' && <MasterData />}
          {tab === 'help' && <HelpGuide user={user} setTab={setTab} />}
        </div>
      </div>

      {showGlobalLogoAnim && <LogoAnimationOverlay onComplete={() => setShowGlobalLogoAnim(false)} />}
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

  const role = user.role;

  // Role-based Quick Actions Configuration
  const allQuickActions = [
    {
      id: 'register',
      label: (role === 'HOST' || role === 'EMPLOYEE') ? '+ Pre-Issue Guest Pass' : '+ Register Visitor',
      icon: Icons.Register,
      tab: 'register',
      roles: ['SUPER_ADMIN', 'ADMIN', 'RECEPTION', 'GUARD', 'HOST', 'EMPLOYEE', 'CEO'],
      color: '#2563eb'
    },
    {
      id: 'approvals',
      label: 'Host Approvals',
      icon: Icons.Approvals,
      tab: 'approvals',
      roles: ['SUPER_ADMIN', 'ADMIN', 'CEO', 'HOST', 'EMPLOYEE'],
      badge: stats.pendingApprovals > 0 ? stats.pendingApprovals : null,
      color: '#f59e0b'
    },
    {
      id: 'visitors',
      label: 'Visitor Directory',
      icon: Icons.Visitors,
      tab: 'visitors',
      roles: ['SUPER_ADMIN', 'ADMIN', 'CEO', 'RECEPTION', 'GUARD', 'HOST', 'EMPLOYEE'],
      color: '#10b981'
    },
    {
      id: 'reports',
      label: 'Reports & Analytics',
      icon: Icons.Reports,
      tab: 'reports',
      roles: ['SUPER_ADMIN', 'ADMIN', 'CEO', 'RECEPTION'],
      color: '#8b5cf6'
    },
    {
      id: 'audit',
      label: 'Audit Trail',
      icon: Icons.Audit,
      tab: 'audit',
      roles: ['SUPER_ADMIN', 'ADMIN', 'CEO'],
      color: '#06b6d4'
    },
    {
      id: 'masterdata',
      label: 'Master Data',
      icon: Icons.MasterData,
      tab: 'masterdata',
      roles: ['SUPER_ADMIN', 'ADMIN'],
      color: '#6366f1'
    },
    {
      id: 'help',
      label: 'User Guide',
      icon: Icons.Help,
      tab: 'help',
      roles: ['SUPER_ADMIN', 'ADMIN', 'CEO', 'RECEPTION', 'GUARD', 'HOST', 'EMPLOYEE'],
      color: '#059669'
    }
  ];

  const quickActions = allQuickActions.filter(act => act.roles.includes(role));

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top Scoped Quick Actions Bar (Role-Based Access Control) */}
      <div className="panel" style={{ marginBottom: '4px' }}>
        <div className="panel-header" style={{ padding: '14px 20px', background: 'var(--bg-card-subtle)' }}>
          <h3 className="panel-title" style={{ fontSize: '15px' }}>
            <span style={{ fontSize: '18px' }}>⚡</span> Role Quick Shortcuts ({role})
          </h3>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: '600' }}>
            Single-tap role action items
          </span>
        </div>
        <div className="panel-body" style={{ padding: '16px 20px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
            {quickActions.map(act => {
              const Icon = act.icon;
              return (
                <button
                  key={act.id}
                  className="quick-action-btn"
                  onClick={() => setTab(act.tab)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '12px 16px',
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '12px',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    textAlign: 'left',
                    position: 'relative'
                  }}
                >
                  <div style={{
                    width: '36px', height: '36px', borderRadius: '10px',
                    background: act.color + '15', color: act.color,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0
                  }}>
                    <Icon />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: '700', fontSize: '13px', color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {act.label}
                    </div>
                  </div>
                  {act.badge ? (
                    <span style={{
                      background: '#ef4444', color: '#fff', fontSize: '11px', fontWeight: '800',
                      padding: '2px 7px', borderRadius: '10px'
                    }}>
                      {act.badge}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Top Stat Cards (Hidden for Guard and Reception) */}
      {!(role === 'GUARD' || role === 'RECEPTION') && (
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
      )}

      {/* Main 2-Column Split */}
      <div className="dashboard-columns">
        {/* Left column: Recent Visitors & Fast Search */}
        <div className="panel">
          <div className="panel-header">
            <h3 className="panel-title">
              <Icons.Visitors /> Recent Visitor Movements
            </h3>
            <button className="btn-secondary" onClick={() => setTab('visitors')}>
              View All Directory
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

        {/* Right column: Workflow Guide */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
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
  const streamRef = useRef(null);

  useEffect(() => {
    let active = true;
    navigator.mediaDevices.getUserMedia({ video: true })
      .then(s => {
        if (!active) {
          s.getTracks().forEach(t => t.stop());
          return;
        }
        streamRef.current = s;
        if (videoRef.current) videoRef.current.srcObject = s;
      })
      .catch(err => console.error('Error accessing webcam:', err));

    return () => {
      active = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  const stopTracks = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  };

  const capture = () => {
    if (videoRef.current && canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      canvasRef.current.width = videoRef.current.videoWidth;
      canvasRef.current.height = videoRef.current.videoHeight;
      ctx.drawImage(videoRef.current, 0, 0, canvasRef.current.width, canvasRef.current.height);
      const dataUrl = canvasRef.current.toDataURL('image/jpeg');
      stopTracks();
      onCapture(dataUrl);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', marginTop: '10px' }}>
      <video ref={videoRef} autoPlay playsInline style={{ width: '100%', maxWidth: '300px', borderRadius: '8px' }} />
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      <div style={{ display: 'flex', gap: '10px' }}>
        <button type="button" className="btn-primary" onClick={capture}>📸 Snap Photo</button>
        {!mandatory && (
          <button type="button" className="btn-secondary" onClick={() => { stopTracks(); onCancel(); }}>
            Close Camera
          </button>
        )}
      </div>
    </div>
  );
}

// ================= REGISTRATION VIEW =================
function Register({ user, setTab, viewPass }) {
  const [hosts, setHosts] = useState([]);
  const isHostUser = (user && (user.role === 'HOST' || user.role === 'EMPLOYEE' || user.role === 'CEO'));
  const [regType, setRegType] = useState(isHostUser ? 'GUEST' : 'NORMAL'); // 'NORMAL' or 'GUEST'
  const [form, setForm] = useState(() => ({
    consent: true,
    host_id: isHostUser ? user.id : ''
  }));
  const [out, setOut] = useState(null);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [purposes, setPurposes] = useState([]);
  const [purposeOther, setPurposeOther] = useState(false);
  const [departmentOther, setDepartmentOther] = useState(false);
  const [showLogoAnim, setShowLogoAnim] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    api('/hosts').then(setHosts).catch(() => { });
    api('/master/departments').then(setDepartments).catch(() => { });
    api('/master/purposes').then(setPurposes).catch(() => { });
  }, []);

  const setField = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const autoPopulateDepartment = (hostDept, availableDepts = departments) => {
    if (!hostDept) return '';
    const deptStr = String(hostDept).trim();
    if (!deptStr) return '';
    const match = availableDepts.find(d => 
      d.name.toLowerCase() === deptStr.toLowerCase() ||
      (d.code && d.code.toLowerCase() === deptStr.toLowerCase())
    );
    return match ? match.name : deptStr;
  };

  // Auto-populate Department based on Host Department
  const handleHostChange = (selectedHostId) => {
    setField('host_id', selectedHostId);
    if (selectedHostId) {
      const selectedHost = hosts.find(h => String(h.id) === String(selectedHostId));
      if (selectedHost && selectedHost.department) {
        const resolvedDept = autoPopulateDepartment(selectedHost.department, departments);
        setField('department', resolvedDept);
        setDepartmentOther(false);
      }
    }
  };

  useEffect(() => {
    if (form.host_id && hosts.length > 0 && departments.length > 0) {
      const selectedHost = hosts.find(h => String(h.id) === String(form.host_id));
      if (selectedHost && selectedHost.department && !form.department) {
        const resolvedDept = autoPopulateDepartment(selectedHost.department, departments);
        setField('department', resolvedDept);
        setDepartmentOther(false);
      }
    }
  }, [hosts, departments, form.host_id]);

  const handleGalleryUpload = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setMsg('Error: Please select a valid image file');
      return;
    }
    const reader = new FileReader();
    reader.onload = (evt) => {
      setPhotoPreview(evt.target.result);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    if (!/^\d{10}$/.test(form.mobile || '')) {
      setMsg('Error: Mobile number must be exactly 10 digits');
      return;
    }
    if (regType === 'GUEST' && form.expected_checkin && form.expected_checkout && new Date(form.expected_checkout) <= new Date(form.expected_checkin)) {
      setMsg('Error: Check-out time must be later than check-in time');
      return;
    }
    setLoading(true);
    setMsg('');
    try {
      const nowIso = new Date().toISOString();
      const payload = {
        ...form,
        expected_checkin: regType === 'GUEST' ? (form.expected_checkin || nowIso) : nowIso,
        expected_checkout: regType === 'GUEST' ? (form.expected_checkout || null) : null,
        photo: photoPreview || form.photo || null
      };
      const d = await api('/visitors/register', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      setOut(d);
      setShowCamera(false);
      setShowLogoAnim(true);
      setMsg(`Visitor registered successfully as ${regType === 'GUEST' ? 'Guest Pass' : 'Normal Visitor'}! Status: Awaiting Host Approval.`);
    } catch (err) {
      setMsg('Error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="panel" style={{ maxWidth: '840px', margin: '0 auto' }}>
      {showLogoAnim && (
        <LogoAnimationOverlay
          onComplete={() => {
            setShowLogoAnim(false);
            setTab('visitors');
          }}
        />
      )}
      <div className="panel-header">
        <h3 className="panel-title">
          <Icons.Register /> {regType === 'GUEST' ? 'Register Guest (Pre-Issue Pass)' : 'Register New Visitor'}
        </h3>
      </div>
      <div className="panel-body">
        {/* Registration Type Selector */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', background: 'var(--bg-card-subtle)', padding: '6px', borderRadius: '10px' }}>
          <button
            type="button"
            className={`nav-item ${regType === 'NORMAL' ? 'active' : ''}`}
            style={{ flex: 1, padding: '8px 12px', borderRadius: '8px', fontSize: '13.5px', fontWeight: '600', justifyContent: 'center' }}
            onClick={() => {
              setRegType('NORMAL');
              setField('expected_checkin', '');
              setField('expected_checkout', '');
            }}
          >
            🏢 Normal Visitor Registration (Walk-in)
          </button>
          <button
            type="button"
            className={`nav-item ${regType === 'GUEST' ? 'active' : ''}`}
            style={{ flex: 1, padding: '8px 12px', borderRadius: '8px', fontSize: '13.5px', fontWeight: '600', justifyContent: 'center' }}
            onClick={() => setRegType('GUEST')}
          >
            🎟️ Guest Registration (Pre-Scheduled Visit)
          </button>
        </div>

        {msg && (
          <div className={`alert-box ${msg.startsWith('Error') ? 'alert-error' : 'alert-success'}`}>
            <div>
              <strong>{msg}</strong>
              {out && (
                <div style={{ marginTop: '8px', fontSize: '13px' }}>
                  <div><b>Visitor Code:</b> <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 'bold' }}>{out.visitorCode}</span></div>
                  <div><b>Status:</b> <span className="badge badge-pending">AWAITING HOST APPROVAL</span></div>
                </div>
              )}
            </div>
            {out && (
              <div style={{ marginTop: '12px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => viewPass(out.visitId)}
                >
                  View Digital Pass
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowLogoAnim(true)}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <span>✨ Replay Animation</span>
                </button>
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
              onChange={e => handleHostChange(e.target.value)}
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
              {form.department && !departments.some(d => d.name === form.department || d.code === form.department) && (
                <option value={form.department}>{form.department}</option>
              )}
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

          {/* Expected Check-in and Check-out Date fields: Available ONLY for Guest Registration */}
          {regType === 'GUEST' && (
            <>
              <div className="form-group">
                <label className="form-label">Expected Check-in Time <span style={{ color: 'var(--text-muted)', fontSize: '11px', fontWeight: 'normal' }}>(Optional)</span></label>
                <input
                  type="datetime-local"
                  className="form-control"
                  value={form.expected_checkin || ''}
                  onChange={e => setField('expected_checkin', e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Expected Check-out Time <span style={{ color: 'var(--text-muted)', fontSize: '11px', fontWeight: 'normal' }}>(Optional)</span></label>
                <input
                  type="datetime-local"
                  className="form-control"
                  value={form.expected_checkout || ''}
                  onChange={e => setField('expected_checkout', e.target.value)}
                />
              </div>
            </>
          )}

          <div className="form-group full-width">
            <label className="form-label">Visitor Photo (Optional)</label>
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleGalleryUpload}
            />
            {photoPreview ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                <img src={photoPreview} alt="Visitor Preview" style={{ width: '80px', height: '80px', borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--primary)' }} />
                <button type="button" className="btn-secondary" onClick={() => setPhotoPreview(null)}>Remove / Retake Photo</button>
              </div>
            ) : showCamera ? (
              <div style={{ padding: '15px', border: '1px solid var(--border-color)', borderRadius: '8px', backgroundColor: 'var(--bg-card-subtle)' }}>
                <h4 style={{ margin: '0 0 10px 0', textAlign: 'center' }}>Capture Visitor Photo</h4>
                <WebcamCapture
                  mandatory={false}
                  onCapture={(dataUrl) => {
                    setPhotoPreview(dataUrl);
                    setShowCamera(false);
                  }}
                  onCancel={() => setShowCamera(false)}
                />
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <button type="button" className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '6px' }} onClick={() => setShowCamera(true)}>
                  📷 Snap Photo (Webcam)
                </button>
                <button type="button" className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '6px' }} onClick={() => fileInputRef.current?.click()}>
                  🖼️ Upload from Gallery
                </button>
              </div>
            )}
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
              {loading ? 'Submitting Registration...' : `Submit ${regType === 'GUEST' ? 'Guest Registration' : 'Visitor Registration'}`}
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

  const load = async () => {
    setLoading(true);
    let url = `/visitors?name=${encodeURIComponent(q)}`;
    if (statusFilter) url += `&status=${encodeURIComponent(statusFilter)}`;
    try {
      const d = await api(url);
      setData(d || []);
    } catch (e) {
      setErr('Error loading visitors: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [statusFilter]);

  useEffect(() => {
    api('/hosts').then(setHosts).catch(() => { });
    api('/master/purposes').then(setPurposes).catch(() => { });
  }, []);

  const canGate = user && ['GUARD', 'RECEPTION', 'ADMIN', 'SUPER_ADMIN'].includes(user.role);
  const canEdit = user && ['GUARD', 'RECEPTION', 'ADMIN', 'SUPER_ADMIN'].includes(user.role);
  const canDelete = user && ['RECEPTION', 'ADMIN', 'SUPER_ADMIN'].includes(user.role);

  const doCheckIn = async (r) => {
    const id = r.visit_id || r.id;
    if (!id) return;
    setBusyId(id); setErr('');
    try {
      await api(`/visits/${id}/entry`, { method: 'POST' });
      await load();
    } catch (e) { setErr('Error: ' + e.message); }
    finally { setBusyId(null); }
  };

  const doCheckOut = async (r) => {
    const id = r.visit_id || r.id;
    if (!id) return;
    setBusyId(id); setErr('');
    try {
      await api(`/visits/${id}/exit`, { method: 'POST' });
      await load();
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
    if (editForm.expected_checkin && editForm.expected_checkout && new Date(editForm.expected_checkout) <= new Date(editForm.expected_checkin)) { setEditMsg('Check-out time must be later than check-in time'); return; }
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
          {['', 'CHECKED_IN', 'APPROVED', 'PENDING_APPROVAL', 'CLOSED'].map(s => (
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
                      {canGate && (r.status === 'INSIDE' || r.status === 'CHECKED_IN') && (
                        <button
                          className="btn-secondary"
                          style={{ padding: '6px 10px', fontSize: '12px', color: 'var(--danger)', borderColor: 'var(--danger-border)' }}
                          disabled={busyId === r.visit_id}
                          onClick={() => doCheckOut(r)}
                        >
                          {busyId === r.visit_id ? '...' : 'Check Out'}
                        </button>
                      )}
                      {canEdit && (
                        <button
                          className="btn-secondary"
                          style={{ padding: '6px 10px', fontSize: '12px' }}
                          disabled={busyId === r.visit_id}
                          onClick={() => openEdit(r)}
                        >
                          Edit
                        </button>
                      )}
                      {canDelete && (
                        <button
                          className="btn-secondary"
                          style={{ padding: '6px 10px', fontSize: '12px', color: 'var(--danger)', borderColor: 'var(--danger-border)' }}
                          disabled={busyId === r.visit_id}
                          onClick={() => doDelete(r)}
                        >
                          Delete
                        </button>
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
                  <label className="form-label">Expected Check-in <span style={{ color: 'var(--text-muted)', fontSize: '11px', fontWeight: 'normal' }}>(Optional)</span></label>
                  <input type="datetime-local" className="form-control" value={editForm.expected_checkin || ''} onChange={e => setEdit('expected_checkin', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Expected Check-out <span style={{ color: 'var(--text-muted)', fontSize: '11px', fontWeight: 'normal' }}>(Optional)</span></label>
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

// ================= HOST APPROVALS VIEW =================
function Approvals({ user, refreshPending }) {
  const [approvals, setApprovals] = useState([]);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);

  // Modals for Propose Time and Reject Reason
  const [proposeTarget, setProposeTarget] = useState(null);
  const [proposedTime, setProposedTime] = useState('');
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectionReason, setRejectionReason] = useState('');

  const load = () => {
    setLoading(true);
    api('/approvals')
      .then(setApprovals)
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleHostAction = async (visitId, action, extra = {}) => {
    setLoading(true);
    setMsg('');
    try {
      const res = await api(`/visits/${visitId}/host-action`, {
        method: 'POST',
        body: JSON.stringify({ action, ...extra })
      });
      setMsg(res.message);
      setProposeTarget(null);
      setRejectTarget(null);
      setProposedTime('');
      setRejectionReason('');
      load();
      if (refreshPending) refreshPending();
    } catch (e) {
      setMsg('Error: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <h3 className="panel-title">
          <Icons.Approvals /> Host Access Approvals & Pre-Approvals
        </h3>
        <button className="btn-secondary" onClick={load}>Refresh</button>
      </div>
      <div className="panel-body">
        {msg && <div className={`alert-box ${msg.startsWith('Error') ? 'alert-error' : 'alert-success'}`}><strong>{msg}</strong></div>}

        <div className="table-container" style={{ border: 'none', boxShadow: 'none' }}>
          <table className="custom-table">
            <thead>
              <tr>
                <th>Visitor</th>
                <th>Company</th>
                <th>Purpose</th>
                <th>Host</th>
                <th>Expected Arrival</th>
                <th>Source</th>
                <th>Status</th>
                <th>Decision Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="8" style={{ textAlign: 'center', padding: '30px' }}>Loading approvals...</td></tr>
              ) : approvals.length === 0 ? (
                <tr><td colSpan="8" style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>No pending approval requests.</td></tr>
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
                    <td>{a.expected_arrival_time ? fmtDateTime(a.expected_arrival_time) : '-'}</td>
                    <td>
                      <span className="badge badge-inside" style={{ fontSize: '11px' }}>
                        {a.initiator_type === 'STAFF_CREATED' ? 'Staff Pre-Pass' : 'Self-Registered'}
                      </span>
                    </td>
                    <td><StatusBadge status={a.visit_status || a.status} /></td>
                    <td>
                      {['PENDING', 'PENDING_HOST_REVIEW'].includes(a.visit_status || a.status) ? (
                        (user && (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN' || a.host_id === user.id)) ? (
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            <button className="btn-primary" style={{ padding: '6px 10px', fontSize: '12px', backgroundColor: '#059669' }} onClick={() => handleHostAction(a.visit_id, 'APPROVE')}>
                              Single-Tap Approve
                            </button>
                            <button className="btn-secondary" style={{ padding: '6px 10px', fontSize: '12px' }} onClick={() => setProposeTarget(a)}>
                              📅 Propose Time
                            </button>
                            <button className="btn-secondary" style={{ padding: '6px 10px', fontSize: '12px', color: 'var(--danger)', borderColor: 'var(--danger-border)' }} onClick={() => setRejectTarget(a)}>
                              ❌ Reject
                            </button>
                          </div>
                        ) : (
                          <span className="badge badge-pending" style={{ fontSize: '11px' }}>
                            Awaiting Host Review ({a.host_name || 'Host'})
                          </span>
                        )
                      ) : (
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: '600' }}>
                          {a.rejection_reason ? `Rejected: ${a.rejection_reason}` : 'Completed'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Propose Counter Time Modal */}
      {proposeTarget && (
        <div className="modal-overlay" onClick={() => setProposeTarget(null)}>
          <div className="pass-card" style={{ maxWidth: '500px' }} onClick={e => e.stopPropagation()}>
            <div className="pass-header">
              <h3>Propose Rescheduled Arrival Time</h3>
              <p>For visitor: {proposeTarget.visitor_name}</p>
            </div>
            <div className="pass-body">
              <div className="form-group">
                <label className="form-label">Select New Arrival Date & Time <span className="req">*</span></label>
                <input
                  type="datetime-local"
                  className="form-control"
                  value={proposedTime}
                  onChange={e => setProposedTime(e.target.value)}
                  required
                />
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                <button
                  className="btn-primary"
                  style={{ flex: 1 }}
                  disabled={!proposedTime}
                  onClick={() => handleHostAction(proposeTarget.visit_id, 'PROPOSE_TIME', { proposed_time: proposedTime })}
                >
                  Send Counter Proposal
                </button>
                <button className="btn-secondary" onClick={() => setProposeTarget(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reject Modal with Mandatory Reason */}
      {rejectTarget && (
        <div className="modal-overlay" onClick={() => setRejectTarget(null)}>
          <div className="pass-card" style={{ maxWidth: '500px' }} onClick={e => e.stopPropagation()}>
            <div className="pass-header" style={{ background: 'linear-gradient(135deg, #dc2626 0%, #ef4444 100%)' }}>
              <h3>Reject Visit Request</h3>
              <p>Mandatory rejection reason required</p>
            </div>
            <div className="pass-body">
              <div className="form-group">
                <label className="form-label">Rejection Reason <span className="req">*</span></label>
                <textarea
                  className="form-control"
                  rows="3"
                  placeholder="e.g. Host unavailable, meeting rescheduled, policy restriction..."
                  value={rejectionReason}
                  onChange={e => setRejectionReason(e.target.value)}
                  required
                />
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                <button
                  className="btn-primary"
                  style={{ flex: 1, backgroundColor: '#dc2626' }}
                  disabled={!rejectionReason.trim()}
                  onClick={() => handleHostAction(rejectTarget.visit_id, 'REJECT', { notes: rejectionReason.trim() })}
                >
                  Confirm Rejection
                </button>
                <button className="btn-secondary" onClick={() => setRejectTarget(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
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
  const [createdInfo, setCreatedInfo] = useState(null);
  const [editId, setEditId] = useState(null);
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [form, setForm] = useState({});

  const [departmentsList, setDepartmentsList] = useState([]);

  useEffect(() => {
    api('/master/departments').then(setDepartmentsList).catch(() => []);
  }, []);
  const isDept = tab === 'departments';
  const isHost = tab === 'hosts';
  const entity = isDept ? 'Department' : isHost ? 'System User / Host' : 'Purpose';

  const resetForm = () => setForm(isHost
    ? { name: '', role: 'HOST', email: '', username: '', password: '', department: '', phone: '', active: true }
    : isDept
      ? { name: '', code: '', description: '', active: true }
      : { name: '', description: '', active: true }
  );

  const load = () => {
    setLoading(true);
    const endpoint = isHost ? '/master/users/all' : `/master/${tab}/all`;
    api(endpoint)
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { resetForm(); load(); setEditId(null); setMsg(''); setCreatedInfo(null); }, [tab]);

  const setField = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const toBody = () => isHost
    ? { name: form.name, role: form.role || 'HOST', email: form.email, username: form.username, password: form.password, department: form.department, phone: form.phone, active: form.active }
    : isDept
      ? { name: form.name, code: form.code, description: form.description, active: form.active }
      : { name: form.name, description: form.description, active: form.active };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (editId) return saveEdit();
    submitAdd(e);
  };

  const copyCredentials = (username, password, name, role, email) => {
    const text = `Welcome to Swagatham VAMS!\nHere are your account login details:\n\nName: ${name}\nRole: ${role}\nUsername: ${username}\nEmail: ${email || '-'}\nPassword: ${password || '(As configured)'}\nPortal URL: ${window.location.origin}`;
    navigator.clipboard.writeText(text).then(() => {
      alert('📋 Login details copied to clipboard!\n\n' + text);
    }).catch(() => {
      alert('Login details:\n\n' + text);
    });
  };

  const submitAdd = async (e) => {
    if (!form.name || !form.name.trim()) return setMsg('Error: Name is required');
    setMsg('');
    setCreatedInfo(null);
    try {
      const endpoint = isHost ? '/master/users' : `/master/${tab}`;
      const res = await api(endpoint, { method: 'POST', body: JSON.stringify(toBody()) });
      setMsg(`${entity} added successfully`);
      if (isHost && res.username) {
        setCreatedInfo({
          name: form.name,
          role: form.role || 'HOST',
          username: res.username,
          password: res.initialPassword || form.password,
          email: form.email
        });
      }
      resetForm();
      load();
    } catch (err) { setMsg('Error: ' + err.message); }
  };

  const startEdit = (item) => {
    setEditId(item.id);
    setCreatedInfo(null);
    setForm(isHost
      ? { name: item.name, role: item.role || 'HOST', email: item.email || '', username: item.username || '', password: '', department: item.department || '', phone: item.phone || '', active: !!item.active }
      : isDept
        ? { name: item.name, code: item.code || '', description: item.description || '', active: !!item.active }
        : { name: item.name, description: item.description || '', active: !!item.active }
    );
  };

  const saveEdit = async () => {
    if (!form.name || !form.name.trim()) return setMsg('Error: Name is required');
    try {
      const endpoint = isHost ? `/master/users/${editId}` : `/master/${tab}/${editId}`;
      await api(endpoint, { method: 'PUT', body: JSON.stringify(toBody()) });
      setMsg(`${entity} updated successfully`);
      setEditId(null);
      resetForm();
      load();
    } catch (err) { setMsg('Error: ' + err.message); }
  };

  const remove = async (item) => {
    const isInactive = !item.active;
    const confirmMsg = isInactive
      ? `Are you sure you want to permanently delete this ${entity.toLowerCase()} ("${item.name}")?`
      : `Are you sure you want to deactivate this ${entity.toLowerCase()} ("${item.name}")?`;
    if (!confirm(confirmMsg)) return;
    try {
      const endpoint = isHost ? `/master/users/${item.id}` : `/master/${tab}/${item.id}`;
      const res = await api(endpoint, { method: 'DELETE' });
      setMsg(res.message || `${entity} ${isInactive ? 'deleted' : 'deactivated'}`);
      load();
    } catch (err) { setMsg('Error: ' + err.message); }
  };

  const filteredItems = isHost && roleFilter !== 'ALL'
    ? items.filter(it => it.role === roleFilter)
    : items;

  return (
    <div className="panel">
      <div className="panel-header">
        <h3 className="panel-title">
          <Icons.MasterData /> Master Data & User Management
        </h3>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px' }}>
          <button className={`nav-item ${tab === 'departments' ? 'active' : ''}`} style={{ height: '32px', padding: '0 12px', fontSize: '13px' }} onClick={() => setTab('departments')}>Departments</button>
          <button className={`nav-item ${tab === 'purposes' ? 'active' : ''}`} style={{ height: '32px', padding: '0 12px', fontSize: '13px' }} onClick={() => setTab('purposes')}>Visit Purposes</button>
          <button className={`nav-item ${tab === 'hosts' ? 'active' : ''}`} style={{ height: '32px', padding: '0 12px', fontSize: '13px' }} onClick={() => setTab('hosts')}>System Users & Hosts (All Roles)</button>
        </div>
      </div>

      <div className="panel-body">
        {msg && <div className={`alert-box ${msg.startsWith('Error') ? 'alert-error' : 'alert-success'}`}><strong>{msg}</strong></div>}

        {createdInfo && (
          <div style={{ background: 'var(--bg-card)', border: '2px solid #22c55e', borderRadius: '12px', padding: '16px 20px', marginBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <h4 style={{ margin: '0 0 6px 0', color: '#16a34a', fontSize: '15px' }}>
                  🎉 Account Created for {createdInfo.name} ({createdInfo.role})
                </h4>
                <div style={{ fontSize: '13px', color: 'var(--text-main)', lineHeight: 1.5 }}>
                  <strong>Username / Login:</strong> <code>{createdInfo.username}</code> &nbsp;|&nbsp; <strong>Password:</strong> <code>{createdInfo.password}</code>
                  {createdInfo.email && <span> &nbsp;|&nbsp; <strong>Email:</strong> <code>{createdInfo.email}</code></span>}
                </div>
              </div>
              <button
                type="button"
                className="btn-primary"
                style={{ padding: '8px 14px', fontSize: '12.5px' }}
                onClick={() => copyCredentials(createdInfo.username, createdInfo.password, createdInfo.name, createdInfo.role, createdInfo.email)}
              >
                📋 Copy Login Details to Share
              </button>
            </div>
          </div>
        )}

        <div className="panel" style={{ marginBottom: '16px' }}>
          <div className="panel-header">
            <h4 style={{ margin: 0 }}>{editId ? `Edit ${entity}` : `Add New ${entity}`}</h4>
          </div>
          <div className="panel-body">
            <form onSubmit={handleSubmit} className="form-grid">
              <div className="form-group">
                <label className="form-label">{entity} Full Name <span className="req">*</span></label>
                <input className="form-control" placeholder={isDept ? 'e.g. IT, Operations' : isHost ? 'e.g. Vikram Malhotra' : 'e.g. Client Meeting, Audit'} value={form.name || ''} onChange={e => setField('name', e.target.value)} required />
              </div>

              {isDept && (
                <div className="form-group">
                  <label className="form-label">Code (Short)</label>
                  <input className="form-control" placeholder="e.g. IT, OPS" value={form.code || ''} onChange={e => setField('code', e.target.value)} />
                </div>
              )}

              {isHost && (
                <>
                  <div className="form-group">
                    <label className="form-label">System Role <span className="req">*</span></label>
                    <select className="form-control" value={form.role || 'HOST'} onChange={e => setField('role', e.target.value)} required>
                      <option value="HOST">Host / Employee (Can Review & Approve Visitors)</option>
                      <option value="EMPLOYEE">Employee (Host)</option>
                      <option value="CEO">Chief Executive Officer (CEO)</option>
                      <option value="ADMIN">System Administrator</option>
                      <option value="SUPER_ADMIN">Super Administrator</option>
                      <option value="RECEPTION">Reception Desk</option>
                      <option value="GUARD">Security Guard</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Email Address</label>
                    <input className="form-control" type="email" placeholder="e.g. vikram@opsvision.com" value={form.email || ''} onChange={e => {
                      const emailVal = e.target.value;
                      setForm(prev => ({
                        ...prev,
                        email: emailVal,
                        username: (!prev.username || prev.username === prev.email?.split('@')[0]) ? emailVal.split('@')[0] : prev.username
                      }));
                    }} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Username (Leave empty to auto-generate)</label>
                    <input className="form-control" placeholder="e.g. vikram (Optional - auto-generated if blank)" value={form.username || ''} onChange={e => setField('username', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Login Password {editId ? '(Leave blank to keep unchanged)' : ''}</label>
                    <input className="form-control" type="password" placeholder={editId ? '••••••••' : 'Enter login password (e.g. host123)'} value={form.password || ''} onChange={e => setField('password', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Department / Unit</label>
                    <select className="form-control" value={form.department || ''} onChange={e => setField('department', e.target.value)}>
                      <option value="">-- Select Department --</option>
                      {departmentsList.map(d => (
                        <option key={d.id} value={d.name}>{d.name} {d.code ? `(${d.code})` : ''}</option>
                      ))}
                      {form.department && !departmentsList.some(d => d.name === form.department) && (
                        <option value={form.department}>{form.department}</option>
                      )}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Mobile / Phone Number</label>
                    <input className="form-control" placeholder="e.g. 9876543210" value={form.phone || ''} onChange={e => setField('phone', e.target.value)} />
                  </div>
                </>
              )}

              {!isHost && !isDept && (
                <div className="form-group">
                  <label className="form-label">Description</label>
                  <input className="form-control" placeholder="Optional description" value={form.description || ''} onChange={e => setField('description', e.target.value)} />
                </div>
              )}

              <div className="form-group full-width" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input type="checkbox" checked={form.active !== false} onChange={e => setField('active', e.target.checked)} />
                <label className="checkbox-label" style={{ marginBottom: 0 }}>Active (Account enabled)</label>
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

        {isHost && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ fontWeight: '700', fontSize: '14px', color: 'var(--text-main)' }}>
              User Directory ({filteredItems.length} user{filteredItems.length !== 1 ? 's' : ''})
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-muted)' }}>Filter Role:</label>
              <select className="form-control" style={{ width: 'auto', padding: '4px 10px', fontSize: '12.5px' }} value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
                <option value="ALL">All System Roles</option>
                <option value="SUPER_ADMIN">SUPER_ADMIN</option>
                <option value="ADMIN">ADMIN</option>
                <option value="CEO">CEO</option>
                <option value="HOST">HOST / EMPLOYEE</option>
                <option value="RECEPTION">RECEPTION</option>
                <option value="GUARD">GUARD</option>
              </select>
            </div>
          </div>
        )}

        <div className="table-container" style={{ border: 'none', boxShadow: 'none' }}>
          <table className="custom-table">
            <thead>
              <tr>
                <th>Name</th>
                {isDept && <th>Code</th>}
                {isHost && <th>Role</th>}
                {isHost && <th>Login Credentials</th>}
                {isHost && <th>Department</th>}
                {isHost && <th>Phone</th>}
                {!isHost && !isDept && <th>Description</th>}
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={isHost ? 8 : isDept ? 5 : 4} style={{ textAlign: 'center', padding: '30px' }}>Loading master data...</td></tr>
              ) : filteredItems.length === 0 ? (
                <tr><td colSpan={isHost ? 8 : isDept ? 5 : 4} style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>No records found.</td></tr>
              ) : (
                filteredItems.map(it => (
                  <tr key={it.id}>
                    <td><b>{it.name}</b></td>
                    {isDept && <td>{it.code || <span style={{ color: 'var(--text-light)' }}>-</span>}</td>}
                    {isHost && (
                      <td>
                        <span className="badge badge-inside" style={{ fontSize: '11px', textTransform: 'uppercase' }}>{it.role}</span>
                      </td>
                    )}
                    {isHost && (
                      <td>
                        <div style={{ fontWeight: '700', color: 'var(--primary)' }}>👤 {it.username}</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>✉️ {it.email || '-'}</div>
                      </td>
                    )}
                    {isHost && <td>{it.department || <span style={{ color: 'var(--text-light)' }}>-</span>}</td>}
                    {isHost && <td>{it.phone || <span style={{ color: 'var(--text-light)' }}>-</span>}</td>}
                    {!isHost && !isDept && <td>{it.description || <span style={{ color: 'var(--text-light)' }}>-</span>}</td>}
                    <td>{it.active ? <span style={{ color: 'var(--success)', fontWeight: 700 }}>Active</span> : <span style={{ color: 'var(--danger)', fontWeight: 700 }}>Inactive</span>}</td>
                    <td>
                      <button className="btn-secondary" style={{ padding: '4px 8px', fontSize: '12px', marginRight: '4px' }} onClick={() => startEdit(it)}>Edit</button>
                      {isHost && (
                        <button
                          className="btn-secondary"
                          style={{ padding: '4px 8px', fontSize: '12px', marginRight: '4px' }}
                          title="Copy login details to clipboard"
                          onClick={() => copyCredentials(it.username, '••••••••', it.name, it.role, it.email)}
                        >
                          📋 Copy Details
                        </button>
                      )}
                      <button className="btn-secondary" style={{ padding: '4px 8px', fontSize: '12px', color: 'var(--danger)', borderColor: 'var(--danger-border)' }} onClick={() => remove(it)}>Remove</button>
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

// ================= ROLE-SCOPED HELP & USER GUIDE =================
function HelpGuide({ user, setTab }) {
  const role = user.role;
  const isHost = role === 'HOST' || role === 'EMPLOYEE';
  const isGuard = role === 'GUARD' || role === 'RECEPTION';
  const isCeo = role === 'CEO';
  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';

  const roleLabels = {
    HOST: 'Host / Employee',
    EMPLOYEE: 'Host / Employee',
    GUARD: 'Security Guard / Gatekeeper',
    RECEPTION: 'Reception Desk Manager',
    CEO: 'Chief Executive Officer (CEO)',
    ADMIN: 'System Administrator',
    SUPER_ADMIN: 'Super Administrator'
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Hero Welcome Box */}
      <div className="panel" style={{ background: 'linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%)', color: '#fff', border: 'none', padding: '32px', borderRadius: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'rgba(255,255,255,0.2)', padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: '700', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              <span>👤 Role-Tailored Guide:</span> {roleLabels[role] || role}
            </div>
            <h2 style={{ margin: '0 0 8px 0', fontSize: '24px', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <img src="/swagatham_text_white.png" alt="Swagatham" style={{ height: '32px', width: 'auto', objectFit: 'contain' }} /> VMS User & Workflow Guide
            </h2>
            <p style={{ margin: 0, opacity: 0.9, fontSize: '14px', maxWidth: '680px', lineHeight: 1.5 }}>
              Welcome <strong>{user.name}</strong>. This guide explains how to register visitors, approve passes, manage gate access, and track security operations for your specific account level.
            </p>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.15)', padding: '16px 20px', borderRadius: '12px', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.2)' }}>
            <div style={{ fontSize: '11px', opacity: '0.8', textTransform: 'uppercase', fontWeight: '700' }}>Active Workspace Account</div>
            <div style={{ fontSize: '15px', fontWeight: '800', marginTop: '2px' }}>{user.name}</div>
            <div style={{ fontSize: '12px', opacity: '0.9' }}>{user.department || 'General'} Department</div>
          </div>
        </div>
      </div>

      {/* Visual Access Lifecycle Overview (For All Roles) */}
      <div className="panel">
        <div className="panel-header">
          <h3 className="panel-title">
            <span style={{ fontSize: '18px' }}>🔄</span> Enterprise Visitor Access Lifecycle
          </h3>
        </div>
        <div className="panel-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '16px', textAlign: 'center' }}>
            <div style={{ background: 'var(--bg-card-subtle)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
              <div style={{ fontSize: '24px', marginBottom: '6px' }}>📝</div>
              <div style={{ fontWeight: '700', fontSize: '13px', color: 'var(--primary)' }}>1. Registration</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Visitor registers at Reception, Public Portal, or Host Pre-Pass</div>
            </div>
            <div style={{ background: 'var(--bg-card-subtle)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
              <div style={{ fontSize: '24px', marginBottom: '6px' }}>🔔</div>
              <div style={{ fontWeight: '700', fontSize: '13px', color: '#f59e0b' }}>2. Host Alert</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Host receives Bell alert, Sound chime & Toast banner</div>
            </div>
            <div style={{ background: 'var(--bg-card-subtle)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
              <div style={{ fontSize: '24px', marginBottom: '6px' }}>✅</div>
              <div style={{ fontWeight: '700', fontSize: '13px', color: '#059669' }}>3. Decision</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Host Single-Tap Approves, Proposes Time, or Rejects</div>
            </div>
            <div style={{ background: 'var(--bg-card-subtle)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
              <div style={{ fontSize: '24px', marginBottom: '6px' }}>🚪</div>
              <div style={{ fontWeight: '700', fontSize: '13px', color: '#2563eb' }}>4. Gate Check-In</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Security verifies Pass Code/QR and taps Check In</div>
            </div>
            <div style={{ background: 'var(--bg-card-subtle)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
              <div style={{ fontSize: '24px', marginBottom: '6px' }}>🏃</div>
              <div style={{ fontWeight: '700', fontSize: '13px', color: '#64748b' }}>5. Gate Check-Out</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Visitor exits; audit trail logs departure time</div>
            </div>
          </div>
        </div>
      </div>

      {/* Role-Specific Detailed Instructions */}

      {/* ================= HOST / EMPLOYEE GUIDE ================= */}
      {(isHost || isAdmin || isCeo) && (
        <div className="panel">
          <div className="panel-header" style={{ background: 'var(--bg-card-subtle)' }}>
            <h3 className="panel-title">
              <span style={{ fontSize: '20px' }}>👔</span> Host & Employee Guide — Reviewing & Pre-Approving Visits
            </h3>
            <span className="badge badge-inside">Host Scope</span>
          </div>
          <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '20px' }}>
              <h4 style={{ margin: '0 0 10px 0', color: 'var(--primary)', fontSize: '15px' }}>
                1. How to Handle Incoming Visitor Notifications
              </h4>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 12px 0', lineHeight: 1.5 }}>
                When a visitor registers at reception to meet you, you will receive an instant notification in 3 ways:
              </p>
              <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', color: 'var(--text-main)', lineHeight: 1.6 }}>
                <li><strong>Header Bell Dropdown:</strong> Red badge indicator in the top navbar bell.</li>
                <li><strong>Sound Chime:</strong> Audio tone alerting you to the new visitor request.</li>
                <li><strong>Live Toast Banner:</strong> Pop-up box on top right with direct action buttons.</li>
              </ul>
              <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', padding: '12px 16px', borderRadius: '8px', marginTop: '14px', fontSize: '12px', color: '#065f46' }}>
                💡 <strong>Direct Action:</strong> You do NOT have to leave your current page! You can click <strong>Single-Tap Approve</strong>, <strong>Propose Time</strong>, or <strong>Reject</strong> directly inside the Bell Dropdown or Toast Banner.
              </div>
            </div>

            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '20px' }}>
              <h4 style={{ margin: '0 0 10px 0', color: 'var(--primary)', fontSize: '15px' }}>
                2. The Three Host Decision Options
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', marginTop: '12px' }}>
                <div style={{ border: '1px solid #a7f3d0', background: '#f0fdf4', padding: '14px', borderRadius: '10px' }}>
                  <div style={{ fontWeight: '700', color: '#15803d', fontSize: '13px', marginBottom: '4px' }}>✅ Single-Tap Approve</div>
                  <div style={{ fontSize: '12px', color: '#166534' }}>Immediately approves the pass, sends email with Pass QR to visitor, and notifies Security Guard at gate.</div>
                </div>
                <div style={{ border: '1px solid #fde68a', background: '#fffbeb', padding: '14px', borderRadius: '10px' }}>
                  <div style={{ fontWeight: '700', color: '#b45309', fontSize: '13px', marginBottom: '4px' }}>📅 Propose New Time</div>
                  <div style={{ fontSize: '12px', color: '#92400e' }}>Sends a counter-proposal date & time link to the visitor's email for single-click acceptance.</div>
                </div>
                <div style={{ border: '1px solid #fecaca', background: '#fef2f2', padding: '14px', borderRadius: '10px' }}>
                  <div style={{ fontWeight: '700', color: '#b91c1c', fontSize: '13px', marginBottom: '4px' }}>❌ Reject Request</div>
                  <div style={{ fontSize: '12px', color: '#991b1b' }}>Declines entry. Requires a mandatory reason (e.g. host unavailable/meeting cancelled).</div>
                </div>
              </div>
            </div>

            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '20px' }}>
              <h4 style={{ margin: '0 0 10px 0', color: 'var(--primary)', fontSize: '15px' }}>
                3. Pre-Issuing Guest Passes for Expected Visitors
              </h4>
              <ol style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', color: 'var(--text-main)', lineHeight: 1.6 }}>
                <li>Click <strong>Visitor Registration</strong> on the left sidebar.</li>
                <li>Enter visitor name, 10-digit mobile number, and visit purpose.</li>
                <li>Select expected arrival & departure time.</li>
                <li>Submit: Because you are creating the pass for yourself, the pass is <strong>Auto-Approved</strong> and ready for gate entry!</li>
              </ol>
            </div>
          </div>
        </div>
      )}

      {/* ================= GUARD / RECEPTION GUIDE ================= */}
      {(isGuard || isAdmin || isCeo) && (
        <div className="panel">
          <div className="panel-header" style={{ background: 'var(--bg-card-subtle)' }}>
            <h3 className="panel-title">
              <span style={{ fontSize: '20px' }}>🛡️</span> Guard & Reception Guide — Walk-in Registration & Gate Access
            </h3>
            <span className="badge badge-inside">Gate Security Scope</span>
          </div>
          <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '20px' }}>
              <h4 style={{ margin: '0 0 10px 0', color: 'var(--primary)', fontSize: '15px' }}>
                1. How to Register Walk-In Visitors at Reception
              </h4>
              <ol style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', color: 'var(--text-main)', lineHeight: 1.6 }}>
                <li>Go to the <strong>Visitor Registration</strong> tab on the left sidebar.</li>
                <li>Fill in the mandatory details: <strong>Full Name</strong>, <strong>10-digit Mobile Number</strong>, <strong>Host (Person to Meet)</strong>, and <strong>Purpose</strong>.</li>
                <li>Select the expected <strong>Check-In</strong> and <strong>Check-Out</strong> date and time.</li>
                <li>(Optional) Click <strong>📸 Snap Photo</strong> to capture a webcam photograph of the visitor.</li>
                <li>Click <strong>Register Visitor</strong>. The visitor status will set to <span className="badge badge-pending">PENDING HOST REVIEW</span>, and an alert will instantly ping the host.</li>
              </ol>
            </div>

            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '20px' }}>
              <h4 style={{ margin: '0 0 10px 0', color: 'var(--primary)', fontSize: '15px' }}>
                2. Performing Gate Check-In (`CHECKED_IN`)
              </h4>
              <ol style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', color: 'var(--text-main)', lineHeight: 1.6 }}>
                <li>When the visitor arrives at the gate, request their <strong>Pass Code</strong> (e.g. <code>VAMS-XYZ123</code>) or scan their digital QR badge.</li>
                <li>Go to <strong>Visitor Directory</strong>. Filter status by <strong>Approved</strong>.</li>
                <li>Click the green <strong>Check In</strong> button.</li>
                <li>The system sets the visitor to <span className="badge badge-inside">INSIDE</span> and automatically notifies the host that their visitor has arrived!</li>
              </ol>
            </div>

            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '20px' }}>
              <h4 style={{ margin: '0 0 10px 0', color: 'var(--primary)', fontSize: '15px' }}>
                3. Performing Gate Check-Out (`CHECKED_OUT`)
              </h4>
              <ol style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', color: 'var(--text-main)', lineHeight: 1.6 }}>
                <li>When the visitor leaves the building, locate their record in <strong>Visitor Directory</strong>.</li>
                <li>Click the red <strong>Check Out</strong> button.</li>
                <li>The system records the departure timestamp and completes the visit lifecycle.</li>
              </ol>
            </div>
          </div>
        </div>
      )}

      {/* ================= CEO / EXECUTIVE GUIDE ================= */}
      {(isCeo || isAdmin) && (
        <div className="panel">
          <div className="panel-header" style={{ background: 'var(--bg-card-subtle)' }}>
            <h3 className="panel-title">
              <span style={{ fontSize: '20px' }}>👑</span> Executive Guide — Governance, VIP Approvals & Security Audit
            </h3>
            <span className="badge badge-inside">Executive Scope</span>
          </div>
          <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '20px' }}>
              <h4 style={{ margin: '0 0 10px 0', color: 'var(--primary)', fontSize: '15px' }}>
                1. Executive Oversight & VIP Guest Approvals
              </h4>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
                As CEO, you have access to executive pre-approvals, facility analytics, and security audit logs. You can single-tap approve VIP visitors assigned to the Executive office or inspect all pending host approvals across the organisation.
              </p>
            </div>

            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '20px' }}>
              <h4 style={{ margin: '0 0 10px 0', color: 'var(--primary)', fontSize: '15px' }}>
                2. Visual Analytics & Security Audit Trail
              </h4>
              <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', color: 'var(--text-main)', lineHeight: 1.6 }}>
                <li><strong>Reports & Analytics:</strong> Interactive pie and bar charts breakdown visitors by status, department, and purpose.</li>
                <li><strong>Digital Audit Trail:</strong> Complete real-time audit log of every pass registration, host decision, gate scan, and system state change.</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* ================= ADMINISTRATOR GUIDE ================= */}
      {isAdmin && (
        <div className="panel">
          <div className="panel-header" style={{ background: 'var(--bg-card-subtle)' }}>
            <h3 className="panel-title">
              <span style={{ fontSize: '20px' }}>⚙️</span> Administrator Guide — System Master Data & SMTP Setup
            </h3>
            <span className="badge badge-inside">System Admin Scope</span>
          </div>
          <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '20px' }}>
              <h4 style={{ margin: '0 0 10px 0', color: 'var(--primary)', fontSize: '15px' }}>
                1. Master Data Configuration
              </h4>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 10px 0', lineHeight: 1.5 }}>
                Navigate to <strong>Master Data</strong> on the left sidebar to add, edit, or toggle:
              </p>
              <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', color: 'var(--text-main)', lineHeight: 1.6 }}>
                <li><strong>Departments:</strong> Department codes and active facility units.</li>
                <li><strong>Visit Purposes:</strong> Master list of valid entry reasons.</li>
                <li><strong>People to Meet (Hosts):</strong> Staff accounts available for visitor assignment.</li>
              </ul>
            </div>

            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '20px' }}>
              <h4 style={{ margin: '0 0 10px 0', color: 'var(--primary)', fontSize: '15px' }}>
                2. Google Workspace SMTP Email Configuration
              </h4>
              <ol style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', color: 'var(--text-main)', lineHeight: 1.6 }}>
                <li>Click the <strong>SMTP</strong> button in the top header bar.</li>
                <li>Enter Google Workspace SMTP settings (Host: <code>smtp.gmail.com</code>, Port: <code>465</code>).</li>
                <li>Provide Google Workspace email address and 16-character <strong>App Password</strong>.</li>
                <li>Click <strong>🧪 Send Test Email</strong> to verify automated email dispatch to hosts and visitors.</li>
              </ol>
            </div>
          </div>
        </div>
      )}

      {/* Role-tailored FAQ Accordion */}
      <div className="panel">
        <div className="panel-header">
          <h3 className="panel-title">
            <span style={{ fontSize: '18px' }}>❓</span> Frequently Asked Questions ({roleLabels[role] || role})
          </h3>
        </div>
        <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {(isHost || isAdmin || isCeo) && (
            <div style={{ background: 'var(--bg-card-subtle)', padding: '14px 18px', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
              <div style={{ fontWeight: '700', fontSize: '13px', color: 'var(--text-main)', marginBottom: '4px' }}>
                Q: What happens if I miss a visitor notification chime?
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                A: All pending requests stay safely in your <strong>Host Approvals</strong> tab and your <strong>Notifications Bell</strong> menu. You can review and approve them at any time.
              </div>
            </div>
          )}

          {(isGuard || isAdmin) && (
            <div style={{ background: 'var(--bg-card-subtle)', padding: '14px 18px', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
              <div style={{ fontWeight: '700', fontSize: '13px', color: 'var(--text-main)', marginBottom: '4px' }}>
                Q: Can a security guard check in a visitor without host approval?
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                A: No. The VAMS security protocol mandates that the visit status must be <code>APPROVED</code> before the <strong>Check In</strong> button becomes active.
              </div>
            </div>
          )}

          <div style={{ background: 'var(--bg-card-subtle)', padding: '14px 18px', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
            <div style={{ fontWeight: '700', fontSize: '13px', color: 'var(--text-main)', marginBottom: '4px' }}>
              Q: Is webcam photo capture compulsory?
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              A: Webcam photo capture is optional for standard visits but recommended for enhanced facility security compliance.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
