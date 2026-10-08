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
import crypto from 'crypto';

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
CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,target_role TEXT,type TEXT NOT NULL,title TEXT NOT NULL,message TEXT NOT NULL,read INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP,link_id INTEGER);
CREATE TABLE IF NOT EXISTS system_settings(key TEXT PRIMARY KEY,value TEXT);
CREATE TABLE IF NOT EXISTS refresh_tokens(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, token TEXT UNIQUE NOT NULL, expires_at TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
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

// Notification target_role Migration
try { db.exec("ALTER TABLE notifications ADD COLUMN target_role TEXT"); } catch(e) {}
try { db.exec("UPDATE notifications SET target_role='GUARD_RECEPTION' WHERE (type='VISIT_APPROVED' OR type='VISIT_REJECTED') AND (target_role IS NULL OR target_role='')"); } catch(e) {}

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

// Timezone helper: Default all email timestamps to Indian Standard Time (IST)
function formatIST(dateInput) {
  if (!dateInput) return 'N/A';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return String(dateInput);
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  }) + ' (IST)';
}

// Branded HTML Email Generator with Light Header, Transparent Swagatham Logo Graphic, Transparent Data Layer & Full-Card Watermark
function buildEmailHtml({
  badgeText = 'NOTIFICATION',
  badgeBg = '#e0e7ff',
  badgeColor = '#3730a3',
  title = 'Swagatham Notification',
  subtitle = 'Visitor Access Management System',
  greeting = 'Hello,',
  messageHtml = '',
  details = null,
  actionUrl = null,
  actionText = 'Open VAMS Portal',
  footerNote = null,
  logoTextSrc = 'cid:swagatham_logo_text',
  watermarkSrc = 'cid:swagatham_watermark'
}) {
  const detailsRows = details && details.length ? details.map(d => `
    <tr>
      <td style="padding: 11px 16px; font-weight: 600; color: #64748b; width: 38%; border-bottom: 1px solid rgba(226, 232, 240, 0.6); font-size: 13px;">${d.label}</td>
      <td style="padding: 11px 16px; color: ${d.highlight ? '#2563eb' : '#0f172a'}; font-weight: ${d.highlight ? '700' : '600'}; border-bottom: 1px solid rgba(226, 232, 240, 0.6); font-size: ${d.highlight ? '15px' : '13px'};">${d.value}</td>
    </tr>
  `).join('') : '';

  const detailsBlock = detailsRows ? `
    <table style="width: 100%; border-collapse: collapse; margin: 22px 0; background: rgba(248, 250, 252, 0.45); border-radius: 12px; overflow: hidden; border: 1px solid rgba(226, 232, 240, 0.75);">
      ${detailsRows}
    </table>
  ` : '';

  const actionBlock = actionUrl ? `
    <div style="text-align: center; margin: 28px 0 16px 0;">
      <a href="${actionUrl}" style="background: linear-gradient(135deg, #6d4ee8 0%, #4c1d95 100%); color: #ffffff !important; padding: 13px 28px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 14px; display: inline-block; box-shadow: 0 4px 14px rgba(109, 78, 232, 0.35); text-transform: uppercase; letter-spacing: 0.5px;">${actionText}</a>
    </div>
  ` : '';

  return `<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<!--[if gte mso 9]>
<xml>
  <o:OfficeDocumentSettings>
    <o:AllowPNG/>
    <o:PixelsPerInch>96</o:PixelsPerInch>
  </o:OfficeDocumentSettings>
</xml>
<![endif]-->
<style>
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');
  body {
    margin: 0;
    padding: 0;
    background-color: #f5f3ff;
    font-family: 'Plus Jakarta Sans', Arial, -apple-system, sans-serif;
    color: #1e293b;
    -webkit-font-smoothing: antialiased;
  }
</style>
</head>
<body style="margin: 0; padding: 0; background-color: #f5f3ff; font-family: 'Plus Jakarta Sans', Arial, -apple-system, sans-serif; color: #1e293b;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f3ff; padding: 24px 10px;">
    <tr>
      <td align="center">
        <!-- MAIN OUTER CARD CONTAINER WITH WATERMARK COVERING FULL EMAIL -->
        <table width="100%" cellpadding="0" cellspacing="0" background="${watermarkSrc}" style="max-width: 580px; background-color: #ffffff; background-image: url('${watermarkSrc}'); background-repeat: no-repeat; background-position: center 100px; background-size: 440px auto; border-radius: 20px; overflow: hidden; box-shadow: 0 12px 28px -5px rgba(109, 78, 232, 0.12), 0 8px 10px -6px rgba(0,0,0,0.04); border: 1px solid #e0d7fe;">
          <!--[if gte mso 9]>
          <v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:580px;">
            <v:fill type="frame" src="${watermarkSrc}" color="#ffffff" />
            <v:textbox inset="0,0,0,0">
          <![endif]-->

          <!-- LIGHT TOP HEADER WITH TRANSPARENT LOGO GRAPHIC -->
          <tr>
            <td style="background: linear-gradient(180deg, #f5f0ff 0%, rgba(255, 255, 255, 0.7) 100%); padding: 32px 24px 18px 24px; text-align: center; border-bottom: 1px solid rgba(237, 233, 254, 0.8);">
              <img src="${logoTextSrc}" alt="Swagatham" width="230" style="display: block; margin: 0 auto; max-width: 230px; width: 230px; height: auto; border: 0; background: transparent;" />
              <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 2.5px; color: #6d4ee8; font-weight: 700; margin-top: 8px;">${subtitle}</div>
            </td>
          </tr>

          <!-- MAIN CONTENT BODY (TRANSPARENT LAYERS FOR VISIBLE WATERMARK) -->
          <tr>
            <td style="padding: 32px 28px; background: transparent;">

              ${badgeText ? `
                <div style="margin-bottom: 16px;">
                  <span style="display: inline-block; padding: 5px 14px; background-color: ${badgeBg}; color: ${badgeColor}; border-radius: 9999px; font-size: 11px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase;">${badgeText}</span>
                </div>
              ` : ''}

              <h2 style="margin: 0 0 16px 0; color: #0f172a; font-size: 20px; font-weight: 700;">${title}</h2>
              <p style="margin: 0 0 14px 0; font-size: 14px; color: #334155; line-height: 1.6;">${greeting}</p>
              
              <div style="font-size: 14px; color: #334155; line-height: 1.6;">
                ${messageHtml}
              </div>

              ${detailsBlock}
              ${actionBlock}

              ${footerNote ? `<p style="font-size: 12px; color: #64748b; margin-top: 20px; font-style: italic; line-height: 1.5;">${footerNote}</p>` : ''}

            </td>
          </tr>

          <!-- BRANDED SIGNATURE & FOOTER WITH SWAGATHAM VMS -->
          <tr>
            <td style="background-color: rgba(245, 243, 255, 0.75); padding: 24px 28px; border-top: 1px solid rgba(237, 233, 254, 0.8); text-align: center;">
              <div style="margin-bottom: 8px;">
                <img src="${logoTextSrc}" alt="Swagatham VMS" width="130" style="display: inline-block; vertical-align: middle; max-width: 130px; height: auto; border: 0; background: transparent;" />
                <span style="display: inline-block; vertical-align: middle; font-size: 12px; font-weight: 800; color: #6d4ee8; margin-left: 6px; padding: 2px 8px; background: #ede9fe; border-radius: 4px; letter-spacing: 1px;">VMS</span>
              </div>
              <div style="font-size: 12px; color: #6b21a8; font-weight: 600;">Visitor Access Management System</div>
              
              <div style="margin: 16px 0 12px 0; height: 1px; background: linear-gradient(90deg, transparent, #ddd6fe, transparent);"></div>
              
              <div style="font-size: 11px; color: #64748b; line-height: 1.6;">
                ⏰ <strong>All times displayed in Indian Standard Time (IST, UTC+5:30)</strong><br>
                This is an automated notification. Please do not reply directly to this email.<br>
                Powered by Spandana Technologies • Swagatham VMS
              </div>
            </td>
          </tr>

          <!--[if gte mso 9]>
            </v:textbox>
          </v:rect>
          <![endif]-->
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// SMTP Config & Email Dispatcher with Auto CID Attachments
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

    // Auto-attach CIDs if referenced in HTML for maximum client rendering reliability
    const attachments = [];
    const logoTextPath = path.join(__dirname, '../../frontend/public/email_logo_text.png');
    const watermarkPath = path.join(__dirname, '../../frontend/public/email_watermark.png');

    if (html && html.includes('cid:swagatham_logo_text')) {
      attachments.push({ filename: 'swagatham_logo_text.png', path: logoTextPath, cid: 'swagatham_logo_text' });
    }
    if (html && html.includes('cid:swagatham_watermark')) {
      attachments.push({ filename: 'swagatham_watermark.png', path: watermarkPath, cid: 'swagatham_watermark' });
    }

    const info = await transporter.sendMail({
      from: config.from,
      to,
      subject,
      text: text || html.replace(/<[^>]+>/g, ''),
      html,
      attachments
    });
    console.log(`[VAMS EMAIL SENT] ID: ${info.messageId} -> ${to}`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error(`[VAMS EMAIL ERROR] Failed sending to ${to}:`, err.message);
    return { success: false, error: err.message };
  }
}

// In-App Notification Helper
function createNotification({ user_id = null, target_role = null, type, title, message, link_id = null }) {
  try {
    db.prepare('INSERT INTO notifications(user_id,target_role,type,title,message,link_id) VALUES(?,?,?,?,?,?)').run(
      user_id, target_role, type, title, message, link_id
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
app.use(express.static(path.join(__dirname, '../../frontend/public')));
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
// Helper: Cookie Parser & Persistent Refresh Tokens
function parseCookies(req) {
  const list = {};
  const rc = req.headers.cookie;
  if (rc) {
    rc.split(';').forEach(cookie => {
      const parts = cookie.split('=');
      list[parts.shift().trim()] = decodeURIComponent(parts.join('='));
    });
  }
  return list;
}

function setRefreshCookie(res, refreshToken) {
  const isProd = process.env.NODE_ENV === 'production';
  const cookieOpts = [
    `vams_refresh_token=${refreshToken}`,
    'Path=/',
    'HttpOnly',
    'Max-Age=' + (90 * 24 * 60 * 60), // 90 days sliding window
    'SameSite=Lax',
    isProd ? 'Secure' : ''
  ].filter(Boolean).join('; ');
  res.setHeader('Set-Cookie', cookieOpts);
}

function clearRefreshCookie(res) {
  res.setHeader('Set-Cookie', 'vams_refresh_token=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax');
}

function createRefreshTokenForUser(userId) {
  const token = crypto.randomBytes(40).toString('hex');
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO refresh_tokens(user_id, token, expires_at) VALUES(?, ?, ?)').run(userId, token, expiresAt);
  try {
    db.prepare("DELETE FROM refresh_tokens WHERE expires_at < CURRENT_TIMESTAMP").run();
  } catch(e) {}
  return token;
}

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

  const userPayload = { id: newUserId, username, name, role: 'HOST', department: department || 'General', email: cleanEmail };
  const token = jwt.sign(userPayload, secret, { expiresIn: '8h' });
  const refreshToken = createRefreshTokenForUser(newUserId);
  setRefreshCookie(res, refreshToken);

  res.status(201).json({
    message: 'Host account registered successfully!',
    token,
    refreshToken,
    user: userPayload
  });
});

app.post('/api/auth/login', (req, res) => {
  const input = req.body.username ? req.body.username.trim().toLowerCase() : '';
  if (!input || !req.body.password) return res.status(401).json({ message: 'Username and password are required' });

  const u = db.prepare('SELECT * FROM users WHERE LOWER(username)=? OR LOWER(email)=?').get(input, input);
  if (!u || !bcrypt.compareSync(req.body.password, u.password)) return res.status(401).json({ message: 'Invalid credentials' });
  if (u.active === 0) return res.status(403).json({ message: 'Account disabled. Contact system administrator.' });

  db.prepare('UPDATE users SET last_login=CURRENT_TIMESTAMP WHERE id=?').run(u.id);

  const userPayload = { id: u.id, username: u.username, name: u.name, role: u.role, department: u.department, email: u.email };
  const token = jwt.sign(userPayload, secret, { expiresIn: '8h' });
  const refreshToken = createRefreshTokenForUser(u.id);
  setRefreshCookie(res, refreshToken);

  res.json({ token, refreshToken, user: userPayload });
});

app.post('/api/auth/refresh', (req, res) => {
  const cookies = parseCookies(req);
  const providedToken = (req.body && req.body.refreshToken) || cookies.vams_refresh_token;

  if (!providedToken) {
    return res.status(401).json({ message: 'No refresh token provided' });
  }

  const row = db.prepare('SELECT * FROM refresh_tokens WHERE token=? AND expires_at > CURRENT_TIMESTAMP').get(providedToken);
  if (!row) {
    clearRefreshCookie(res);
    return res.status(401).json({ message: 'Invalid or expired session. Please log in again.' });
  }

  const u = db.prepare('SELECT * FROM users WHERE id=?').get(row.user_id);
  if (!u || u.active === 0) {
    db.prepare('DELETE FROM refresh_tokens WHERE token=?').run(providedToken);
    clearRefreshCookie(res);
    return res.status(403).json({ message: 'Account disabled or invalid' });
  }

  // Rotate refresh token for maximum sliding session security
  db.prepare('DELETE FROM refresh_tokens WHERE token=?').run(providedToken);
  const newRefreshToken = createRefreshTokenForUser(u.id);
  setRefreshCookie(res, newRefreshToken);

  const userPayload = { id: u.id, username: u.username, name: u.name, role: u.role, department: u.department, email: u.email };
  const token = jwt.sign(userPayload, secret, { expiresIn: '8h' });

  db.prepare('UPDATE users SET last_login=CURRENT_TIMESTAMP WHERE id=?').run(u.id);

  res.json({ token, refreshToken: newRefreshToken, user: userPayload });
});

app.get('/api/auth/me', (req, res) => {
  const h = req.headers.authorization || '';
  if (h && h.startsWith('Bearer ')) {
    try {
      const u = jwt.verify(h.replace('Bearer ', '').trim(), secret);
      const dbUser = db.prepare('SELECT id, username, name, role, department, email, active FROM users WHERE id=?').get(u.id);
      if (dbUser && dbUser.active !== 0) {
        return res.json({ user: dbUser });
      }
    } catch (e) {}
  }

  // Attempt refresh token verification if access token expired or missing
  const cookies = parseCookies(req);
  const providedToken = (req.headers['x-refresh-token']) || cookies.vams_refresh_token;
  if (providedToken) {
    const row = db.prepare('SELECT * FROM refresh_tokens WHERE token=? AND expires_at > CURRENT_TIMESTAMP').get(providedToken);
    if (row) {
      const u = db.prepare('SELECT id, username, name, role, department, email, active FROM users WHERE id=?').get(row.user_id);
      if (u && u.active !== 0) {
        const token = jwt.sign({ id: u.id, username: u.username, name: u.name, role: u.role, department: u.department, email: u.email }, secret, { expiresIn: '8h' });
        return res.json({ user: u, token });
      }
    }
  }

  return res.status(401).json({ message: 'Unauthenticated' });
});

app.post('/api/auth/logout', (req, res) => {
  const cookies = parseCookies(req);
  const providedToken = (req.body && req.body.refreshToken) || cookies.vams_refresh_token;

  if (providedToken) {
    try {
      db.prepare('DELETE FROM refresh_tokens WHERE token=?').run(providedToken);
    } catch (e) {}
  }
  
  // Clear all refresh tokens if authenticated user id passed
  const h = req.headers.authorization || '';
  if (h && h.startsWith('Bearer ')) {
    try {
      const u = jwt.verify(h.replace('Bearer ', '').trim(), secret);
      db.prepare('DELETE FROM refresh_tokens WHERE user_id=?').run(u.id);
    } catch(e) {}
  }

  clearRefreshCookie(res);
  res.json({ message: 'Logged out successfully' });
});

// Notifications API (Scoped to User Role & Permissions)
app.get('/api/notifications', auth, (req, res) => {
  const { id, role } = req.user;
  let rows, unreadCount;

  if (role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'CEO') {
    // CEO, Admin and Superadmin can see ALL notifications
    rows = db.prepare('SELECT * FROM notifications ORDER BY id DESC LIMIT 50').all();
    unreadCount = db.prepare('SELECT COUNT(*) c FROM notifications WHERE read=0').get().c;
  } else if (role === 'GUARD' || role === 'RECEPTION') {
    // Guard and Receptionist see notifications directed to them or targeted to GUARD/RECEPTION
    rows = db.prepare(`
      SELECT * FROM notifications 
      WHERE user_id = ? OR target_role = 'GUARD_RECEPTION' OR target_role = 'GUARD' OR target_role = 'RECEPTION'
      ORDER BY id DESC LIMIT 50
    `).all(id);
    unreadCount = db.prepare(`
      SELECT COUNT(*) c FROM notifications 
      WHERE (user_id = ? OR target_role = 'GUARD_RECEPTION' OR target_role = 'GUARD' OR target_role = 'RECEPTION') 
        AND read=0
    `).get(id).c;
  } else {
    // Hosts and Employees see ONLY notifications explicitly sent to their user_id
    rows = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(id);
    unreadCount = db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read=0').get(id).c;
  }

  res.json({ notifications: rows, unreadCount });
});

app.put('/api/notifications/:id/read', auth, (req, res) => {
  db.prepare('UPDATE notifications SET read=1 WHERE id=?').run(req.params.id);
  res.json({ message: 'Notification marked as read' });
});

app.put('/api/notifications/read-all', auth, (req, res) => {
  const { id, role } = req.user;
  if (role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'CEO') {
    db.prepare('UPDATE notifications SET read=1').run();
  } else if (role === 'GUARD' || role === 'RECEPTION') {
    db.prepare(`UPDATE notifications SET read=1 WHERE user_id = ? OR target_role IN ('GUARD_RECEPTION', 'GUARD', 'RECEPTION')`).run(id);
  } else {
    db.prepare('UPDATE notifications SET read=1 WHERE user_id = ?').run(id);
  }
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
    html: buildEmailHtml({
      badgeText: 'SMTP VERIFIED',
      badgeBg: '#ecfdf5',
      badgeColor: '#047857',
      title: 'Swagatham VMS - SMTP Verification',
      greeting: `Hello ${req.user.name || 'Admin'},`,
      messageHtml: `<p>Congratulations! Your Google Workspace SMTP configuration is working properly.</p>`,
      details: [
        { label: 'Recipient Email', value: targetEmail },
        { label: 'Dispatched At (IST)', value: formatIST(new Date()), highlight: true },
        { label: 'Status', value: 'Active & Verified', highlight: true }
      ]
    })
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
      html: buildEmailHtml({
        badgeText: 'ACCOUNT CREATED',
        badgeBg: '#eff6ff',
        badgeColor: '#1d4ed8',
        title: 'Welcome to Swagatham VMS',
        greeting: `Hello <strong>${name.trim()}</strong>,`,
        messageHtml: `<p>Your account has been created with role: <strong style="color: #2563eb;">${userRole}</strong>.</p>
          <p>Please log in to the Swagatham Visitor Access Management System using your credentials below.</p>`,
        details: [
          { label: 'Username / Email', value: `${userStr} (${cleanEmail})` },
          { label: 'Initial Password', value: passStr, highlight: true },
          { label: 'System Portal', value: 'https://vams.spandanatech.in' },
          { label: 'Created At (IST)', value: formatIST(new Date()) }
        ],
        actionUrl: 'https://vams.spandanatech.in',
        actionText: 'Log In to Swagatham Portal',
        footerNote: 'Please log in using your Username or Email address with the password above and change your password upon first login.'
      })
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
      html: buildEmailHtml({
        badgeText: 'ACTION REQUIRED',
        badgeBg: '#eff6ff',
        badgeColor: '#1d4ed8',
        title: 'New Visitor Approval Request',
        greeting: `Hello <strong>${hostUser.name}</strong>,`,
        messageHtml: `<p>A visitor has been registered to meet you at reception/gate:</p>`,
        details: [
          { label: 'Visitor Name', value: name },
          { label: 'Company', value: company || 'N/A' },
          { label: 'Purpose', value: purpose || 'Visit' },
          { label: 'Registered At (IST)', value: formatIST(new Date()) }
        ],
        actionUrl: 'https://vams.spandanatech.in',
        actionText: 'Open Host Dashboard to Review',
        footerNote: 'Please log in to your Swagatham VMS Dashboard to review and single-tap approve or reject this visitor pass.'
      })
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
      html: buildEmailHtml({
        badgeText: 'PRE-APPROVAL REQUEST',
        badgeBg: '#fef3c7',
        badgeColor: '#92400e',
        title: 'Visitor Pre-Approval Request',
        greeting: `Hello <strong>${hostUser.name}</strong>,`,
        messageHtml: `<p>A visitor has self-registered to meet you:</p>`,
        details: [
          { label: 'Visitor Name', value: name },
          { label: 'Company', value: company || 'N/A' },
          { label: 'Purpose', value: purpose },
          { label: 'Expected Arrival (IST)', value: formatIST(expected_arrival_time), highlight: true }
        ],
        actionUrl: 'https://vams.spandanatech.in',
        actionText: 'Review & Respond in Host Dashboard',
        footerNote: 'Please log in to your Swagatham VMS Host Dashboard to Single-Tap Approve, Propose New Time, or Reject this visit.'
      })
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

    // Notify Guard & Receptionist on Approval
    createNotification({
      target_role: 'GUARD_RECEPTION',
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
        html: buildEmailHtml({
          badgeText: 'PASS APPROVED',
          badgeBg: '#ecfdf5',
          badgeColor: '#047857',
          title: 'Your Visitor Pass is Approved! 🎉',
          greeting: `Dear <strong>${visit.visitor_name}</strong>,`,
          messageHtml: `<p>Your host <strong>${visit.host_name}</strong> has approved your visit request.</p>`,
          details: [
            { label: 'Visitor Pass Code', value: visit.visitor_code, highlight: true },
            { label: 'Host Name', value: visit.host_name },
            { label: 'Expected Arrival (IST)', value: formatIST(visit.expected_arrival_time || visit.expected_checkin), highlight: true }
          ],
          footerNote: 'Please present this Visitor Pass Code at reception upon arrival.'
        })
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
      const confirmUrl = `${req.headers.origin || 'https://vams.spandanatech.in'}?confirmToken=${visit.pass_token}`;
      sendEmail({
        to: visit.visitor_email,
        subject: `[Swagatham VMS] Host Proposed New Visit Time: ${visit.visitor_name}`,
        html: buildEmailHtml({
          badgeText: 'RESCHEDULE PROPOSAL',
          badgeBg: '#fffbeb',
          badgeColor: '#b45309',
          title: 'Host Proposed New Visit Time',
          greeting: `Dear <strong>${visit.visitor_name}</strong>,`,
          messageHtml: `<p>Your host <strong>${visit.host_name}</strong> proposed a new arrival time for your visit.</p>`,
          details: [
            { label: 'Host Name', value: visit.host_name },
            { label: 'New Proposed Arrival (IST)', value: formatIST(proposed_time), highlight: true }
          ],
          actionUrl: confirmUrl,
          actionText: 'Review & Confirm Reschedule',
          footerNote: 'Please click the button above to confirm if this new time works for you.'
        })
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

    // Notify Guard & Receptionist on Rejection
    createNotification({
      target_role: 'GUARD_RECEPTION',
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

  const vInfo = db.prepare('SELECT x.*, v.name visitor_name, u.name host_name FROM visits x JOIN visitors v ON v.id=x.visitor_id LEFT JOIN users u ON u.id=v.host_id WHERE x.id=?').get(visit.id);
  createNotification({
    target_role: 'GUARD_RECEPTION',
    type: status === 'APPROVED' ? 'VISIT_APPROVED' : 'VISIT_REJECTED',
    title: status === 'APPROVED' ? '✅ Visitor Pass Approved' : '❌ Visit Request Rejected',
    message: status === 'APPROVED' ? `${vInfo ? vInfo.visitor_name : 'Visitor'} has been approved by host ${vInfo ? vInfo.host_name : 'Host'}.` : `${vInfo ? vInfo.visitor_name : 'Visitor'} was rejected. Reason: ${notes}`,
    link_id: visit.id
  });

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

// Live Interactive Email Preview Endpoint
app.get('/api/public/email-preview', (req, res) => {
  const type = req.query.type || 'approved';
  const logoTextSrc = '/email_logo_text.png';
  const watermarkSrc = '/email_watermark.png';
  let html = '';

  if (type === 'approved') {
    html = buildEmailHtml({
      badgeText: 'PASS APPROVED',
      badgeBg: '#ecfdf5',
      badgeColor: '#047857',
      title: 'Your Visitor Pass is Approved! 🎉',
      greeting: 'Dear <strong>Raghavendra M</strong>,',
      messageHtml: '<p>Your host <strong>Colonel SG Jyothy</strong> has approved your visit request to the facility.</p>',
      details: [
        { label: 'Visitor Pass Code', value: 'VAMS-MUP5CP96', highlight: true },
        { label: 'Host Name', value: 'Colonel SG Jyothy (Security Operations)' },
        { label: 'Visitor Name', value: 'Raghavendra M' },
        { label: 'Purpose', value: 'Official Client Discussion' },
        { label: 'Expected Arrival (IST)', value: formatIST('2026-10-01T06:22:05'), highlight: true }
      ],
      footerNote: 'Please present this Visitor Pass Code at reception upon arrival.',
      logoTextSrc,
      watermarkSrc
    });
  } else if (type === 'propose_time') {
    html = buildEmailHtml({
      badgeText: 'RESCHEDULE PROPOSAL',
      badgeBg: '#fffbeb',
      badgeColor: '#b45309',
      title: 'Host Proposed New Visit Time',
      greeting: 'Dear <strong>Raghavendra M</strong>,',
      messageHtml: '<p>Your host <strong>Colonel SG Jyothy</strong> proposed a new arrival time for your visit:</p>',
      details: [
        { label: 'Host Name', value: 'Colonel SG Jyothy' },
        { label: 'New Proposed Arrival (IST)', value: formatIST('2026-10-01T14:30:00'), highlight: true }
      ],
      actionUrl: '#',
      actionText: 'Review & Confirm Reschedule',
      footerNote: 'Please click the button above to confirm if this new time works for you.',
      logoTextSrc,
      watermarkSrc
    });
  } else if (type === 'welcome') {
    html = buildEmailHtml({
      badgeText: 'ACCOUNT CREATED',
      badgeBg: '#eff6ff',
      badgeColor: '#1d4ed8',
      title: 'Welcome to Swagatham VMS',
      greeting: 'Hello <strong>Demo Host</strong>,',
      messageHtml: '<p>Your account has been created with role: <strong style="color: #2563eb;">HOST</strong>.</p><p>Please log in to the Swagatham Visitor Access Management System using your credentials below.</p>',
      details: [
        { label: 'Username / Email', value: 'host.demo (host.demo@opsvision.com)' },
        { label: 'Initial Password', value: 'host123', highlight: true },
        { label: 'System Portal', value: 'https://vams.spandanatech.in' },
        { label: 'Created At (IST)', value: formatIST(new Date()) }
      ],
      actionUrl: 'https://vams.spandanatech.in',
      actionText: 'Log In to Swagatham Portal',
      footerNote: 'Please log in using your Username or Email address with the password above and change your password upon first login.',
      logoTextSrc,
      watermarkSrc
    });
  } else {
    html = buildEmailHtml({
      badgeText: 'ACTION REQUIRED',
      badgeBg: '#eff6ff',
      badgeColor: '#1d4ed8',
      title: 'New Visitor Approval Request',
      greeting: 'Hello <strong>Colonel SG Jyothy</strong>,',
      messageHtml: '<p>A visitor has registered to meet you at reception/gate:</p>',
      details: [
        { label: 'Visitor Name', value: 'Raghavendra M' },
        { label: 'Company', value: 'Spandana Tech' },
        { label: 'Purpose', value: 'Official Discussion' },
        { label: 'Registered At (IST)', value: formatIST(new Date()) }
      ],
      actionUrl: '#',
      actionText: 'Open Host Dashboard to Review',
      footerNote: 'Please log in to your Swagatham VMS Dashboard to review and single-tap approve or reject this visitor pass.',
      logoTextSrc,
      watermarkSrc
    });
  }

  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

app.listen(process.env.PORT || 8000, () => console.log(`OpsVision VAMS API running on http://localhost:${process.env.PORT || 8000}`));
