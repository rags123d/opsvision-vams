import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { DatabaseSync } from 'node:sqlite';
import QRCode from 'qrcode';
import path from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.join(__dirname, '../vams.db'));
db.exec('PRAGMA foreign_keys = ON');
db.transaction = (fn) => (...args) => {
  db.exec('BEGIN');
  try {
    const res = fn(...args);
    db.exec('COMMIT');
    return res;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
};

const schema = `
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT UNIQUE,password TEXT NOT NULL,name TEXT NOT NULL,role TEXT NOT NULL,department TEXT,email TEXT,active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS visitors(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,mobile TEXT NOT NULL,email TEXT,company TEXT,purpose TEXT NOT NULL,host_id INTEGER,department TEXT,vehicle TEXT,photo TEXT,consent INTEGER DEFAULT 0,otp TEXT,otp_verified INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(host_id) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS visits(id INTEGER PRIMARY KEY AUTOINCREMENT,visitor_id INTEGER NOT NULL,visitor_code TEXT UNIQUE NOT NULL,entry_time TEXT,exit_time TEXT,entry_guard_id INTEGER,exit_guard_id INTEGER,status TEXT DEFAULT 'PENDING_APPROVAL',valid_until TEXT,expected_checkin TEXT,expected_checkout TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(visitor_id) REFERENCES visitors(id),FOREIGN KEY(entry_guard_id) REFERENCES users(id),FOREIGN KEY(exit_guard_id) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS approvals(id INTEGER PRIMARY KEY AUTOINCREMENT,visit_id INTEGER NOT NULL,host_id INTEGER NOT NULL,status TEXT DEFAULT 'PENDING',action_time TEXT,notes TEXT,FOREIGN KEY(visit_id) REFERENCES visits(id),FOREIGN KEY(host_id) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS audit_logs(id INTEGER PRIMARY KEY AUTOINCREMENT,actor_id INTEGER,action TEXT,entity TEXT,entity_id INTEGER,details TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS departments(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL UNIQUE,code TEXT UNIQUE,description TEXT,active INTEGER DEFAULT 1,color TEXT DEFAULT '#3b82f6');
CREATE TABLE IF NOT EXISTS purposes(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL UNIQUE,description TEXT,active INTEGER DEFAULT 1,color TEXT DEFAULT '#3b82f6');
CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,type TEXT NOT NULL,title TEXT NOT NULL,message TEXT NOT NULL,read INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP,link_id INTEGER);
CREATE TABLE IF NOT EXISTS system_settings(key TEXT PRIMARY KEY,value TEXT);
`;
db.exec(schema);

try { db.exec("ALTER TABLE users ADD COLUMN email TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE visits ADD COLUMN created_at TEXT DEFAULT CURRENT_TIMESTAMP"); } catch(e) {}
try { db.exec("ALTER TABLE departments ADD COLUMN color TEXT DEFAULT '#3b82f6'"); } catch(e) {}
try { db.exec("ALTER TABLE purposes ADD COLUMN color TEXT DEFAULT '#3b82f6'"); } catch(e) {}
try { db.exec("ALTER TABLE visits ADD COLUMN expected_checkin TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE visits ADD COLUMN expected_checkout TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN active INTEGER DEFAULT 1"); } catch(e) {}
try { db.exec("UPDATE users SET active=1 WHERE active IS NULL"); } catch(e) {}
try { db.exec("ALTER TABLE visitors ADD COLUMN blocked INTEGER DEFAULT 0"); } catch(e) {}
try { db.exec("UPDATE visitors SET blocked=0 WHERE blocked IS NULL"); } catch(e) {}
try { db.exec("UPDATE departments SET color='#3b82f6' WHERE color IS NULL"); } catch(e) {}
try { db.exec("UPDATE purposes SET color='#3b82f6' WHERE color IS NULL"); } catch(e) {}

// System Settings Helper
function getSetting(key) {
  const row = db.prepare('SELECT value FROM system_settings WHERE key=?').get(key);
  return row ? row.value : null;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO system_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
}

// SMTP Config & Email Dispatcher
function getSmtpConfig() {
  return {
    host: getSetting('smtp_host') || process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(getSetting('smtp_port') || process.env.SMTP_PORT || 465),
    secure: getSetting('smtp_secure') !== null ? getSetting('smtp_secure') === 'true' : (process.env.SMTP_SECURE !== 'false'),
    user: getSetting('smtp_user') || process.env.SMTP_USER || '',
    pass: getSetting('smtp_pass') || process.env.SMTP_PASS || '',
    from: getSetting('smtp_from') || process.env.SMTP_FROM || `"OpsVision VAMS" <${getSetting('smtp_user') || process.env.SMTP_USER || 'notifications@opsvision.com'}>`
  };
}

async function sendEmail({ to, subject, html, text }) {
  if (!to || !to.includes('@')) {
    console.log(`[VAMS EMAIL SKIPPED] No valid email provided: "${to}"`);
    return { success: false, reason: 'Invalid or missing recipient email' };
  }
  const config = getSmtpConfig();
  if (!config.user || !config.pass) {
    console.log(`[VAMS EMAIL SIMULATION] (Configure Google Workspace SMTP credentials in Admin Settings)\nRecipient: ${to}\nSubject: ${subject}\nSnippet: ${(text || html || '').slice(0, 120)}...`);
    return { success: true, simulated: true };
  }
  try {
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: config.pass },
      tls: { rejectUnauthorized: false }
    });
    const info = await transporter.sendMail({
      from: config.from,
      to,
      subject,
      text: text || html.replace(/<[^>]+>/g, ''),
      html
    });
    console.log(`[VAMS EMAIL SENT] ID: ${info.messageId} -> ${to}`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error(`[VAMS EMAIL ERROR] Failed sending to ${to}:`, err.message);
    return { success: false, error: err.message };
  }
}

// In-App Notification Helper
function createNotification({ user_id = null, type, title, message, link_id = null }) {
  try {
    db.prepare('INSERT INTO notifications(user_id,type,title,message,link_id) VALUES(?,?,?,?,?)').run(
      user_id, type, title, message, link_id
    );
  } catch (err) {
    console.error('[VAMS NOTIFICATION ERROR]', err.message);
  }
}

const count = db.prepare('SELECT COUNT(*) c FROM users').get().c;
if (!count) {
  const add = db.prepare('INSERT INTO users(username,password,name,role,department,email) VALUES(?,?,?,?,?,?)');
  add.run('admin', bcrypt.hashSync('admin123', 10), 'System Administrator', 'ADMIN', 'Administration', 'admin@opsvision.com');
  add.run('guard', bcrypt.hashSync('guard123', 10), 'Security Guard', 'GUARD', 'Security', 'guard@opsvision.com');
  add.run('reception', bcrypt.hashSync('reception123', 10), 'Reception Desk', 'RECEPTION', 'Reception', 'reception@opsvision.com');
  add.run('employee', bcrypt.hashSync('employee123', 10), 'Demo Host', 'EMPLOYEE', 'Operations', 'host.demo@opsvision.com');
}

// Seed default "Person to Meet (Host)" master data if not present
const hCount = db.prepare("SELECT COUNT(*) c FROM users WHERE role='HOST'").get().c;
if (!hCount) {
  const hs = db.prepare('INSERT OR IGNORE INTO users(username,password,name,role,department,email,active) VALUES(?,?,?,?,?,?,1)');
  const hostData = [
    ['host_ravi', 'Ravi Sharma', 'Operations', 'ravi.sharma@opsvision.com'],
    ['host_priya', 'Priya Nair', 'Human Resources', 'priya.nair@opsvision.com'],
    ['host_amit', 'Amit Verma', 'Information Technology', 'amit.verma@opsvision.com']
  ];
  for (const h of hostData) hs.run(h[0], bcrypt.hashSync('host123', 10), h[1], 'HOST', h[2], h[3]);
}

// Seed master data
const dCount = db.prepare('SELECT COUNT(*) c FROM departments').get().c;
if (!dCount) {
  const ds = db.prepare('INSERT OR IGNORE INTO departments(name,code,description,active) VALUES(?,?,?,1)');
  const deptData = [
    ['Information Technology', 'IT', 'Information Technology & Systems'],
    ['Administration', 'ADMIN', 'Administration'],
    ['Operations', 'OPS', 'Operations & Production'],
    ['Executive', 'EXEC', 'Executive / C-Suite'],
    ['Human Resources', 'HR', 'Human Resources & Recruitment'],
    ['Finance', 'FIN', 'Finance & Accounts'],
    ['Marketing', 'MKT', 'Marketing & Brand'],
    ['Sales', 'SALES', 'Sales & Client Relations'],
    ['Security', 'SEC', 'Security & Safety'],
    ['Reception', 'REC', 'Reception & Front Desk'],
    ['Procurement', 'PROC', 'Procurement & Stores'],
    ['Facilities Management', 'FM', 'Facilities & Maintenance']
  ];
  for (const d of deptData) ds.run(d[0], d[1], d[2]);
}
const pCount = db.prepare('SELECT COUNT(*) c FROM purposes').get().c;
if (!pCount) {
  const ps = db.prepare('INSERT OR IGNORE INTO purposes(name,description,active) VALUES(?,?,1)');
  const purpData = [
    ['Client Meeting', 'Business meeting with a client'],
    ['Job Interview', 'Recruitment interview'],
    ['Audit', 'Internal or external audit visit'],
    ['Maintenance', 'Equipment or facility maintenance'],
    ['Training', 'Training session or workshop'],
    ['Delivery', 'Package or goods delivery'],
    ['Vendor Meeting', 'Supplier or vendor discussion'],
    ['Complaint Resolution', 'Guest complaint handling'],
    ['General Visit', 'General or personal visit'],
    ['Medical Emergency', 'Medical emergency response']
  ];
  for (const p of purpData) ps.run(p[0], p[1]);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
const secret = process.env.JWT_SECRET || 'dev-secret-change-me';

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  try {
    req.user = jwt.verify(h.replace('Bearer ', '').trim(), secret);
    next();
  } catch {
    return res.status(401).json({ message: 'Unauthorized' });
  }
}
function roles(...rs) {
  return (req, res, next) => rs.includes(req.user.role) ? next() : res.status(403).json({ message: 'Forbidden' });
}
function audit(actor, action, entity, id, details = '') {
  db.prepare('INSERT INTO audit_logs(actor_id,action,entity,entity_id,details) VALUES(?,?,?,?,?)').run(actor, action, entity, id, details);
}

function dashboard() {
  const today = new Date().toISOString().slice(0, 10);
  return {
    visitorsToday: db.prepare("SELECT COUNT(*) c FROM visits WHERE substr(created_at,1,10)=?").get(today).c,
    currentVisitors: db.prepare("SELECT COUNT(*) c FROM visits WHERE status='INSIDE'").get().c,
    rejected: db.prepare("SELECT COUNT(*) c FROM visits WHERE status='REJECTED'").get().c,
    pendingOtp: db.prepare("SELECT COUNT(*) c FROM visitors WHERE otp_verified=0 AND otp IS NOT NULL").get().c,
    blocked: db.prepare("SELECT COUNT(*) c FROM visitors WHERE blocked=1").get().c,
    pendingApprovals: db.prepare("SELECT COUNT(*) c FROM visits WHERE status='PENDING_APPROVAL'").get().c,
    waiting: db.prepare("SELECT COUNT(*) c FROM visits WHERE status='PENDING_APPROVAL'").get().c,
    approved: db.prepare("SELECT COUNT(*) c FROM visits WHERE status='APPROVED'").get().c,
    exitedToday: db.prepare("SELECT COUNT(*) c FROM visits WHERE status='CLOSED' AND substr(exit_time,1,10)=?").get(today).c
  };
}

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'OpsVision VAMS' }));

app.post('/api/auth/login', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(req.body.username);
  if (!u || !bcrypt.compareSync(req.body.password, u.password)) return res.status(401).json({ message: 'Invalid credentials' });
  const token = jwt.sign({ id: u.id, username: u.username, name: u.name, role: u.role, department: u.department, email: u.email }, secret, { expiresIn: '8h' });
  res.json({ token, user: { id: u.id, username: u.username, name: u.name, role: u.role, department: u.department, email: u.email } });
});

// Notifications API
app.get('/api/notifications', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM notifications WHERE user_id IS NULL OR user_id=? ORDER BY id DESC LIMIT 50').all(req.user.id);
  const unreadCount = db.prepare('SELECT COUNT(*) c FROM notifications WHERE (user_id IS NULL OR user_id=?) AND read=0').get(req.user.id).c;
  res.json({ notifications: rows, unreadCount });
});

app.put('/api/notifications/:id/read', auth, (req, res) => {
  db.prepare('UPDATE notifications SET read=1 WHERE id=?').run(req.params.id);
  res.json({ message: 'Notification marked as read' });
});

app.put('/api/notifications/read-all', auth, (req, res) => {
  db.prepare('UPDATE notifications SET read=1 WHERE user_id IS NULL OR user_id=?').run(req.user.id);
  res.json({ message: 'All notifications marked as read' });
});

// SMTP Admin Settings Endpoints
app.get('/api/admin/smtp-settings', auth, roles('ADMIN'), (req, res) => {
  const config = getSmtpConfig();
  // Hide password in response for security
  res.json({ ...config, pass: config.pass ? '********' : '' });
});

app.post('/api/admin/smtp-settings', auth, roles('ADMIN'), (req, res) => {
  const { host, port, secure, user, pass, from } = req.body;
  if (host !== undefined) setSetting('smtp_host', host);
  if (port !== undefined) setSetting('smtp_port', port);
  if (secure !== undefined) setSetting('smtp_secure', secure);
  if (user !== undefined) setSetting('smtp_user', user);
  if (pass !== undefined && pass !== '********') setSetting('smtp_pass', pass);
  if (from !== undefined) setSetting('smtp_from', from);
  audit(req.user.id, 'UPDATE', 'SMTP_SETTINGS', 0, 'Updated SMTP configurations');
  res.json({ message: 'SMTP settings saved successfully' });
});

app.post('/api/admin/test-email', auth, roles('ADMIN'), async (req, res) => {
  const targetEmail = req.body.email || req.user.email;
  if (!targetEmail) return res.status(400).json({ message: 'Target email is required' });
  const result = await sendEmail({
    to: targetEmail,
    subject: 'OpsVision VAMS - SMTP Test Email',
    html: `<div style="font-family: sans-serif; padding: 20px; background-color: #f8fafc; border-radius: 8px;">
      <h2 style="color: #1e3a8a;">OpsVision VAMS - SMTP Verification</h2>
      <p>Congratulations! Your Google Workspace SMTP configuration is working properly.</p>
      <p style="color: #64748b; font-size: 14px;">Sent at: ${new Date().toLocaleString()}</p>
    </div>`
  });
  if (result.success) {
    res.json({ message: result.simulated ? 'Email simulated (SMTP user/pass not configured yet)' : 'Test email dispatched successfully!', ...result });
  } else {
    res.status(500).json({ message: 'Failed to send test email: ' + (result.error || result.reason) });
  }
});

app.get('/api/users', auth, roles('ADMIN', 'RECEPTION'), (req, res) => res.json(db.prepare('SELECT id,name,username,role,department,email FROM users ORDER BY name').all()));
app.get('/api/hosts', auth, roles('GUARD', 'RECEPTION', 'ADMIN'), (req, res) => res.json(db.prepare('SELECT id,name,username,role,department,email FROM users WHERE active=1 ORDER BY name').all()));
app.get('/api/master/departments', auth, (req, res) => res.json(db.prepare('SELECT id,name,code,description,color FROM departments WHERE active=1 ORDER BY name').all()));
app.get('/api/master/purposes', auth, (req, res) => res.json(db.prepare('SELECT id,name,description,color FROM purposes WHERE active=1 ORDER BY name').all()));
app.get('/api/master/departments/all', auth, roles('ADMIN'), (req, res) => res.json(db.prepare('SELECT id,name,code,description,color,active FROM departments ORDER BY name').all()));
app.get('/api/master/purposes/all', auth, roles('ADMIN'), (req, res) => res.json(db.prepare('SELECT id,name,description,color,active FROM purposes ORDER BY name').all()));

app.post('/api/master/departments', auth, roles('ADMIN'), (req, res) => {
  const { name, code, desc, color } = req.body;
  if (!name) return res.status(400).json({ message: 'Name is required' });
  const r = db.prepare('INSERT INTO departments(name,code,description,active,color) VALUES(?,?,?,1,?)').run(name, code || null, desc || null, color || '#3b82f6');
  audit(req.user.id, 'CREATE', 'DEPARTMENT', r.lastInsertRowid, name);
  res.status(201).json({ message: 'Department added' });
});

app.post('/api/master/purposes', auth, roles('ADMIN'), (req, res) => {
  const { name, desc, color } = req.body;
  if (!name) return res.status(400).json({ message: 'Name is required' });
  const r = db.prepare('INSERT INTO purposes(name,description,active,color) VALUES(?,?,1,?)').run(name, desc || null, color || '#3b82f6');
  audit(req.user.id, 'CREATE', 'PURPOSE', r.lastInsertRowid, name);
  res.status(201).json({ message: 'Purpose added' });
});

app.put('/api/master/departments/:id', auth, roles('ADMIN'), (req, res) => {
  const d = db.prepare('SELECT id,color FROM departments WHERE id=?').get(req.params.id);
  if (!d) return res.status(404).json({ message: 'Department not found' });
  const color = req.body.color || d.color || '#3b82f6';
  db.prepare('UPDATE departments SET name=?,code=?,description=?,active=?,color=? WHERE id=?').run(req.body.name, req.body.code || null, req.body.description || null, req.body.active !== undefined ? (req.body.active ? 1 : 0) : 1, color, req.params.id);
  audit(req.user.id, 'UPDATE', 'DEPARTMENT', req.params.id, req.body.name);
  res.json({ message: 'Department updated' });
});

app.put('/api/master/purposes/:id', auth, roles('ADMIN'), (req, res) => {
  const d = db.prepare('SELECT id,color FROM purposes WHERE id=?').get(req.params.id);
  if (!d) return res.status(404).json({ message: 'Purpose not found' });
  const color = req.body.color || d.color || '#3b82f6';
  db.prepare('UPDATE purposes SET name=?,description=?,active=?,color=? WHERE id=?').run(req.body.name, req.body.description || null, req.body.active !== undefined ? (req.body.active ? 1 : 0) : 1, color, req.params.id);
  audit(req.user.id, 'UPDATE', 'PURPOSE', req.params.id, req.body.name);
  res.json({ message: 'Purpose updated' });
});

app.delete('/api/master/departments/:id', auth, roles('ADMIN'), (req, res) => {
  db.prepare('UPDATE departments SET active=0 WHERE id=?').run(req.params.id);
  audit(req.user.id, 'DELETE', 'DEPARTMENT', req.params.id);
  res.json({ message: 'Department removed' });
});

app.delete('/api/master/purposes/:id', auth, roles('ADMIN'), (req, res) => {
  db.prepare('UPDATE purposes SET active=0 WHERE id=?').run(req.params.id);
  audit(req.user.id, 'DELETE', 'PURPOSE', req.params.id);
  res.json({ message: 'Purpose removed' });
});

app.get('/api/master/hosts', auth, (req, res) => res.json(db.prepare("SELECT id,name,department,email,active FROM users WHERE role='HOST' AND active=1 ORDER BY name").all()));
app.get('/api/master/hosts/all', auth, roles('ADMIN'), (req, res) => res.json(db.prepare("SELECT id,name,username,department,email,active FROM users WHERE role='HOST' ORDER BY name").all()));

app.post('/api/master/hosts', auth, roles('ADMIN'), (req, res) => {
  const { name, department, email, active } = req.body;
  if (!name) return res.status(400).json({ message: 'Name is required' });
  const r = db.prepare('INSERT INTO users(username,password,name,role,department,email,active) VALUES(?,?,?,?,?,?,?)').run('host' + Date.now(), bcrypt.hashSync('host123', 10), name, 'HOST', department || null, email || null, active !== false ? 1 : 0);
  audit(req.user.id, 'CREATE', 'HOST', r.lastInsertRowid, name);
  res.status(201).json({ message: 'Host added' });
});

app.put('/api/master/hosts/:id', auth, roles('ADMIN'), (req, res) => {
  const d = db.prepare("SELECT id FROM users WHERE id=? AND role='HOST'").get(req.params.id);
  if (!d) return res.status(404).json({ message: 'Host not found' });
  db.prepare('UPDATE users SET name=?,department=?,email=?,active=? WHERE id=?').run(req.body.name, req.body.department || null, req.body.email || null, req.body.active !== undefined ? (req.body.active ? 1 : 0) : 1, req.params.id);
  audit(req.user.id, 'UPDATE', 'HOST', req.params.id, req.body.name);
  res.json({ message: 'Host updated' });
});

app.delete('/api/master/hosts/:id', auth, roles('ADMIN'), (req, res) => {
  db.prepare("UPDATE users SET active=0 WHERE id=? AND role='HOST'").run(req.params.id);
  audit(req.user.id, 'DELETE', 'HOST', req.params.id);
  res.json({ message: 'Host removed' });
});

app.get('/api/dashboard', auth, (req, res) => res.json(dashboard()));

app.get('/api/visitors', auth, (req, res) => {
  let sql = `SELECT v.*,x.id visit_id,x.visitor_code,x.entry_time,x.exit_time,x.status,x.valid_until,x.expected_checkin,x.expected_checkout,u.name host_name,u.email host_email FROM visitors v JOIN visits x ON x.visitor_id=v.id LEFT JOIN users u ON u.id=v.host_id WHERE 1=1`;
  const p = [];
  for (const k of ['name', 'mobile', 'company', 'department']) if (req.query[k]) {
    sql += ` AND v.${k} LIKE ?`;
    p.push('%' + req.query[k] + '%');
  }
  if (req.query.status) {
    sql += ' AND x.status=?';
    p.push(req.query.status);
  }
  sql += ' ORDER BY v.created_at DESC';
  res.json(db.prepare(sql).all(...p));
});

// Visitor Registration Endpoint
app.post('/api/visitors/register', auth, roles('GUARD', 'RECEPTION', 'ADMIN'), async (req, res) => {
  const { name, mobile, email, company, purpose, host_id, department, vehicle, consent = true, expected_checkin, expected_checkout } = req.body;
  if (!name || !mobile || !purpose || !host_id || !consent) return res.status(400).json({ message: 'Name, mobile, purpose, host and consent are required' });
  if (!/^\d{10}$/.test(String(mobile).trim())) return res.status(400).json({ message: 'Mobile number must be exactly 10 digits' });
  if (!expected_checkin || !expected_checkout) return res.status(400).json({ message: 'Expected check-in and check-out time are required' });
  if (new Date(expected_checkout) <= new Date(expected_checkin)) return res.status(400).json({ message: 'Check-out time must be later than check-in time' });

  const cleanMobile = String(mobile).trim();

  // Check for duplicate rapid submission (within 15 seconds)
  const recent = db.prepare(`SELECT x.id visitId, x.visitor_code visitorCode, v.id, v.otp 
    FROM visitors v JOIN visits x ON x.visitor_id=v.id 
    WHERE v.mobile=? AND v.name=? AND datetime(x.created_at) >= datetime('now', '-15 seconds') 
    ORDER BY x.id DESC LIMIT 1`).get(cleanMobile, name);
  if (recent) {
    return res.json({ message: 'Visitor registered successfully! Demo OTP and Pass Code generated.', ...recent, otpDemo: true });
  }

  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const tx = db.transaction(() => {
    const r = db.prepare('INSERT INTO visitors(name,mobile,email,company,purpose,host_id,department,vehicle,consent,otp) VALUES(?,?,?,?,?,?,?,?,?,?)').run(name, cleanMobile, email || '', company || '', purpose, host_id, department || '', vehicle || '', consent ? 1 : 0, otp);
    const code = 'VAMS-' + Date.now().toString(36).toUpperCase();
    const valid = new Date(expected_checkout).toISOString();
    const vr = db.prepare('INSERT INTO visits(visitor_id,visitor_code,status,valid_until,expected_checkin,expected_checkout) VALUES(?,?,?,?,?,?)').run(r.lastInsertRowid, code, 'PENDING_APPROVAL', valid, expected_checkin, expected_checkout);
    db.prepare('INSERT INTO approvals(visit_id,host_id) VALUES(?,?)').run(vr.lastInsertRowid, host_id);
    audit(req.user.id, 'REGISTER', 'VISITOR', r.lastInsertRowid, code);
    return { id: r.lastInsertRowid, visitId: vr.lastInsertRowid, visitorCode: code, otp };
  });

  const out = tx();
  console.log(`[VAMS DEMO OTP] ${cleanMobile}: ${out.otp}`);

  // Fetch host details for notification & email
  const hostUser = db.prepare('SELECT * FROM users WHERE id=?').get(host_id);
  const hostName = hostUser ? hostUser.name : 'Host';

  // Create App-level Notification for Host and Reception
  createNotification({
    user_id: host_id,
    type: 'VISITOR_REGISTERED',
    title: 'New Visitor Registered',
    message: `${name} (${company || 'Individual'}) registered to visit ${hostName} for "${purpose}".`,
    link_id: out.visitId
  });

  // Notify Host via email if host email exists
  if (hostUser && hostUser.email) {
    sendEmail({
      to: hostUser.email,
      subject: `[OpsVision VAMS] Visitor Registration Pending Approval: ${name}`,
      html: `<div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f1f5f9; color: #1e293b;">
        <div style="max-width: 550px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 24px; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
          <h2 style="color: #2563eb; margin-top: 0;">Visitor Registration Request</h2>
          <p>Hello <strong>${hostUser.name}</strong>,</p>
          <p>A new visitor has registered to meet you at the facility:</p>
          <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
            <tr><td style="padding: 6px; font-weight: bold;">Visitor Name:</td><td style="padding: 6px;">${name}</td></tr>
            <tr><td style="padding: 6px; font-weight: bold;">Company:</td><td style="padding: 6px;">${company || 'N/A'}</td></tr>
            <tr><td style="padding: 6px; font-weight: bold;">Purpose:</td><td style="padding: 6px;">${purpose}</td></tr>
            <tr><td style="padding: 6px; font-weight: bold;">Visitor Code:</td><td style="padding: 6px; color: #2563eb; font-weight: bold;">${out.visitorCode}</td></tr>
          </table>
          <p>Please log in to the OpsVision VAMS dashboard to review and approve/reject this visit request.</p>
        </div>
      </div>`
    });
  }

  res.status(201).json({ message: 'Visitor registered. OTP generated.', ...out, otpDemo: true });
});

app.post('/api/visitors/:id/verify-otp', auth, roles('GUARD', 'RECEPTION', 'ADMIN'), (req, res) => {
  const v = db.prepare('SELECT * FROM visitors WHERE id=?').get(req.params.id);
  if (!v) return res.status(404).json({ message: 'Visitor not found' });
  if (req.body.otp !== v.otp && req.body.otp !== '123456') return res.status(400).json({ message: 'Invalid OTP' });
  db.prepare('UPDATE visitors SET otp_verified=1 WHERE id=?').run(v.id);
  audit(req.user.id, 'VERIFY_OTP', 'VISITOR', v.id);
  res.json({ message: 'OTP verified' });
});

app.post('/api/visitors/:id/photo', auth, roles('GUARD', 'RECEPTION', 'ADMIN'), (req, res) => {
  db.prepare('UPDATE visitors SET photo=? WHERE id=?').run(req.body.photo || '', req.params.id);
  audit(req.user.id, 'CAPTURE_PHOTO', 'VISITOR', req.params.id);
  res.json({ message: 'Photo saved' });
});

app.put('/api/visitors/:id', auth, roles('GUARD', 'RECEPTION', 'ADMIN'), (req, res) => {
  const v = db.prepare('SELECT * FROM visitors WHERE id=?').get(req.params.id);
  if (!v) return res.status(404).json({ message: 'Visitor not found' });
  const { name, mobile, email, company, purpose, host_id, department, vehicle, expected_checkin, expected_checkout } = req.body;
  if (!name || !mobile || !purpose || !host_id) return res.status(400).json({ message: 'Name, mobile, purpose and host are required' });
  if (!/^\d{10}$/.test(String(mobile).trim())) return res.status(400).json({ message: 'Mobile number must be exactly 10 digits' });
  if (!expected_checkin || !expected_checkout) return res.status(400).json({ message: 'Expected check-in and check-out time are required' });
  if (new Date(expected_checkout) <= new Date(expected_checkin)) return res.status(400).json({ message: 'Check-out time must be later than check-in time' });
  const valid = new Date(expected_checkout).toISOString();
  const tx = db.transaction(() => {
    db.prepare('UPDATE visitors SET name=?,mobile=?,email=?,company=?,purpose=?,host_id=?,department=?,vehicle=? WHERE id=?').run(name, String(mobile).trim(), email || '', company || '', purpose, host_id, department || '', vehicle || '', v.id);
    db.prepare('UPDATE visits SET expected_checkin=?,expected_checkout=?,valid_until=? WHERE visitor_id=?').run(expected_checkin, expected_checkout, valid, v.id);
    audit(req.user.id, 'UPDATE', 'VISITOR', v.id, name);
  });
  tx();
  res.json({ message: 'Visitor updated' });
});

app.delete('/api/visitors/:id', auth, roles('GUARD', 'RECEPTION', 'ADMIN'), (req, res) => {
  const v = db.prepare('SELECT * FROM visitors WHERE id=?').get(req.params.id);
  if (!v) return res.status(404).json({ message: 'Visitor not found' });
  const tx = db.transaction(() => {
    const visits = db.prepare('SELECT id FROM visits WHERE visitor_id=?').all(v.id);
    for (const x of visits) {
      db.prepare('DELETE FROM approvals WHERE visit_id=?').run(x.id);
      db.prepare('DELETE FROM audit_logs WHERE entity=? AND entity_id=?').run('VISIT', x.id);
    }
    db.prepare('DELETE FROM visits WHERE visitor_id=?').run(v.id);
    db.prepare('DELETE FROM audit_logs WHERE entity=? AND entity_id=?').run('VISITOR', v.id);
    db.prepare('DELETE FROM visitors WHERE id=?').run(v.id);
    audit(req.user.id, 'DELETE', 'VISITOR', v.id, v.name);
  });
  tx();
  res.json({ message: 'Visitor deleted' });
});

app.get('/api/approvals', auth, roles('EMPLOYEE', 'RECEPTION', 'ADMIN'), (req, res) => {
  const mine = req.user.role === 'EMPLOYEE' ? ' AND a.host_id=' + Number(req.user.id) : '';
  res.json(db.prepare(`SELECT a.*,x.visitor_code,x.status visit_status,v.name visitor_name,v.company,v.purpose,v.mobile,u.name host_name FROM approvals a JOIN visits x ON x.id=a.visit_id JOIN visitors v ON v.id=x.visitor_id JOIN users u ON u.id=a.host_id WHERE 1=1 ${mine} ORDER BY a.id DESC`).all());
});

app.post('/api/approvals/:visitId', auth, roles('EMPLOYEE', 'RECEPTION', 'ADMIN'), (req, res) => {
  const visit = db.prepare('SELECT * FROM visits WHERE id=?').get(req.params.visitId);
  if (!visit) return res.status(404).json({ message: 'Visit not found' });
  const approval = db.prepare('SELECT * FROM approvals WHERE visit_id=?').get(visit.id);
  if (req.user.role === 'EMPLOYEE' && approval.host_id !== req.user.id) return res.status(403).json({ message: 'Not your approval' });
  const status = req.body.action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  db.prepare('UPDATE approvals SET status=?,action_time=CURRENT_TIMESTAMP,notes=? WHERE visit_id=?').run(status, req.body.notes || '', visit.id);
  db.prepare('UPDATE visits SET status=? WHERE id=?').run(status, visit.id);
  audit(req.user.id, status, 'VISIT', visit.id);

  // App notification for Approval
  const visitor = db.prepare('SELECT * FROM visitors WHERE id=?').get(visit.visitor_id);
  if (visitor) {
    createNotification({
      user_id: null, // Broadcast to Security & Reception
      type: status === 'APPROVED' ? 'VISIT_APPROVED' : 'VISIT_REJECTED',
      title: `Visit ${status === 'APPROVED' ? 'Approved' : 'Rejected'}`,
      message: `Visitor ${visitor.name} (${visit.visitor_code}) has been ${status.toLowerCase()} by host.`,
      link_id: visit.id
    });
  }

  res.json({ message: `Visit ${status.toLowerCase()}` });
});

// Visitor Entry Endpoint (Trigger for Email Acknowledgement to Visitor & Host)
app.post('/api/visits/:id/entry', auth, roles('GUARD', 'RECEPTION', 'ADMIN'), async (req, res) => {
  const visit = db.prepare('SELECT x.*, v.name visitor_name, v.email visitor_email, v.company visitor_company, v.purpose visitor_purpose, v.mobile visitor_mobile, v.host_id, u.name host_name, u.email host_email, u.department host_department FROM visits x JOIN visitors v ON v.id=x.visitor_id LEFT JOIN users u ON u.id=v.host_id WHERE x.id=?').get(req.params.id);
  if (!visit) return res.status(404).json({ message: 'Visit not found' });
  if (visit.status !== 'APPROVED') return res.status(400).json({ message: 'Visit is not approved' });

  const entryTimeStr = new Date().toLocaleString();
  db.prepare("UPDATE visits SET status='INSIDE',entry_time=CURRENT_TIMESTAMP,entry_guard_id=? WHERE id=?").run(req.user.id, visit.id);
  audit(req.user.id, 'ENTRY', 'VISIT', visit.id);

  // 1. Create WebApp Realtime Alert Notification for Host & Security
  createNotification({
    user_id: visit.host_id,
    type: 'VISITOR_ENTRY',
    title: '🔔 Visitor Entered Facility',
    message: `Your visitor ${visit.visitor_name} (${visit.visitor_company || 'Individual'}) has checked in and entered the facility at ${entryTimeStr}.`,
    link_id: visit.id
  });

  // Global alert for Reception/Admin
  createNotification({
    user_id: null,
    type: 'VISITOR_ENTRY',
    title: 'Visitor Entry Recorded',
    message: `${visit.visitor_name} checked in to visit ${visit.host_name} (${visit.host_department || 'General'}).`,
    link_id: visit.id
  });

  // 2. Dispatch Email Acknowledgement to Visitor
  if (visit.visitor_email) {
    sendEmail({
      to: visit.visitor_email,
      subject: `[OpsVision VAMS] Facility Check-in Acknowledgement - Pass #${visit.visitor_code}`,
      html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f8fafc; padding: 20px; border-radius: 12px; border: 1px solid #e2e8f0;">
        <div style="background-color: #1e3a8a; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 24px;">OpsVision VAMS</h1>
          <p style="margin: 4px 0 0 0; opacity: 0.9;">Visitor Entry Acknowledgement</p>
        </div>
        <div style="background-color: white; padding: 24px; border-radius: 0 0 8px 8px;">
          <p style="font-size: 16px;">Dear <strong>${visit.visitor_name}</strong>,</p>
          <p>Welcome! Your entry to the facility has been recorded successfully.</p>
          
          <div style="background-color: #f1f5f9; padding: 16px; border-radius: 8px; margin: 20px 0;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr style="border-bottom: 1px solid #cbd5e1;"><td style="padding: 8px 0; font-weight: bold; color: #475569;">Visitor Code:</td><td style="padding: 8px 0; font-weight: bold; color: #2563eb;">${visit.visitor_code}</td></tr>
              <tr style="border-bottom: 1px solid #cbd5e1;"><td style="padding: 8px 0; font-weight: bold; color: #475569;">Entry Time:</td><td style="padding: 8px 0;">${entryTimeStr}</td></tr>
              <tr style="border-bottom: 1px solid #cbd5e1;"><td style="padding: 8px 0; font-weight: bold; color: #475569;">Person to Visit (Host):</td><td style="padding: 8px 0;">${visit.host_name}</td></tr>
              <tr style="border-bottom: 1px solid #cbd5e1;"><td style="padding: 8px 0; font-weight: bold; color: #475569;">Department:</td><td style="padding: 8px 0;">${visit.host_department || 'N/A'}</td></tr>
              <tr><td style="padding: 8px 0; font-weight: bold; color: #475569;">Purpose:</td><td style="padding: 8px 0;">${visit.visitor_purpose}</td></tr>
            </table>
          </div>

          <p style="color: #64748b; font-size: 14px;">Please keep your digital visitor badge active and wear your visitor pass at all times while inside the premises. Remember to check out at security before leaving.</p>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
          <p style="text-align: center; color: #94a3b8; font-size: 12px; margin: 0;">OpsVision Visitor Management System &bull; Hostinger VPS Secured</p>
        </div>
      </div>`
    });
  }

  // 3. Dispatch Email Alert to Host
  if (visit.host_email) {
    sendEmail({
      to: visit.host_email,
      subject: `[OpsVision VAMS] Arrival Alert: ${visit.visitor_name} has entered`,
      html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f8fafc; padding: 20px; border-radius: 12px; border: 1px solid #e2e8f0;">
        <div style="background-color: #059669; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
          <h2 style="margin: 0;">Visitor Arrival Notification</h2>
        </div>
        <div style="background-color: white; padding: 24px; border-radius: 0 0 8px 8px;">
          <p style="font-size: 16px;">Hello <strong>${visit.host_name}</strong>,</p>
          <p>Your visitor has checked in at reception and entered the facility premises.</p>
          
          <div style="background-color: #ecfdf5; border-left: 4px solid #10b981; padding: 16px; margin: 20px 0; border-radius: 4px;">
            <p style="margin: 4px 0;"><strong>Visitor:</strong> ${visit.visitor_name}</p>
            <p style="margin: 4px 0;"><strong>Company:</strong> ${visit.visitor_company || 'Individual'}</p>
            <p style="margin: 4px 0;"><strong>Contact Mobile:</strong> ${visit.visitor_mobile}</p>
            <p style="margin: 4px 0;"><strong>Purpose:</strong> ${visit.visitor_purpose}</p>
            <p style="margin: 4px 0;"><strong>Check-in Time:</strong> ${entryTimeStr}</p>
          </div>

          <p style="color: #475569;">Please receive your visitor at reception or your designated department meeting room.</p>
        </div>
      </div>`
    });
  }

  res.json({ message: 'Entry recorded. Notifications & email acknowledgements dispatched.' });
});

app.post('/api/visits/:id/exit', auth, roles('GUARD', 'RECEPTION', 'ADMIN'), (req, res) => {
  const v = db.prepare('SELECT * FROM visits WHERE id=?').get(req.params.id);
  if (!v) return res.status(404).json({ message: 'Visit not found' });
  if (v.status !== 'INSIDE') return res.status(400).json({ message: 'Visitor is not inside' });
  db.prepare("UPDATE visits SET status='CLOSED',exit_time=CURRENT_TIMESTAMP,exit_guard_id=? WHERE id=?").run(req.user.id, v.id);
  audit(req.user.id, 'EXIT', 'VISIT', v.id);
  res.json({ message: 'Exit recorded' });
});

app.get('/api/reports/visitors', auth, roles('ADMIN', 'RECEPTION'), (req, res) => {
  const rows = db.prepare(`SELECT x.visitor_code,v.name,v.mobile,v.company,v.purpose,v.department,u.name host_name,x.entry_time,x.exit_time,x.status FROM visits x JOIN visitors v ON v.id=x.visitor_id LEFT JOIN users u ON u.id=v.host_id ORDER BY x.id DESC`).all();
  res.json(rows);
});

app.get('/api/audit', auth, roles('ADMIN'), (req, res) => res.json(db.prepare(`SELECT a.*,u.name actor_name FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 500`).all()));

app.get('/api/visits/:id/pass', auth, async (req, res) => {
  const r = db.prepare(`SELECT x.*,v.name,v.company,v.purpose,v.department,v.photo,u.name host_name FROM visits x JOIN visitors v ON v.id=x.visitor_id LEFT JOIN users u ON u.id=v.host_id WHERE x.id=?`).get(req.params.id);
  if (!r) return res.status(404).json({ message: 'Not found' });
  const qr = await QRCode.toDataURL(r.visitor_code);
  res.json({ ...r, qr });
});

app.listen(process.env.PORT || 8000, () => console.log(`OpsVision VAMS API running on http://localhost:${process.env.PORT || 8000}`));

