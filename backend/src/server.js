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
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT UNIQUE,password TEXT NOT NULL,name TEXT NOT NULL,role TEXT NOT NULL,department TEXT,email TEXT,phone TEXT,last_login TEXT,active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS visitors(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,mobile TEXT NOT NULL,email TEXT,company TEXT,purpose TEXT NOT NULL,host_id INTEGER,department TEXT,vehicle TEXT,photo TEXT,consent INTEGER DEFAULT 0,otp TEXT,otp_verified INTEGER DEFAULT 0,blocked INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(host_id) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS visits(id INTEGER PRIMARY KEY AUTOINCREMENT,visitor_id INTEGER NOT NULL,visitor_code TEXT UNIQUE NOT NULL,entry_time TEXT,exit_time TEXT,entry_guard_id INTEGER,exit_guard_id INTEGER,status TEXT DEFAULT 'PENDING_HOST_REVIEW',valid_until TEXT,expected_checkin TEXT,expected_checkout TEXT,initiator_type TEXT DEFAULT 'SELF_REGISTERED',expected_arrival_time TEXT,proposed_arrival_time TEXT,rejection_reason TEXT,created_by INTEGER,approved_by INTEGER,pass_token TEXT UNIQUE,created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(visitor_id) REFERENCES visitors(id),FOREIGN KEY(entry_guard_id) REFERENCES users(id),FOREIGN KEY(exit_guard_id) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS approvals(id INTEGER PRIMARY KEY AUTOINCREMENT,visit_id INTEGER NOT NULL,host_id INTEGER NOT NULL,status TEXT DEFAULT 'PENDING',action_time TEXT,notes TEXT,FOREIGN KEY(visit_id) REFERENCES visits(id),FOREIGN KEY(host_id) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS audit_logs(id INTEGER PRIMARY KEY AUTOINCREMENT,actor_id INTEGER,action TEXT,entity TEXT,entity_id INTEGER,details TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS pass_state_history(id INTEGER PRIMARY KEY AUTOINCREMENT,visit_id INTEGER NOT NULL,from_status TEXT,to_status TEXT NOT NULL,actor_id INTEGER,actor_type TEXT NOT NULL,notes TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(visit_id) REFERENCES visits(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS departments(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL UNIQUE,code TEXT UNIQUE,description TEXT,active INTEGER DEFAULT 1,color TEXT DEFAULT '#3b82f6');
CREATE TABLE IF NOT EXISTS purposes(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL UNIQUE,description TEXT,active INTEGER DEFAULT 1,color TEXT DEFAULT '#3b82f6');
CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,type TEXT NOT NULL,title TEXT NOT NULL,message TEXT NOT NULL,read INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP,link_id INTEGER);
CREATE TABLE IF NOT EXISTS system_settings(key TEXT PRIMARY KEY,value TEXT);
`;
db.exec(schema);

// Migration Columns Addition for existing databases
try { db.exec("ALTER TABLE users ADD COLUMN email TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN phone TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN last_login TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE visits ADD COLUMN created_at TEXT DEFAULT CURRENT_TIMESTAMP"); } catch(e) {}
try { db.exec("ALTER TABLE departments ADD COLUMN color TEXT DEFAULT '#3b82f6'"); } catch(e) {}
try { db.exec("ALTER TABLE purposes ADD COLUMN color TEXT DEFAULT '#3b82f6'"); } catch(e) {}
try { db.exec("ALTER TABLE visits ADD COLUMN expected_checkin TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE visits ADD COLUMN expected_checkout TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN active INTEGER DEFAULT 1"); } catch(e) {}
try { db.exec("UPDATE users SET active=1 WHERE active IS NULL"); } catch(e) {}
try { db.exec("ALTER TABLE visitors ADD COLUMN blocked INTEGER DEFAULT 0"); } catch(e) {}
try { db.exec("UPDATE visitors SET blocked=0 WHERE blocked IS NULL"); } catch(e) {}

// Pre-Approval & State Machine Columns
try { db.exec("ALTER TABLE visits ADD COLUMN initiator_type TEXT DEFAULT 'SELF_REGISTERED'"); } catch(e) {}
try { db.exec("ALTER TABLE visits ADD COLUMN expected_arrival_time TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE visits ADD COLUMN proposed_arrival_time TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE visits ADD COLUMN rejection_reason TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE visits ADD COLUMN created_by INTEGER"); } catch(e) {}
try { db.exec("ALTER TABLE visits ADD COLUMN approved_by INTEGER"); } catch(e) {}
try { db.exec("ALTER TABLE visits ADD COLUMN pass_token TEXT"); } catch(e) {}

// Normalize legacy statuses
try { db.exec("UPDATE visits SET status='PENDING_HOST_REVIEW' WHERE status='PENDING_APPROVAL' OR status='PENDING'"); } catch(e) {}
try { db.exec("UPDATE visits SET status='CHECKED_IN' WHERE status='INSIDE'"); } catch(e) {}
try { db.exec("UPDATE visits SET status='CHECKED_OUT' WHERE status='CLOSED'"); } catch(e) {}

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
    from: getSetting('smtp_from') || process.env.SMTP_FROM || `"Swagatham VMS" <${getSetting('smtp_user') || process.env.SMTP_USER || 'notifications@opsvision.com'}>`
  };
}

async function sendEmail({ to, subject, html, text }) {
  if (!to || !to.includes('@')) {
    console.log(`[VAMS EMAIL SKIPPED] No valid email provided: "${to}"`);
    return { success: false, reason: 'Invalid or missing recipient email' };
  }
  const config = getSmtpConfig();
  if (!config.user || !config.pass) {
    console.log(`[VAMS EMAIL SIMULATION]\nRecipient: ${to}\nSubject: ${subject}\nSnippet: ${(text || html || '').slice(0, 120)}...`);
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

// Pass Audit / State History Logger
function logPassStateChange(visitId, fromStatus, toStatus, actorId, actorType, notes = '') {
  try {
    db.prepare('INSERT INTO pass_state_history(visit_id,from_status,to_status,actor_id,actor_type,notes) VALUES(?,?,?,?,?,?)')
      .run(visitId, fromStatus || '', toStatus, actorId || null, actorType || 'SYSTEM', notes || '');
  } catch (e) {
    console.error('[PASS STATE HISTORY ERROR]', e.message);
  }
}

// Seed Users for All Roles
const uCount = db.prepare('SELECT COUNT(*) c FROM users').get().c;
if (!uCount) {
  const add = db.prepare('INSERT INTO users(username,password,name,role,department,email) VALUES(?,?,?,?,?,?)');
  add.run('superadmin', bcrypt.hashSync('super123', 10), 'Super Administrator', 'SUPER_ADMIN', 'Executive', 'superadmin@opsvision.com');
  add.run('admin', bcrypt.hashSync('admin123', 10), 'System Administrator', 'ADMIN', 'Administration', 'admin@opsvision.com');
  add.run('ceo', bcrypt.hashSync('ceo123', 10), 'Chief Executive Officer', 'CEO', 'Executive', 'ceo@opsvision.com');
  add.run('guard', bcrypt.hashSync('guard123', 10), 'Security Guard', 'GUARD', 'Security', 'guard@opsvision.com');
  add.run('reception', bcrypt.hashSync('reception123', 10), 'Reception Desk', 'RECEPTION', 'Reception', 'reception@opsvision.com');
  add.run('employee', bcrypt.hashSync('employee123', 10), 'Demo Host', 'HOST', 'Operations', 'host.demo@opsvision.com');
}

// Ensure CEO and SUPER_ADMIN exist even if users table already had initial seeds
const superAdminCheck = db.prepare("SELECT id FROM users WHERE username='superadmin'").get();
if (!superAdminCheck) {
  db.prepare('INSERT INTO users(username,password,name,role,department,email,active) VALUES(?,?,?,?,?,?,1)')
    .run('superadmin', bcrypt.hashSync('super123', 10), 'Super Administrator', 'SUPER_ADMIN', 'Executive', 'superadmin@opsvision.com');
}
const ceoCheck = db.prepare("SELECT id FROM users WHERE username='ceo'").get();
if (!ceoCheck) {
  db.prepare('INSERT INTO users(username,password,name,role,department,email,active) VALUES(?,?,?,?,?,?,1)')
    .run('ceo', bcrypt.hashSync('ceo123', 10), 'Chief Executive Officer', 'CEO', 'Executive', 'ceo@opsvision.com');
}

// Seed default "Person to Meet (Host)" master data if not present
const hCount = db.prepare("SELECT COUNT(*) c FROM users WHERE role='HOST' OR role='EMPLOYEE'").get().c;
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

// Role Guard supporting inherited permissions (SUPER_ADMIN can access all ADMIN routes)
function roles(...rs) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: 'Unauthorized' });
    if (req.user.role === 'SUPER_ADMIN') return next();
    if (rs.includes(req.user.role)) return next();
    return res.status(403).json({ message: 'Forbidden: Access denied for your role' });
  };
}

function audit(actor, action, entity, id, details = '') {
  db.prepare('INSERT INTO audit_logs(actor_id,action,entity,entity_id,details) VALUES(?,?,?,?,?)').run(actor, action, entity, id, details);
}

// Scoped Dashboard Function
function dashboard(user = null) {
  const today = new Date().toISOString().slice(0, 10);
  let userClause = '';
  const paramsToday = [today];
  const paramsGlobal = [];

  // Scoped to specific Host if role is HOST, EMPLOYEE, or CEO
  if (user && (user.role === 'HOST' || user.role === 'EMPLOYEE' || user.role === 'CEO')) {
    userClause = ' AND v.host_id=?';
    paramsToday.push(user.id);
    paramsGlobal.push(user.id);
  }

  // Pending approvals counter is scoped to user's assigned host ID unless ADMIN/SUPER_ADMIN
  let pendingUserClause = '';
  const paramsPending = [];
  if (user && user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
    pendingUserClause = ' AND v.host_id=?';
    paramsPending.push(user.id);
  }

  const visitsToday = db.prepare(`SELECT COUNT(*) c FROM visits x JOIN visitors v ON v.id=x.visitor_id WHERE substr(x.created_at,1,10)=?${userClause}`).get(...paramsToday).c;
  const currentVisitors = db.prepare(`SELECT COUNT(*) c FROM visits x JOIN visitors v ON v.id=x.visitor_id WHERE (x.status='INSIDE' OR x.status='CHECKED_IN')${userClause}`).get(...paramsGlobal).c;
  const rejected = db.prepare(`SELECT COUNT(*) c FROM visits x JOIN visitors v ON v.id=x.visitor_id WHERE x.status='REJECTED'${userClause}`).get(...paramsGlobal).c;
  const pendingApprovals = db.prepare(`SELECT COUNT(*) c FROM visits x JOIN visitors v ON v.id=x.visitor_id WHERE (x.status='PENDING_HOST_REVIEW' OR x.status='PENDING_APPROVAL' OR x.status='PENDING_VISITOR_CONFIRMATION')${pendingUserClause}`).get(...paramsPending).c;
  const approved = db.prepare(`SELECT COUNT(*) c FROM visits x JOIN visitors v ON v.id=x.visitor_id WHERE x.status='APPROVED'${userClause}`).get(...paramsGlobal).c;
  const exitedToday = db.prepare(`SELECT COUNT(*) c FROM visits x JOIN visitors v ON v.id=x.visitor_id WHERE (x.status='CLOSED' OR x.status='CHECKED_OUT') AND substr(x.exit_time,1,10)=?${userClause}`).get(...paramsToday).c;

  return {
    visitorsToday: visitsToday,
    currentVisitors,
    rejected,
    pendingApprovals,
    waiting: pendingApprovals,
    approved,
    exitedToday
  };
}

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'OpsVision VAMS' }));

// Public Host Registration Endpoint (Self Registration by Host)
app.post('/api/auth/register-host', (req, res) => {
  const { name, email, password, department, phone } = req.body;
  if (!name || !email || !password) return res.status(400).json({ message: 'Name, email and password are required' });
  
  const cleanEmail = email.trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE email=? OR username=?').get(cleanEmail, cleanEmail);
  if (existing) return res.status(400).json({ message: 'A host account with this email already exists' });

  const username = cleanEmail.split('@')[0] + '_' + Math.floor(100 + Math.random() * 900);
  const passHash = bcrypt.hashSync(password, 10);

  const r = db.prepare('INSERT INTO users(username,password,name,role,department,email,phone,active) VALUES(?,?,?,?,?,?,?,1)')
    .run(username, passHash, name, 'HOST', department || 'General', cleanEmail, phone || '');

  const newUserId = r.lastInsertRowid;
  audit(newUserId, 'REGISTER_HOST', 'USER', newUserId, `New host registered: ${name}`);

  const token = jwt.sign({ id: newUserId, username, name, role: 'HOST', department: department || 'General', email: cleanEmail }, secret, { expiresIn: '8h' });
  res.status(201).json({
    message: 'Host account registered successfully!',
    token,
    user: { id: newUserId, username, name, role: 'HOST', department: department || 'General', email: cleanEmail }
  });
});

// Unique Username Generator Helper
function generateUniqueUsername(desiredUsername, email, excludeUserId = null) {
  let base = '';
  if (desiredUsername && desiredUsername.trim()) {
    base = desiredUsername.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
  } else if (email && email.trim()) {
    base = email.trim().toLowerCase().split('@')[0].replace(/[^a-z0-9_.-]/g, '');
  }
  if (!base) base = 'user';

  let sql = 'SELECT id FROM users WHERE LOWER(username)=?';
  const params = [base];
  if (excludeUserId) {
    sql += ' AND id!=?';
    params.push(excludeUserId);
  }
  const existing = db.prepare(sql).get(...params);
  if (!existing) return base;

  let counter = 1;
  while (counter < 1000) {
    const candidate = `${base}${counter}`;
    let checkSql = 'SELECT id FROM users WHERE LOWER(username)=?';
    const checkParams = [candidate];
    if (excludeUserId) {
      checkSql += ' AND id!=?';
      checkParams.push(excludeUserId);
    }
    const check = db.prepare(checkSql).get(...checkParams);
    if (!check) return candidate;
    counter++;
  }
  return `${base}_${Date.now()}`;
}

app.post('/api/auth/login', (req, res) => {
  const input = req.body.username ? req.body.username.trim().toLowerCase() : '';
  if (!input || !req.body.password) return res.status(401).json({ message: 'Username and password are required' });

  const u = db.prepare('SELECT * FROM users WHERE LOWER(username)=? OR LOWER(email)=?').get(input, input);
  if (!u || !bcrypt.compareSync(req.body.password, u.password)) return res.status(401).json({ message: 'Invalid credentials' });
  if (u.active === 0) return res.status(403).json({ message: 'Account disabled. Contact system administrator.' });

  db.prepare('UPDATE users SET last_login=CURRENT_TIMESTAMP WHERE id=?').run(u.id);

  const token = jwt.sign({ id: u.id, username: u.username, name: u.name, role: u.role, department: u.department, email: u.email }, secret, { expiresIn: '8h' });
  res.json({ token, user: { id: u.id, username: u.username, name: u.name, role: u.role, department: u.department, email: u.email } });
});

// Notifications API (Scoped to User)
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
    subject: 'Swagatham VMS - SMTP Test Email',
    html: `<div style="font-family: sans-serif; padding: 20px; background-color: #f8fafc; border-radius: 8px;">
      <h2 style="color: #1e3a8a;">Swagatham VMS - SMTP Verification</h2>
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

// Public Endpoint for Visitor Registration Dropdown (Hosts list)
app.get('/api/public/hosts', (req, res) => {
  res.json(db.prepare("SELECT id,name,department,email FROM users WHERE (role='HOST' OR role='EMPLOYEE' OR role='CEO' OR role='ADMIN' OR role='SUPER_ADMIN') AND active=1 ORDER BY name").all());
});
app.get('/api/public/departments', (req, res) => {
  res.json(db.prepare("SELECT id,name,code FROM departments WHERE active=1 ORDER BY name").all());
});
app.get('/api/public/purposes', (req, res) => {
  res.json(db.prepare("SELECT id,name FROM purposes WHERE active=1 ORDER BY name").all());
});

// User Management (Admin / Super Admin / Reception)
app.get('/api/users', auth, roles('ADMIN', 'SUPER_ADMIN', 'RECEPTION'), (req, res) => res.json(db.prepare('SELECT id,name,username,role,department,email,phone,active FROM users ORDER BY name').all()));
app.get('/api/hosts', auth, roles('GUARD', 'RECEPTION', 'ADMIN', 'SUPER_ADMIN', 'CEO', 'HOST', 'EMPLOYEE'), (req, res) => res.json(db.prepare("SELECT id,name,username,role,department,email,phone FROM users WHERE (role='HOST' OR role='EMPLOYEE' OR role='CEO' OR role='ADMIN' OR role='SUPER_ADMIN') AND active=1 ORDER BY name").all()));
app.get('/api/master/departments', auth, (req, res) => res.json(db.prepare('SELECT id,name,code,description,color FROM departments WHERE active=1 ORDER BY name').all()));
app.get('/api/master/purposes', auth, (req, res) => res.json(db.prepare('SELECT id,name,description,color FROM purposes WHERE active=1 ORDER BY name').all()));
app.get('/api/master/departments/all', auth, roles('ADMIN', 'SUPER_ADMIN'), (req, res) => res.json(db.prepare('SELECT id,name,code,description,color,active FROM departments ORDER BY name').all()));
app.get('/api/master/purposes/all', auth, roles('ADMIN', 'SUPER_ADMIN'), (req, res) => res.json(db.prepare('SELECT id,name,description,color,active FROM purposes ORDER BY name').all()));

app.post('/api/master/departments', auth, roles('ADMIN', 'SUPER_ADMIN'), (req, res) => {
  const { name, code, desc, color } = req.body;
  if (!name) return res.status(400).json({ message: 'Name is required' });
  const r = db.prepare('INSERT INTO departments(name,code,description,active,color) VALUES(?,?,?,1,?)').run(name, code || null, desc || null, color || '#3b82f6');
  audit(req.user.id, 'CREATE', 'DEPARTMENT', r.lastInsertRowid, name);
  res.status(201).json({ message: 'Department added' });
});

app.post('/api/master/purposes', auth, roles('ADMIN', 'SUPER_ADMIN'), (req, res) => {
  const { name, desc, color } = req.body;
  if (!name) return res.status(400).json({ message: 'Name is required' });
  const r = db.prepare('INSERT INTO purposes(name,description,active,color) VALUES(?,?,1,?)').run(name, desc || null, color || '#3b82f6');
  audit(req.user.id, 'CREATE', 'PURPOSE', r.lastInsertRowid, name);
  res.status(201).json({ message: 'Purpose added' });
});

app.put('/api/master/departments/:id', auth, roles('ADMIN', 'SUPER_ADMIN'), (req, res) => {
  const d = db.prepare('SELECT id,color FROM departments WHERE id=?').get(req.params.id);
  if (!d) return res.status(404).json({ message: 'Department not found' });
  const color = req.body.color || d.color || '#3b82f6';
  db.prepare('UPDATE departments SET name=?,code=?,description=?,active=?,color=? WHERE id=?').run(req.body.name, req.body.code || null, req.body.description || null, req.body.active !== undefined ? (req.body.active ? 1 : 0) : 1, color, req.params.id);
  audit(req.user.id, 'UPDATE', 'DEPARTMENT', req.params.id, req.body.name);
  res.json({ message: 'Department updated' });
});

app.put('/api/master/purposes/:id', auth, roles('ADMIN', 'SUPER_ADMIN'), (req, res) => {
  const d = db.prepare('SELECT id,color FROM purposes WHERE id=?').get(req.params.id);
  if (!d) return res.status(404).json({ message: 'Purpose not found' });
  const color = req.body.color || d.color || '#3b82f6';
  db.prepare('UPDATE purposes SET name=?,description=?,active=?,color=? WHERE id=?').run(req.body.name, req.body.description || null, req.body.active !== undefined ? (req.body.active ? 1 : 0) : 1, color, req.params.id);
  audit(req.user.id, 'UPDATE', 'PURPOSE', req.params.id, req.body.name);
  res.json({ message: 'Purpose updated' });
});

app.delete('/api/master/departments/:id', auth, roles('ADMIN', 'SUPER_ADMIN'), (req, res) => {
  const d = db.prepare('SELECT id, active, name FROM departments WHERE id=?').get(req.params.id);
  if (!d) return res.status(404).json({ message: 'Department not found' });
  if (d.active === 0) {
    try {
      db.prepare('DELETE FROM departments WHERE id=?').run(req.params.id);
      audit(req.user.id, 'PERMANENT_DELETE', 'DEPARTMENT', req.params.id, d.name);
      return res.json({ message: 'Department permanently deleted' });
    } catch (err) {
      return res.status(400).json({ message: 'Cannot delete department: ' + err.message });
    }
  } else {
    db.prepare('UPDATE departments SET active=0 WHERE id=?').run(req.params.id);
    audit(req.user.id, 'DELETE', 'DEPARTMENT', req.params.id, d.name);
    return res.json({ message: 'Department deactivated' });
  }
});

app.delete('/api/master/purposes/:id', auth, roles('ADMIN', 'SUPER_ADMIN'), (req, res) => {
  const p = db.prepare('SELECT id, active, name FROM purposes WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ message: 'Purpose not found' });
  if (p.active === 0) {
    try {
      db.prepare('DELETE FROM purposes WHERE id=?').run(req.params.id);
      audit(req.user.id, 'PERMANENT_DELETE', 'PURPOSE', req.params.id, p.name);
      return res.json({ message: 'Purpose permanently deleted' });
    } catch (err) {
      return res.status(400).json({ message: 'Cannot delete purpose: ' + err.message });
    }
  } else {
    db.prepare('UPDATE purposes SET active=0 WHERE id=?').run(req.params.id);
    audit(req.user.id, 'DELETE', 'PURPOSE', req.params.id, p.name);
    return res.json({ message: 'Purpose deactivated' });
  }
});

// User Management Endpoints (Super Admin & Admin scope for all roles)
app.get('/api/master/users/all', auth, roles('ADMIN', 'SUPER_ADMIN'), (req, res) => {
  res.json(db.prepare('SELECT id,name,username,role,department,email,phone,active FROM users ORDER BY name').all());
});

app.post('/api/master/users', auth, roles('ADMIN', 'SUPER_ADMIN'), (req, res) => {
  const { name, role, department, email, username, password, phone, active } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ message: 'User Full Name is required' });

  const validRoles = ['SUPER_ADMIN', 'ADMIN', 'CEO', 'RECEPTION', 'GUARD', 'HOST', 'EMPLOYEE'];
  const userRole = role && validRoles.includes(role) ? role : 'HOST';
  const cleanEmail = email && email.trim() ? email.trim().toLowerCase() : null;

  // Use accepted username if provided and unique; otherwise generate unique candidate
  const userStr = generateUniqueUsername(username, cleanEmail);
  const passStr = password && password.trim() ? password.trim() : (userRole.toLowerCase() + '123');
  const passHash = bcrypt.hashSync(passStr, 10);

  const r = db.prepare('INSERT INTO users(username,password,name,role,department,email,phone,active) VALUES(?,?,?,?,?,?,?,?)')
    .run(userStr, passHash, name.trim(), userRole, department ? department.trim() : null, cleanEmail, phone ? phone.trim() : null, active !== false ? 1 : 0);

  audit(req.user.id, 'CREATE', 'USER', r.lastInsertRowid, `${name} (${userRole})`);

  // Dispatch Welcome Email if recipient email is provided
  if (cleanEmail) {
    sendEmail({
      to: cleanEmail,
      subject: `Welcome to Swagatham VMS - Your Login Credentials`,
      html: `<div style="font-family: sans-serif; padding: 20px; background-color: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;">
        <h2 style="color: #1e3a8a; margin-top: 0;">Welcome to Swagatham VMS</h2>
        <p>Hello <strong>${name.trim()}</strong>,</p>
        <p>Your account has been created with role: <strong style="color: #2563eb;">${userRole}</strong>.</p>
        <div style="background-color: #ffffff; padding: 15px; border-radius: 6px; border: 1px solid #cbd5e1; margin: 15px 0;">
          <p style="margin: 4px 0;"><strong>Username / Email:</strong> <code>${userStr}</code> (or <code>${cleanEmail}</code>)</p>
          <p style="margin: 4px 0;"><strong>Password:</strong> <code>${passStr}</code></p>
          <p style="margin: 4px 0;"><strong>System URL:</strong> <a href="https://vams.spandanatech.in">https://vams.spandanatech.in</a></p>
        </div>
        <p style="color: #64748b; font-size: 13px;">Please log in using your Username or Email address with the password above.</p>
      </div>`
    }).catch(err => console.error('[VAMS EMAIL ERROR]', err));
  }

  res.status(201).json({
    message: `User account created successfully! Username: ${userStr}`,
    username: userStr,
    initialPassword: passStr,
    role: userRole
  });
});

app.put('/api/master/users/:id', auth, roles('ADMIN', 'SUPER_ADMIN'), (req, res) => {
  const d = db.prepare('SELECT id, username, role FROM users WHERE id=?').get(req.params.id);
  if (!d) return res.status(404).json({ message: 'User not found' });

  const { name, role, department, email, username, password, phone, active } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ message: 'User Full Name is required' });

  const validRoles = ['SUPER_ADMIN', 'ADMIN', 'CEO', 'RECEPTION', 'GUARD', 'HOST', 'EMPLOYEE'];
  const userRole = role && validRoles.includes(role) ? role : d.role;
  const cleanEmail = email && email.trim() ? email.trim().toLowerCase() : null;

  // Accept custom username if unique, or generate unique fallback
  const userStr = generateUniqueUsername(username, cleanEmail, d.id);

  if (password && password.trim().length > 0) {
    const passHash = bcrypt.hashSync(password.trim(), 10);
    db.prepare('UPDATE users SET name=?,username=?,role=?,department=?,email=?,phone=?,password=?,active=? WHERE id=?')
      .run(name.trim(), userStr, userRole, department ? department.trim() : null, cleanEmail, phone ? phone.trim() : null, passHash, active !== undefined ? (active ? 1 : 0) : 1, req.params.id);
  } else {
    db.prepare('UPDATE users SET name=?,username=?,role=?,department=?,email=?,phone=?,active=? WHERE id=?')
      .run(name.trim(), userStr, userRole, department ? department.trim() : null, cleanEmail, phone ? phone.trim() : null, active !== undefined ? (active ? 1 : 0) : 1, req.params.id);
  }

  audit(req.user.id, 'UPDATE', 'USER', req.params.id, `${name} (${userRole})`);
  res.json({ message: 'User account updated successfully', username: userStr });
});

app.delete('/api/master/users/:id', auth, roles('ADMIN', 'SUPER_ADMIN'), (req, res) => {
  const u = db.prepare('SELECT id, active, name FROM users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ message: 'User not found' });
  if (u.active === 0) {
    try {
      db.prepare('DELETE FROM notifications WHERE user_id=?').run(req.params.id);
      db.prepare('UPDATE visitors SET host_id=NULL WHERE host_id=?').run(req.params.id);
      db.prepare('UPDATE visits SET entry_guard_id=NULL WHERE entry_guard_id=?').run(req.params.id);
      db.prepare('UPDATE visits SET exit_guard_id=NULL WHERE exit_guard_id=?').run(req.params.id);
      db.prepare('DELETE FROM approvals WHERE host_id=?').run(req.params.id);
      db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);
      audit(req.user.id, 'PERMANENT_DELETE', 'USER', req.params.id, u.name);
      return res.json({ message: 'User account permanently deleted' });
    } catch (err) {
      return res.status(400).json({ message: 'Cannot delete user: ' + err.message });
    }
  } else {
    db.prepare('UPDATE users SET active=0 WHERE id=?').run(req.params.id);
    audit(req.user.id, 'DELETE', 'USER', req.params.id, u.name);
    return res.json({ message: 'User account deactivated' });
  }
});

// Backwards compatibility aliases for host master endpoints
app.get('/api/master/hosts', auth, roles('ADMIN', 'SUPER_ADMIN', 'RECEPTION'), (req, res) => res.json(db.prepare("SELECT id,name,username,role,department,email,phone,active FROM users WHERE active=1 ORDER BY name").all()));
app.get('/api/master/hosts/all', auth, roles('ADMIN', 'SUPER_ADMIN'), (req, res) => res.json(db.prepare("SELECT id,name,username,role,department,email,phone,active FROM users ORDER BY name").all()));
app.post('/api/master/hosts', auth, roles('ADMIN', 'SUPER_ADMIN'), (req, res) => {
  req.url = '/api/master/users';
  app.handle(req, res);
});
app.put('/api/master/hosts/:id', auth, roles('ADMIN', 'SUPER_ADMIN'), (req, res) => {
  req.url = `/api/master/users/${req.params.id}`;
  app.handle(req, res);
});
app.delete('/api/master/hosts/:id', auth, roles('ADMIN', 'SUPER_ADMIN'), (req, res) => {
  req.url = `/api/master/users/${req.params.id}`;
  app.handle(req, res);
});

app.get('/api/dashboard', auth, (req, res) => res.json(dashboard(req.user)));

// Scoped Visitor Listing
app.get('/api/visitors', auth, (req, res) => {
  let sql = `SELECT v.*,x.id visit_id,x.visitor_code,x.entry_time,x.exit_time,x.status,x.valid_until,x.expected_checkin,x.expected_checkout,x.initiator_type,x.expected_arrival_time,x.proposed_arrival_time,x.rejection_reason,x.pass_token,u.name host_name,u.email host_email FROM visitors v JOIN visits x ON x.visitor_id=v.id LEFT JOIN users u ON u.id=v.host_id WHERE 1=1`;
  const p = [];

  // Scoping for standard HOST users
  if (req.user.role === 'HOST' || req.user.role === 'EMPLOYEE') {
    sql += ' AND (v.host_id=? OR x.created_by=?)';
    p.push(req.user.id, req.user.id);
  }

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

// Standard Visitor Registration Endpoint (Awaiting Host Review)
app.post('/api/visitors/register', auth, async (req, res) => {
  const { name, mobile, email, company, purpose, host_id, department, vehicle, photo, expected_checkin, expected_checkout } = req.body;
  if (!name || !mobile || !host_id) return res.status(400).json({ message: 'Name, mobile and host are required' });
  if (!/^\d{10}$/.test(String(mobile).trim())) return res.status(400).json({ message: 'Mobile number must be exactly 10 digits' });

  const cleanMobile = String(mobile).trim();
  const code = 'VAMS-' + Date.now().toString(36).toUpperCase();
  const passToken = 'TOKEN-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase();
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const validUntil = expected_checkout || new Date(Date.now() + 8 * 3600000).toISOString();

  // If created by host for themselves, auto approve; otherwise default to PENDING_HOST_REVIEW (Awaiting Approval)
  const isHostSelf = (req.user.role === 'HOST' || req.user.role === 'EMPLOYEE' || req.user.role === 'CEO') && req.user.id === Number(host_id);
  const status = isHostSelf ? 'APPROVED' : 'PENDING_HOST_REVIEW';

  const tx = db.transaction(() => {
    const r = db.prepare('INSERT INTO visitors(name,mobile,email,company,purpose,host_id,department,vehicle,photo,consent,otp) VALUES(?,?,?,?,?,?,?,?,?,1,?)')
      .run(name, cleanMobile, email || '', company || '', purpose || 'Visit', host_id, department || '', vehicle || '', photo || null, otp);
    const vr = db.prepare('INSERT INTO visits(visitor_id,visitor_code,status,valid_until,expected_checkin,expected_checkout,expected_arrival_time,created_by,approved_by,pass_token) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(r.lastInsertRowid, code, status, validUntil, expected_checkin || null, expected_checkout || null, expected_checkin || null, req.user.id, status === 'APPROVED' ? req.user.id : null, passToken);
    db.prepare('INSERT INTO approvals(visit_id,host_id,status) VALUES(?,?,?)').run(vr.lastInsertRowid, host_id, status === 'APPROVED' ? 'APPROVED' : 'PENDING');
    logPassStateChange(vr.lastInsertRowid, null, status, req.user.id, req.user.role, 'Registered (Awaiting Host Approval)');
    audit(req.user.id, 'REGISTER_VISITOR', 'VISIT', vr.lastInsertRowid, code);
    return { id: r.lastInsertRowid, visitId: vr.lastInsertRowid, visitorCode: code, otp, passToken, status };
  });

  const out = tx();

  // Dispatch In-App Notification to Host
  createNotification({
    user_id: Number(host_id),
    type: 'VISITOR_REGISTERED',
    title: '🔔 New Visitor Registered (Awaiting Approval)',
    message: `${name} (${company || 'Individual'}) registered to meet you. Please review and approve.`,
    link_id: out.visitId
  });

  // Host Email Notification
  const hostUser = db.prepare('SELECT * FROM users WHERE id=?').get(host_id);
  if (hostUser && hostUser.email) {
    sendEmail({
      to: hostUser.email,
      subject: `[Swagatham VMS] New Visitor Request: ${name} is visiting you`,
      html: `<div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f1f5f9; color: #1e293b;">
        <div style="max-width: 550px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 24px;">
          <h2 style="color: #2563eb; margin-top: 0;">New Visitor Approval Request</h2>
          <p>Hello <strong>${hostUser.name}</strong>,</p>
          <p>A visitor has been registered to meet you at reception/gate:</p>
          <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
            <tr><td style="padding: 6px; font-weight: bold;">Visitor Name:</td><td style="padding: 6px;">${name}</td></tr>
            <tr><td style="padding: 6px; font-weight: bold;">Company:</td><td style="padding: 6px;">${company || 'N/A'}</td></tr>
            <tr><td style="padding: 6px; font-weight: bold;">Purpose:</td><td style="padding: 6px;">${purpose || 'Visit'}</td></tr>
          </table>
          <p>Please log in to your Swagatham VMS Dashboard to review and single-tap approve or reject this visitor pass.</p>
        </div>
      </div>`
    }).catch(err => console.error('[VAMS EMAIL ERROR]', err));
  }

  res.status(201).json({ message: 'Visitor registered successfully! Status: Awaiting Host Approval.', ...out });
});

// Visitor Photo Upload Endpoint
app.post('/api/visitors/:id/photo', auth, (req, res) => {
  const { photo } = req.body;
  if (!photo) return res.status(400).json({ message: 'Photo data required' });
  db.prepare('UPDATE visitors SET photo=? WHERE id=?').run(photo, req.params.id);
  res.json({ message: 'Photo saved successfully' });
});

// Update Visitor Details Endpoint
app.put('/api/visitors/:id', auth, roles('ADMIN', 'SUPER_ADMIN', 'RECEPTION', 'GUARD'), (req, res) => {
  const { name, mobile, email, company, purpose, host_id, department, vehicle, expected_checkin, expected_checkout } = req.body;
  const v = db.prepare('SELECT * FROM visitors WHERE id=?').get(req.params.id);
  if (!v) return res.status(404).json({ message: 'Visitor record not found' });

  db.prepare('UPDATE visitors SET name=?, mobile=?, email=?, company=?, purpose=?, host_id=?, department=?, vehicle=? WHERE id=?')
    .run(name, mobile, email || '', company || '', purpose, host_id, department || '', vehicle || '', req.params.id);

  if (expected_checkin || expected_checkout) {
    db.prepare('UPDATE visits SET expected_checkin=?, expected_checkout=?, expected_arrival_time=? WHERE visitor_id=?')
      .run(expected_checkin || null, expected_checkout || null, expected_checkin || null, req.params.id);
  }

  audit(req.user.id, 'UPDATE_VISITOR', 'VISITOR', req.params.id, name);
  res.json({ message: 'Visitor record updated successfully' });
});

// Delete Visitor Endpoint
app.delete('/api/visitors/:id', auth, roles('ADMIN', 'SUPER_ADMIN', 'RECEPTION'), (req, res) => {
  const v = db.prepare('SELECT * FROM visitors WHERE id=?').get(req.params.id);
  if (!v) return res.status(404).json({ message: 'Visitor record not found' });

  db.prepare('DELETE FROM visits WHERE visitor_id=?').run(req.params.id);
  db.prepare('DELETE FROM visitors WHERE id=?').run(req.params.id);

  audit(req.user.id, 'DELETE_VISITOR', 'VISITOR', req.params.id, v.name);
  res.json({ message: 'Visitor deleted successfully' });
});

// Flow A: Public Self-Registration Endpoint (Visitor Initiated)
app.post('/api/public/register-visit', async (req, res) => {
  const { name, mobile, email, company, purpose, host_id, department, vehicle, expected_arrival_time } = req.body;
  if (!name || !mobile || !purpose || !host_id || !expected_arrival_time) {
    return res.status(400).json({ message: 'Name, mobile, purpose, host and expected arrival time are required' });
  }
  if (!/^\d{10}$/.test(String(mobile).trim())) {
    return res.status(400).json({ message: 'Mobile number must be exactly 10 digits' });
  }

  const cleanMobile = String(mobile).trim();
  const code = 'VAMS-' + Date.now().toString(36).toUpperCase();
  const passToken = 'TOKEN-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase();
  const validUntil = new Date(new Date(expected_arrival_time).getTime() + 8 * 3600000).toISOString();

  const tx = db.transaction(() => {
    const r = db.prepare('INSERT INTO visitors(name,mobile,email,company,purpose,host_id,department,vehicle,consent) VALUES(?,?,?,?,?,?,?,?,1)').run(name, cleanMobile, email || '', company || '', purpose, host_id, department || '', vehicle || '');
    const vr = db.prepare('INSERT INTO visits(visitor_id,visitor_code,status,valid_until,expected_checkin,expected_checkout,initiator_type,expected_arrival_time,pass_token) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(r.lastInsertRowid, code, 'PENDING_HOST_REVIEW', validUntil, expected_arrival_time, validUntil, 'SELF_REGISTERED', expected_arrival_time, passToken);
    db.prepare('INSERT INTO approvals(visit_id,host_id,status) VALUES(?,?,?)').run(vr.lastInsertRowid, host_id, 'PENDING');
    logPassStateChange(vr.lastInsertRowid, null, 'PENDING_HOST_REVIEW', null, 'VISITOR', 'Self-registered by visitor');
    return { id: r.lastInsertRowid, visitId: vr.lastInsertRowid, visitorCode: code, passToken };
  });

  const out = tx();
  const hostUser = db.prepare('SELECT * FROM users WHERE id=?').get(host_id);

  // In-App Notification to Host
  createNotification({
    user_id: host_id,
    type: 'VISITOR_REGISTERED',
    title: '🔔 New Visitor Self-Registered',
    message: `${name} (${company || 'Individual'}) requested a visit for ${new Date(expected_arrival_time).toLocaleString()}.`,
    link_id: out.visitId
  });

  // Host Email Notification
  if (hostUser && hostUser.email) {
    sendEmail({
      to: hostUser.email,
      subject: `[Swagatham VMS] Pre-Approval Request: ${name} is visiting you`,
      html: `<div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f1f5f9; color: #1e293b;">
        <div style="max-width: 550px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 24px;">
          <h2 style="color: #2563eb; margin-top: 0;">Visitor Pre-Approval Request</h2>
          <p>Hello <strong>${hostUser.name}</strong>,</p>
          <p>A visitor has self-registered to meet you:</p>
          <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
            <tr><td style="padding: 6px; font-weight: bold;">Visitor Name:</td><td style="padding: 6px;">${name}</td></tr>
            <tr><td style="padding: 6px; font-weight: bold;">Company:</td><td style="padding: 6px;">${company || 'N/A'}</td></tr>
            <tr><td style="padding: 6px; font-weight: bold;">Purpose:</td><td style="padding: 6px;">${purpose}</td></tr>
            <tr><td style="padding: 6px; font-weight: bold;">Expected Arrival:</td><td style="padding: 6px; color: #2563eb; font-weight: bold;">${new Date(expected_arrival_time).toLocaleString()}</td></tr>
          </table>
          <p>Please log in to your Swagatham VMS Host Dashboard to Single-Tap Approve, Propose New Time, or Reject this visit.</p>
        </div>
      </div>`
    });
  }

  res.status(201).json({ message: 'Registration submitted. Awaiting host review.', ...out });
});

// Flow B: Staff Guest Pass Pre-Creation Endpoint (Staff/Host Initiated)
app.post('/api/passes/pre-create', auth, roles('ADMIN', 'SUPER_ADMIN', 'RECEPTION', 'HOST', 'EMPLOYEE', 'CEO'), async (req, res) => {
  const { name, mobile, email, company, purpose, host_id, department, vehicle, expected_arrival_time } = req.body;
  if (!name || !mobile || !purpose || !host_id || !expected_arrival_time) {
    return res.status(400).json({ message: 'Name, mobile, purpose, host and expected arrival time are required' });
  }

  const cleanMobile = String(mobile).trim();
  const code = 'VAMS-' + Date.now().toString(36).toUpperCase();
  const passToken = 'TOKEN-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase();
  const validUntil = new Date(new Date(expected_arrival_time).getTime() + 8 * 3600000).toISOString();

  // If host themselves created the pass, it's auto approved!
  const isCreatedBySelf = (req.user.role === 'HOST' || req.user.role === 'EMPLOYEE' || req.user.role === 'CEO') && req.user.id === Number(host_id);
  const initialStatus = isCreatedBySelf ? 'APPROVED' : 'PENDING_HOST_REVIEW';

  const tx = db.transaction(() => {
    const r = db.prepare('INSERT INTO visitors(name,mobile,email,company,purpose,host_id,department,vehicle,consent) VALUES(?,?,?,?,?,?,?,?,1)').run(name, cleanMobile, email || '', company || '', purpose, host_id, department || '', vehicle || '');
    const vr = db.prepare('INSERT INTO visits(visitor_id,visitor_code,status,valid_until,expected_checkin,expected_checkout,initiator_type,expected_arrival_time,created_by,approved_by,pass_token) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(r.lastInsertRowid, code, initialStatus, validUntil, expected_arrival_time, validUntil, 'STAFF_CREATED', expected_arrival_time, req.user.id, isCreatedBySelf ? req.user.id : null, passToken);
    db.prepare('INSERT INTO approvals(visit_id,host_id,status) VALUES(?,?,?)').run(vr.lastInsertRowid, host_id, isCreatedBySelf ? 'APPROVED' : 'PENDING');
    logPassStateChange(vr.lastInsertRowid, null, initialStatus, req.user.id, req.user.role, isCreatedBySelf ? 'Host pre-approved guest pass' : `Guest pass created by ${req.user.name} (${req.user.role})`);
    audit(req.user.id, 'PRE_CREATE_PASS', 'VISIT', vr.lastInsertRowid, code);
    return { id: r.lastInsertRowid, visitId: vr.lastInsertRowid, visitorCode: code, passToken, status: initialStatus };
  });

  const out = tx();
  const hostUser = db.prepare('SELECT * FROM users WHERE id=?').get(host_id);

  if (!isCreatedBySelf) {
    // Alert host that staff created a pass on their behalf
    createNotification({
      user_id: host_id,
      type: 'STAFF_PASS_CREATED',
      title: '🎟️ Guest Pass Created on Your Behalf',
      message: `${req.user.name} created a pass for ${name} visiting you at ${new Date(expected_arrival_time).toLocaleString()}.`,
      link_id: out.visitId
    });
  }

  res.status(201).json({ message: isCreatedBySelf ? 'Guest pass pre-approved!' : 'Guest pass created. Awaiting host confirmation.', ...out });
});

// Host Approval / Propose-Time / Reject Endpoint
app.post('/api/visits/:id/host-action', auth, roles('HOST', 'EMPLOYEE', 'ADMIN', 'SUPER_ADMIN', 'RECEPTION', 'CEO'), async (req, res) => {
  const visit = db.prepare('SELECT x.*, v.name visitor_name, v.email visitor_email, v.mobile visitor_mobile, v.host_id, u.name host_name FROM visits x JOIN visitors v ON v.id=x.visitor_id LEFT JOIN users u ON u.id=v.host_id WHERE x.id=?').get(req.params.id);
  if (!visit) return res.status(404).json({ message: 'Visit not found' });

  // Host user scoping check: Only designated host or ADMIN/SUPER_ADMIN can take decision actions
  const isHostSelf = visit.host_id === req.user.id;
  const isAdmin = req.user.role === 'ADMIN' || req.user.role === 'SUPER_ADMIN';
  if (!isHostSelf && !isAdmin) {
    return res.status(403).json({ message: 'Forbidden: You can only approve, reschedule, or reject visits assigned to you as host.' });
  }

  const { action, proposed_time, notes } = req.body;
  if (!['APPROVE', 'PROPOSE_TIME', 'REJECT'].includes(action)) {
    return res.status(400).json({ message: 'Invalid action. Must be APPROVE, PROPOSE_TIME, or REJECT' });
  }

  let newStatus = '';
  if (action === 'APPROVE') {
    newStatus = 'APPROVED';
    db.prepare('UPDATE visits SET status=?, approved_by=? WHERE id=?').run(newStatus, req.user.id, visit.id);
    db.prepare("UPDATE approvals SET status='APPROVED', action_time=CURRENT_TIMESTAMP, notes=? WHERE visit_id=?").run(notes || 'Approved by host', visit.id);
    logPassStateChange(visit.id, visit.status, newStatus, req.user.id, req.user.role, notes || 'Approved');
    audit(req.user.id, 'APPROVE_VISIT', 'VISIT', visit.id);

    // Notify Reception
    createNotification({
      user_id: null,
      type: 'VISIT_APPROVED',
      title: '✅ Visitor Pass Approved',
      message: `${visit.visitor_name} has been approved by host ${visit.host_name}.`,
      link_id: visit.id
    });

    // Notify Visitor via email
    if (visit.visitor_email) {
      sendEmail({
        to: visit.visitor_email,
        subject: `[Swagatham VMS] Your Visitor Pass is Approved! Code: ${visit.visitor_code}`,
        html: `<div style="font-family: Arial, sans-serif; padding: 20px; background-color: #ecfdf5; border-radius: 8px;">
          <h2 style="color: #059669;">Visitor Pass Approved!</h2>
          <p>Dear <strong>${visit.visitor_name}</strong>,</p>
          <p>Your host <strong>${visit.host_name}</strong> has approved your visit.</p>
          <p>Your Visitor Pass Code is: <strong style="font-size: 18px; color: #2563eb;">${visit.visitor_code}</strong></p>
          <p>Expected Arrival: ${new Date(visit.expected_arrival_time || visit.expected_checkin).toLocaleString()}</p>
          <p>Please present this code at reception upon arrival.</p>
        </div>`
      });
    }

    return res.json({ message: 'Visit approved successfully' });
  } else if (action === 'PROPOSE_TIME') {
    if (!proposed_time) return res.status(400).json({ message: 'Proposed time is required' });
    newStatus = 'PENDING_VISITOR_CONFIRMATION';
    db.prepare('UPDATE visits SET status=?, proposed_arrival_time=? WHERE id=?').run(newStatus, proposed_time, visit.id);
    db.prepare("UPDATE approvals SET status='PENDING', action_time=CURRENT_TIMESTAMP, notes=? WHERE visit_id=?").run(`Counter time proposed: ${proposed_time}`, visit.id);
    logPassStateChange(visit.id, visit.status, newStatus, req.user.id, req.user.role, `Proposed counter time: ${proposed_time}`);
    audit(req.user.id, 'PROPOSE_TIME_VISIT', 'VISIT', visit.id, proposed_time);

    // Send email / notification to visitor for counter confirmation
    if (visit.visitor_email) {
      const confirmUrl = `${req.headers.origin || 'http://localhost:5173'}?confirmToken=${visit.pass_token}`;
      sendEmail({
        to: visit.visitor_email,
        subject: `[Swagatham VMS] Host Proposed New Visit Time: ${visit.visitor_name}`,
        html: `<div style="font-family: Arial, sans-serif; padding: 20px; background-color: #fffbeb; border-radius: 8px;">
          <h2 style="color: #d97706;">Reschedule Proposal from Host</h2>
          <p>Dear <strong>${visit.visitor_name}</strong>,</p>
          <p>Your host <strong>${visit.host_name}</strong> proposed a new arrival time for your visit:</p>
          <p style="font-size: 16px; font-weight: bold; color: #b45309;">New Proposed Arrival: ${new Date(proposed_time).toLocaleString()}</p>
          <p>Please confirm if this time works for you:</p>
          <p><a href="${confirmUrl}" style="background-color: #2563eb; color: white; padding: 10px 18px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block;">Review & Confirm Reschedule</a></p>
        </div>`
      });
    }

    return res.json({ message: 'Counter time proposal sent to visitor', proposed_time });
  } else if (action === 'REJECT') {
    if (!notes || !notes.trim()) return res.status(400).json({ message: 'Rejection reason is required' });
    newStatus = 'REJECTED';
    db.prepare('UPDATE visits SET status=?, rejection_reason=?, approved_by=? WHERE id=?').run(newStatus, notes.trim(), req.user.id, visit.id);
    db.prepare("UPDATE approvals SET status='REJECTED', action_time=CURRENT_TIMESTAMP, notes=? WHERE visit_id=?").run(notes.trim(), visit.id);
    logPassStateChange(visit.id, visit.status, newStatus, req.user.id, req.user.role, notes.trim());
    audit(req.user.id, 'REJECT_VISIT', 'VISIT', visit.id, notes.trim());

    // Notify Reception
    createNotification({
      user_id: null,
      type: 'VISIT_REJECTED',
      title: '❌ Visit Request Rejected',
      message: `${visit.visitor_name} was rejected by host ${visit.host_name}. Reason: ${notes}`,
      link_id: visit.id
    });

    return res.json({ message: 'Visit rejected' });
  }
});

// Legacy Approval Compatibility Router
app.get('/api/approvals', auth, roles('HOST', 'EMPLOYEE', 'RECEPTION', 'ADMIN', 'SUPER_ADMIN', 'CEO', 'GUARD'), (req, res) => {
  let mine = '';
  // ADMIN and SUPER_ADMIN view all approvals; all other roles see only visits where they are designated host
  if (req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
    mine = ' AND a.host_id=' + Number(req.user.id);
  }
  res.json(db.prepare(`SELECT a.*,x.visitor_code,x.status visit_status,x.expected_arrival_time,x.proposed_arrival_time,x.rejection_reason,x.initiator_type,v.name visitor_name,v.company,v.purpose,v.mobile,u.name host_name FROM approvals a JOIN visits x ON x.id=a.visit_id JOIN visitors v ON v.id=x.visitor_id JOIN users u ON u.id=a.host_id WHERE 1=1 ${mine} ORDER BY a.id DESC`).all());
});

app.post('/api/approvals/:visitId', auth, roles('HOST', 'EMPLOYEE', 'RECEPTION', 'ADMIN', 'SUPER_ADMIN', 'CEO', 'GUARD'), (req, res) => {
  const visit = db.prepare('SELECT * FROM visits WHERE id=?').get(req.params.visitId);
  if (!visit) return res.status(404).json({ message: 'Visit not found' });
  const approval = db.prepare('SELECT * FROM approvals WHERE visit_id=?').get(visit.id);
  const isHostSelf = approval && approval.host_id === req.user.id;
  const isAdminOrStaff = req.user.role === 'ADMIN' || req.user.role === 'SUPER_ADMIN' || req.user.role === 'RECEPTION' || req.user.role === 'GUARD';
  if (!isHostSelf && !isAdminOrStaff) {
    return res.status(403).json({ message: 'Forbidden: You can only act on visitor passes assigned to you as host.' });
  }
  const status = req.body.action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  const notes = req.body.notes || (status === 'REJECTED' ? 'Rejected by host' : 'Approved');
  db.prepare('UPDATE approvals SET status=?,action_time=CURRENT_TIMESTAMP,notes=? WHERE visit_id=?').run(status, notes, visit.id);
  db.prepare('UPDATE visits SET status=?, approved_by=? WHERE id=?').run(status, req.user.id, visit.id);
  logPassStateChange(visit.id, visit.status, status, req.user.id, req.user.role, notes);
  audit(req.user.id, status, 'VISIT', visit.id);
  res.json({ message: `Visit ${status.toLowerCase()}` });
});

// Visitor Confirmation API for Counter-Proposed Times (Public)
app.get('/api/public/pass-confirm/:passToken', (req, res) => {
  const r = db.prepare(`SELECT x.*, v.name visitor_name, v.company, v.purpose, v.mobile, u.name host_name, u.department host_department FROM visits x JOIN visitors v ON v.id=x.visitor_id LEFT JOIN users u ON u.id=v.host_id WHERE x.pass_token=?`).get(req.params.passToken);
  if (!r) return res.status(404).json({ message: 'Pass token not found or invalid' });
  res.json(r);
});

app.post('/api/public/pass-confirm/:passToken', (req, res) => {
  const visit = db.prepare('SELECT * FROM visits WHERE pass_token=?').get(req.params.passToken);
  if (!visit) return res.status(404).json({ message: 'Pass token not found or invalid' });

  const { action } = req.body; // 'ACCEPT' or 'DECLINE'
  if (action === 'ACCEPT') {
    if (!visit.proposed_arrival_time) return res.status(400).json({ message: 'No proposed counter time found' });
    db.prepare("UPDATE visits SET status='APPROVED', expected_arrival_time=?, proposed_arrival_time=NULL WHERE id=?").run(visit.proposed_arrival_time, visit.id);
    db.prepare("UPDATE approvals SET status='APPROVED', action_time=CURRENT_TIMESTAMP, notes='Visitor accepted proposed time' WHERE visit_id=?").run(visit.id);
    logPassStateChange(visit.id, visit.status, 'APPROVED', null, 'VISITOR', 'Visitor accepted rescheduled time');
    createNotification({
      user_id: visit.host_id,
      type: 'RESCHEDULE_ACCEPTED',
      title: '🎉 Reschedule Accepted by Visitor',
      message: `Visitor accepted proposed arrival time (${new Date(visit.proposed_arrival_time).toLocaleString()}). Pass is now APPROVED.`,
      link_id: visit.id
    });
    return res.json({ message: 'Rescheduled time accepted. Pass approved!' });
  } else if (action === 'DECLINE') {
    db.prepare("UPDATE visits SET status='REJECTED', rejection_reason='Visitor declined proposed time' WHERE id=?").run(visit.id);
    db.prepare("UPDATE approvals SET status='REJECTED', action_time=CURRENT_TIMESTAMP, notes='Visitor declined proposed time' WHERE visit_id=?").run(visit.id);
    logPassStateChange(visit.id, visit.status, 'REJECTED', null, 'VISITOR', 'Visitor declined proposed time');
    createNotification({
      user_id: visit.host_id,
      type: 'RESCHEDULE_DECLINED',
      title: '❌ Reschedule Declined by Visitor',
      message: `Visitor declined proposed arrival time. Visit marked as rejected.`,
      link_id: visit.id
    });
    return res.json({ message: 'Rescheduled time declined. Visit cancelled.' });
  } else {
    return res.status(400).json({ message: 'Action must be ACCEPT or DECLINE' });
  }
});

// Visitor Entry Endpoint (Gate Check-In)
app.post('/api/visits/:id/entry', auth, roles('GUARD', 'RECEPTION', 'ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const visit = db.prepare('SELECT x.*, v.name visitor_name, v.email visitor_email, v.company visitor_company, v.purpose visitor_purpose, v.mobile visitor_mobile, v.host_id, u.name host_name, u.email host_email, u.department host_department FROM visits x JOIN visitors v ON v.id=x.visitor_id LEFT JOIN users u ON u.id=v.host_id WHERE x.id=?').get(req.params.id);
  if (!visit) return res.status(404).json({ message: 'Visit not found' });
  if (visit.status !== 'APPROVED') return res.status(400).json({ message: `Cannot check in. Visit status is ${visit.status}` });

  const entryTimeStr = new Date().toLocaleString();
  db.prepare("UPDATE visits SET status='CHECKED_IN',entry_time=CURRENT_TIMESTAMP,entry_guard_id=? WHERE id=?").run(req.user.id, visit.id);
  logPassStateChange(visit.id, visit.status, 'CHECKED_IN', req.user.id, req.user.role, 'Gate Check-in');
  audit(req.user.id, 'ENTRY', 'VISIT', visit.id);

  // Realtime Alert Notification to Host
  createNotification({
    user_id: visit.host_id,
    type: 'VISITOR_ENTRY',
    title: '🔔 Visitor Checked In at Gate',
    message: `Your visitor ${visit.visitor_name} (${visit.visitor_company || 'Individual'}) has arrived and checked in at ${entryTimeStr}.`,
    link_id: visit.id
  });

  res.json({ message: 'Check-in recorded. Host notified.' });
});

app.post('/api/visits/:id/exit', auth, roles('GUARD', 'RECEPTION', 'ADMIN', 'SUPER_ADMIN'), (req, res) => {
  const v = db.prepare('SELECT * FROM visits WHERE id=?').get(req.params.id);
  if (!v) return res.status(404).json({ message: 'Visit not found' });
  if (v.status !== 'CHECKED_IN' && v.status !== 'INSIDE') return res.status(400).json({ message: 'Visitor is not inside/checked in' });
  db.prepare("UPDATE visits SET status='CHECKED_OUT',exit_time=CURRENT_TIMESTAMP,exit_guard_id=? WHERE id=?").run(req.user.id, v.id);
  logPassStateChange(v.id, v.status, 'CHECKED_OUT', req.user.id, req.user.role, 'Gate Check-out');
  audit(req.user.id, 'EXIT', 'VISIT', v.id);
  res.json({ message: 'Exit recorded' });
});

app.get('/api/reports/visitors', auth, roles('ADMIN', 'SUPER_ADMIN', 'RECEPTION', 'CEO'), (req, res) => {
  const rows = db.prepare(`SELECT x.visitor_code,v.name,v.mobile,v.company,v.purpose,v.department,u.name host_name,x.entry_time,x.exit_time,x.status FROM visits x JOIN visitors v ON v.id=x.visitor_id LEFT JOIN users u ON u.id=v.host_id ORDER BY x.id DESC`).all();
  res.json(rows);
});

app.get('/api/audit', auth, roles('ADMIN', 'SUPER_ADMIN', 'CEO'), (req, res) => res.json(db.prepare(`SELECT a.*,u.name actor_name FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 500`).all()));

app.get('/api/visits/:id/pass', auth, async (req, res) => {
  const r = db.prepare(`SELECT x.*,v.name,v.company,v.purpose,v.department,v.photo,u.name host_name FROM visits x JOIN visitors v ON v.id=x.visitor_id LEFT JOIN users u ON u.id=v.host_id WHERE x.id=?`).get(req.params.id);
  if (!r) return res.status(404).json({ message: 'Not found' });
  const qr = await QRCode.toDataURL(r.visitor_code);
  res.json({ ...r, qr });
});

app.get('/api/public/pass/:passToken', async (req, res) => {
  const r = db.prepare(`SELECT x.*,v.name,v.company,v.purpose,v.department,v.photo,u.name host_name, u.department host_department FROM visits x JOIN visitors v ON v.id=x.visitor_id LEFT JOIN users u ON u.id=v.host_id WHERE x.pass_token=?`).get(req.params.passToken);
  if (!r) return res.status(404).json({ message: 'Pass not found' });
  const qr = await QRCode.toDataURL(r.visitor_code);
  res.json({ ...r, qr });
});

app.listen(process.env.PORT || 8000, () => console.log(`OpsVision VAMS API running on http://localhost:${process.env.PORT || 8000}`));
