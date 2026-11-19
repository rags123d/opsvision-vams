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
import fs from 'fs';

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
try { db.exec("ALTER TABLE visits ADD COLUMN host_token TEXT"); } catch(e) {}
try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_visits_host_token ON visits(host_token)"); } catch(e) {}

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

// Timezone helper: Default all timestamps and email timestamps to Indian Standard Time (IST)
function formatIST(dateInput) {
  if (!dateInput) return 'N/A';
  let s = String(dateInput).trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
    s = s.replace(' ', 'T') + 'Z';
  }
  const d = new Date(s);
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
  actions = null,
  secondaryUrl = null,
  secondaryText = 'Log In to Host Dashboard',
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

  const actionBlock = (actions && actions.length) ? `
    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin: 28px 0 16px 0;">
      <tr>
        <td align="center">
          <table border="0" cellpadding="0" cellspacing="0" style="margin: 0 auto;">
            <tr>
              ${actions.map((act, idx) => {
                const isDecline = act.type === 'decline' || (act.text && (act.text.includes('✕') || act.text.includes('✖') || act.text.toLowerCase().includes('deny') || act.text.toLowerCase().includes('decline')));
                const bg = isDecline
                  ? 'linear-gradient(135deg, #e11d48 0%, #be123c 100%)'
                  : 'linear-gradient(135deg, #059669 0%, #0d9488 100%)';
                const bgColor = isDecline ? '#e11d48' : '#059669';
                const borderColor = isDecline ? '#fb7185' : '#34d399';
                const shadow = isDecline ? 'rgba(225, 29, 72, 0.38)' : 'rgba(13, 148, 136, 0.38)';
                const btnClass = isDecline ? 'action-btn-decline' : 'action-btn-approve';
                const tooltip = act.title || (isDecline ? 'Decline or Propose New Time' : 'Approve Visitor');
                const spacer = idx > 0 ? `
                  <td width="32" style="width: 32px; min-width: 32px; max-width: 32px; font-size: 1px; line-height: 1;">&nbsp;</td>
                ` : '';

                return `
                  ${spacer}
                  <td align="center" style="border-radius: 9999px; background: ${bgColor}; padding: 0;">
                    <a href="${act.url}" target="_blank" title="${tooltip}" class="${btnClass}" style="display: inline-block; padding: 12px 34px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 26px; font-weight: 900; line-height: 1; color: #ffffff !important; text-decoration: none; border-radius: 9999px; background: ${bg}; background-color: ${bgColor}; border: 1px solid ${borderColor}; box-shadow: 0 4px 16px ${shadow}; min-width: 80px; text-align: center; box-sizing: border-box;">
                      ${act.text}
                    </a>
                  </td>
                `;
              }).join('')}
            </tr>
          </table>
          <div style="text-align: center; margin-top: 14px; font-size: 11px; color: #64748b; letter-spacing: 0.3px;">
            <span style="color: #059669; font-weight: 700;">✔ Approve</span> &nbsp;&bull;&nbsp; <span style="color: #e11d48; font-weight: 700;">✕ Decline / Reschedule</span>
          </div>
          ${secondaryUrl ? `
            <div style="text-align: center; margin-top: 12px; font-size: 11px; color: #64748b;">
              Or <a href="${secondaryUrl}" style="color: #6d4ee8; text-decoration: underline; font-weight: 600;">${secondaryText || 'Open Host Portal'}</a>
            </div>
          ` : ''}
        </td>
      </tr>
    </table>
  ` : (actionUrl ? `
    <div style="text-align: center; margin: 28px 0 16px 0;">
      <a href="${actionUrl}" style="background: linear-gradient(135deg, #6d4ee8 0%, #4c1d95 100%); color: #ffffff !important; padding: 13px 28px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 14px; display: inline-block; box-shadow: 0 4px 14px rgba(109, 78, 232, 0.35); text-transform: uppercase; letter-spacing: 0.5px;">${actionText}</a>
    </div>
  ` : '');

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

// Base Application URL Resolver (Local Dev vs VPS Production)
function getAppBaseUrl(req) {
  if (process.env.APP_URL) {
    return process.env.APP_URL.replace(/\/$/, '');
  }
  const settingUrl = getSetting('app_url');
  if (settingUrl) {
    return settingUrl.replace(/\/$/, '');
  }
  if (req) {
    if (req.headers && req.headers.origin) {
      return req.headers.origin.replace(/\/$/, '');
    }
    if (req.headers && req.headers.referer) {
      try {
        const u = new URL(req.headers.referer);
        return `${u.protocol}//${u.host}`;
      } catch (e) {}
    }
    if (req.headers && req.headers.host) {
      const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
      return `${proto}://${req.headers.host}`;
    }
  }
  return 'https://vams.spandanatech.in';
}

// In-Memory Tracker for Last Sent Email (for local browser preview & testing)
let lastSentEmail = null;

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

async function sendEmail({ to, subject, html, text, meta = null }) {
  if (!to || !to.includes('@')) {
    console.log(`[VAMS EMAIL SKIPPED] No valid email provided: "${to}"`);
    return { success: false, reason: 'Invalid or missing recipient email' };
  }

  // Cache last email and write static preview file to frontend public directory
  lastSentEmail = { to, subject, html, text, meta, timestamp: new Date().toISOString() };
  try {
    const previewFile = path.join(__dirname, '../../frontend/public/preview_last_email.html');
    if (html) {
      let browserHtml = html
        .replace(/cid:swagatham_logo_text/g, '/email_logo_text.png')
        .replace(/cid:swagatham_watermark/g, '/email_watermark.png');

      // Inject interactive 1-click script for in-browser email preview testing
      const interactiveScript = `
        <script>
        (function() {
          document.addEventListener('DOMContentLoaded', function() {
            const approveBtn = document.querySelector('.action-btn-approve');
            const declineBtn = document.querySelector('.action-btn-decline');
            if (approveBtn) {
              approveBtn.addEventListener('click', function(e) {
                e.preventDefault();
                const url = this.getAttribute('href');
                this.style.pointerEvents = 'none';
                this.style.opacity = '0.7';
                this.innerHTML = '⌛';
                fetch(url)
                  .then(function() {
                    approveBtn.outerHTML = '<span style="display:inline-block;padding:12px 30px;border-radius:9999px;background:#ecfdf5;color:#059669;font-weight:800;font-size:14px;border:1px solid #34d399;box-shadow:0 2px 8px rgba(5,150,105,0.2);">✔ APPROVED</span>';
                    if (declineBtn) {
                      declineBtn.style.opacity = '0.25';
                      declineBtn.style.pointerEvents = 'none';
                      declineBtn.style.cursor = 'not-allowed';
                    }
                    const note = document.createElement('div');
                    note.style.cssText = 'text-align:center;color:#059669;font-size:12px;font-weight:700;margin-top:10px;';
                    note.innerText = '✔ Pass Approved! Security desk updated in real-time.';
                    const wrap = document.querySelector('span[style*="APPROVED"]');
                    if (wrap && wrap.closest('table')) {
                      wrap.closest('table').parentNode.appendChild(note);
                    }
                  })
                  .catch(function(err) {
                    approveBtn.style.pointerEvents = 'auto';
                    approveBtn.style.opacity = '1';
                    approveBtn.innerHTML = '✔';
                    alert('Approval error: ' + err.message);
                  });
              });
            }
          });
        })();
        </script>
      `;
      if (browserHtml.includes('</body>')) {
        browserHtml = browserHtml.replace('</body>', interactiveScript + '</body>');
      } else {
        browserHtml += interactiveScript;
      }
      fs.writeFileSync(previewFile, browserHtml, 'utf8');
    }
  } catch (err) {
    console.error('[PREVIEW SAVE ERROR]', err.message);
  }

  const config = getSmtpConfig();
  if (!config.user || !config.pass) {
    console.log(`\n======================================================================`);
    console.log(`📧 [VAMS EMAIL SIMULATION - 1-TAP ACTION BUTTONS GENERATED]`);
    console.log(`Recipient : ${to}`);
    console.log(`Subject   : ${subject}`);
    if (meta && meta.approveUrl && meta.declineUrl) {
      console.log(`\n🟢 DIRECT APPROVE LINK:\n   ${meta.approveUrl}`);
      console.log(`\n🔴 DIRECT DECLINE LINK:\n   ${meta.declineUrl}`);
      console.log(`\n🌐 LIVE HTML PREVIEW:\n   http://localhost:5180/preview_last_email.html`);
    }
    console.log(`======================================================================\n`);
    return { success: true, simulated: true, approveUrl: meta?.approveUrl, declineUrl: meta?.declineUrl };
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
    if (meta && meta.approveUrl) {
      console.log(`[HOST ACTION URLS] Approve: ${meta.approveUrl} | Decline: ${meta.declineUrl}`);
    }
    return { success: true, messageId: info.messageId, approveUrl: meta?.approveUrl, declineUrl: meta?.declineUrl };
  } catch (err) {
    console.error(`[VAMS EMAIL ERROR] Failed sending to ${to}:`, err.message);
    return { success: false, error: err.message };
  }
}

// In-App Notification Helper (stores ISO 8601 UTC timestamp)
function createNotification({ user_id = null, target_role = null, type, title, message, link_id = null }) {
  try {
    const createdAt = new Date().toISOString();
    db.prepare('INSERT INTO notifications(user_id,target_role,type,title,message,link_id,created_at) VALUES(?,?,?,?,?,?,?)').run(
      user_id, target_role, type, title, message, link_id, createdAt
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

  // Ensure created_at conforms strictly to ISO 8601 standard for all rows (both new and legacy SQLite CURRENT_TIMESTAMP records)
  const normalizedRows = rows.map(r => {
    let cat = r.created_at;
    if (cat) {
      let s = String(cat).trim();
      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
        s = s.replace(' ', 'T') + 'Z';
      }
      const d = new Date(s);
      cat = isNaN(d.getTime()) ? cat : d.toISOString();
    }
    return { ...r, created_at: cat };
  });

  res.json({ notifications: normalizedRows, unreadCount });
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

  // Use chosen username, or derive fallback from email prefix / name
  let userStr = username && username.trim()
    ? username.trim().toLowerCase().replace(/\s+/g, '.').replace(/[^a-z0-9_.-]/g, '')
    : (cleanEmail ? cleanEmail.split('@')[0].replace(/[^a-z0-9_.-]/g, '') : name.trim().toLowerCase().replace(/\s+/g, '.').replace(/[^a-z0-9_.-]/g, ''));

  if (!userStr) {
    return res.status(400).json({ message: 'Please provide a valid username' });
  }

  // Check if chosen username is already taken
  const existingUser = db.prepare('SELECT id FROM users WHERE LOWER(username)=?').get(userStr);
  if (existingUser) {
    return res.status(400).json({ message: `Username "${userStr}" is already taken. Please choose a different username.` });
  }
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

  // Accept custom username if provided, or retain existing
  let userStr = username && username.trim()
    ? username.trim().toLowerCase().replace(/\s+/g, '.').replace(/[^a-z0-9_.-]/g, '')
    : d.username;

  if (!userStr) userStr = d.username;

  // Check if chosen username is already taken by another user
  const existingUser = db.prepare('SELECT id FROM users WHERE LOWER(username)=? AND id!=?').get(userStr, d.id);
  if (existingUser) {
    return res.status(400).json({ message: `Username "${userStr}" is already taken by another user. Please choose a different username.` });
  }

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
  let sql = `SELECT v.*,x.id visit_id,x.visitor_code,x.entry_time,x.exit_time,x.status,x.valid_until,x.expected_checkin,x.expected_checkout,x.initiator_type,x.expected_arrival_time,x.proposed_arrival_time,x.rejection_reason,x.pass_token,x.host_token,u.name host_name,u.email host_email FROM visitors v JOIN visits x ON x.visitor_id=v.id LEFT JOIN users u ON u.id=v.host_id WHERE 1=1`;
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
  const hostToken = 'HTOKEN-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase() + crypto.randomBytes(4).toString('hex').toUpperCase();
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const validUntil = expected_checkout || new Date(Date.now() + 8 * 3600000).toISOString();

  // If created by host for themselves, auto approve; otherwise default to PENDING_HOST_REVIEW (Awaiting Approval)
  const isHostSelf = (req.user.role === 'HOST' || req.user.role === 'EMPLOYEE' || req.user.role === 'CEO') && req.user.id === Number(host_id);
  const status = isHostSelf ? 'APPROVED' : 'PENDING_HOST_REVIEW';

  const tx = db.transaction(() => {
    const r = db.prepare('INSERT INTO visitors(name,mobile,email,company,purpose,host_id,department,vehicle,photo,consent,otp) VALUES(?,?,?,?,?,?,?,?,?,1,?)')
      .run(name, cleanMobile, email || '', company || '', purpose || 'Visit', host_id, department || '', vehicle || '', photo || null, otp);
    const vr = db.prepare('INSERT INTO visits(visitor_id,visitor_code,status,valid_until,expected_checkin,expected_checkout,expected_arrival_time,created_by,approved_by,pass_token,host_token) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(r.lastInsertRowid, code, status, validUntil, expected_checkin || null, expected_checkout || null, expected_checkin || null, req.user.id, status === 'APPROVED' ? req.user.id : null, passToken, hostToken);
    db.prepare('INSERT INTO approvals(visit_id,host_id,status) VALUES(?,?,?)').run(vr.lastInsertRowid, host_id, status === 'APPROVED' ? 'APPROVED' : 'PENDING');
    logPassStateChange(vr.lastInsertRowid, null, status, req.user.id, req.user.role, 'Registered (Awaiting Host Approval)');
    audit(req.user.id, 'REGISTER_VISITOR', 'VISIT', vr.lastInsertRowid, code);
    return { id: r.lastInsertRowid, visitId: vr.lastInsertRowid, visitorCode: code, otp, passToken, hostToken, status };
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

  // Host Email Notification with Direct Action Buttons
  const hostUser = db.prepare('SELECT * FROM users WHERE id=?').get(host_id);
  if (hostUser && hostUser.email && status !== 'APPROVED') {
    const baseUrl = getAppBaseUrl(req);
    const approveUrl = `${baseUrl}/api/public/quick-host-action?token=${hostToken}&action=APPROVE`;
    const declineUrl = `${baseUrl}/?hostToken=${hostToken}&action=DECLINE`;

    sendEmail({
      to: hostUser.email,
      subject: `[Swagatham VMS] Visitor Approval Request: ${name} is visiting you`,
      meta: { approveUrl, declineUrl, hostToken, visitId: out.visitId },
      html: buildEmailHtml({
        badgeText: 'APPROVAL REQUIRED',
        badgeBg: '#eff6ff',
        badgeColor: '#1d4ed8',
        title: 'New Visitor Approval Request',
        greeting: `Hello <strong>${hostUser.name}</strong>,`,
        messageHtml: `<p>A visitor has arrived / registered to meet you at reception. Please choose an authorization action directly below:</p>`,
        details: [
          { label: 'Visitor Name', value: name, highlight: true },
          { label: 'Company', value: company || 'N/A' },
          { label: 'Purpose', value: purpose || 'Visit' },
          { label: 'Registered At (IST)', value: formatIST(new Date()), highlight: true }
        ],
        actions: [
          { text: '✔', url: approveUrl, bg: '#059669', type: 'approve', title: 'Approve Visitor' },
          { text: '✕', url: declineUrl, bg: '#e11d48', type: 'decline', title: 'Decline or Propose New Time' }
        ],
        secondaryUrl: baseUrl,
        secondaryText: 'Open Host Portal',
        footerNote: '⚡ Click ✔ to Approve immediately, or ✕ to Decline / Propose a new time.'
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
  const hostToken = 'HTOKEN-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase() + crypto.randomBytes(4).toString('hex').toUpperCase();
  const validUntil = new Date(new Date(expected_arrival_time).getTime() + 8 * 3600000).toISOString();

  const tx = db.transaction(() => {
    const r = db.prepare('INSERT INTO visitors(name,mobile,email,company,purpose,host_id,department,vehicle,consent) VALUES(?,?,?,?,?,?,?,?,1)').run(name, cleanMobile, email || '', company || '', purpose, host_id, department || '', vehicle || '');
    const vr = db.prepare('INSERT INTO visits(visitor_id,visitor_code,status,valid_until,expected_checkin,expected_checkout,initiator_type,expected_arrival_time,pass_token,host_token) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(r.lastInsertRowid, code, 'PENDING_HOST_REVIEW', validUntil, expected_arrival_time, validUntil, 'SELF_REGISTERED', expected_arrival_time, passToken, hostToken);
    db.prepare('INSERT INTO approvals(visit_id,host_id,status) VALUES(?,?,?)').run(vr.lastInsertRowid, host_id, 'PENDING');
    logPassStateChange(vr.lastInsertRowid, null, 'PENDING_HOST_REVIEW', null, 'VISITOR', 'Self-registered by visitor');
    return { id: r.lastInsertRowid, visitId: vr.lastInsertRowid, visitorCode: code, passToken, hostToken };
  });

  const out = tx();
  const hostUser = db.prepare('SELECT * FROM users WHERE id=?').get(host_id);

  // In-App Notification to Host
  createNotification({
    user_id: host_id,
    type: 'VISITOR_REGISTERED',
    title: '🔔 New Visitor Self-Registered',
    message: `${name} (${company || 'Individual'}) requested a visit for ${formatIST(expected_arrival_time)}.`,
    link_id: out.visitId
  });

  // Host Email Notification with Direct Action Buttons
  if (hostUser && hostUser.email) {
    const baseUrl = getAppBaseUrl(req);
    const approveUrl = `${baseUrl}/api/public/quick-host-action?token=${hostToken}&action=APPROVE`;
    const declineUrl = `${baseUrl}/?hostToken=${hostToken}&action=DECLINE`;

    sendEmail({
      to: hostUser.email,
      subject: `[Swagatham VMS] Pre-Approval Request: ${name} is visiting you`,
      meta: { approveUrl, declineUrl, hostToken, visitId: out.visitId },
      html: buildEmailHtml({
        badgeText: 'PRE-APPROVAL REQUEST',
        badgeBg: '#fef3c7',
        badgeColor: '#92400e',
        title: 'Visitor Pre-Approval Request',
        greeting: `Hello <strong>${hostUser.name}</strong>,`,
        messageHtml: `<p>A visitor has self-registered to meet you. Please authorize or deny entry directly below:</p>`,
        details: [
          { label: 'Visitor Name', value: name, highlight: true },
          { label: 'Company', value: company || 'N/A' },
          { label: 'Purpose', value: purpose },
          { label: 'Expected Arrival (IST)', value: formatIST(expected_arrival_time), highlight: true }
        ],
        actions: [
          { text: '✔', url: approveUrl, bg: '#059669', type: 'approve', title: 'Approve Visitor' },
          { text: '✕', url: declineUrl, bg: '#e11d48', type: 'decline', title: 'Decline or Propose New Time' }
        ],
        secondaryUrl: baseUrl,
        secondaryText: 'Open Host Portal',
        footerNote: '⚡ Click ✔ to Approve immediately, or ✕ to Decline / Propose a new time.'
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
  const hostToken = 'HTOKEN-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase() + crypto.randomBytes(4).toString('hex').toUpperCase();
  const validUntil = new Date(new Date(expected_arrival_time).getTime() + 8 * 3600000).toISOString();

  // If host themselves created the pass, it's auto approved!
  const isCreatedBySelf = (req.user.role === 'HOST' || req.user.role === 'EMPLOYEE' || req.user.role === 'CEO') && req.user.id === Number(host_id);
  const initialStatus = isCreatedBySelf ? 'APPROVED' : 'PENDING_HOST_REVIEW';

  const tx = db.transaction(() => {
    const r = db.prepare('INSERT INTO visitors(name,mobile,email,company,purpose,host_id,department,vehicle,consent) VALUES(?,?,?,?,?,?,?,?,1)').run(name, cleanMobile, email || '', company || '', purpose, host_id, department || '', vehicle || '');
    const vr = db.prepare('INSERT INTO visits(visitor_id,visitor_code,status,valid_until,expected_checkin,expected_checkout,initiator_type,expected_arrival_time,created_by,approved_by,pass_token,host_token) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(r.lastInsertRowid, code, initialStatus, validUntil, expected_arrival_time, validUntil, 'STAFF_CREATED', expected_arrival_time, req.user.id, isCreatedBySelf ? req.user.id : null, passToken, hostToken);
    db.prepare('INSERT INTO approvals(visit_id,host_id,status) VALUES(?,?,?)').run(vr.lastInsertRowid, host_id, isCreatedBySelf ? 'APPROVED' : 'PENDING');
    logPassStateChange(vr.lastInsertRowid, null, initialStatus, req.user.id, req.user.role, isCreatedBySelf ? 'Host pre-approved guest pass' : `Guest pass created by ${req.user.name} (${req.user.role})`);
    audit(req.user.id, 'PRE_CREATE_PASS', 'VISIT', vr.lastInsertRowid, code);
    return { id: r.lastInsertRowid, visitId: vr.lastInsertRowid, visitorCode: code, passToken, hostToken, status: initialStatus };
  });

  const out = tx();
  const hostUser = db.prepare('SELECT * FROM users WHERE id=?').get(host_id);

  if (!isCreatedBySelf) {
    // Alert host that staff created a pass on their behalf
    createNotification({
      user_id: host_id,
      type: 'STAFF_PASS_CREATED',
      title: '🎟️ Guest Pass Created on Your Behalf',
      message: `${req.user.name} created a pass for ${name} visiting you at ${formatIST(expected_arrival_time)}.`,
      link_id: out.visitId
    });

    if (hostUser && hostUser.email) {
      const baseUrl = getAppBaseUrl(req);
      const approveUrl = `${baseUrl}/api/public/quick-host-action?token=${hostToken}&action=APPROVE`;
      const declineUrl = `${baseUrl}/?hostToken=${hostToken}&action=DECLINE`;

      sendEmail({
        to: hostUser.email,
        subject: `[Swagatham VMS] Guest Pass Confirmation: ${name} is visiting you`,
        meta: { approveUrl, declineUrl, hostToken, visitId: out.visitId },
        html: buildEmailHtml({
          badgeText: 'CONFIRMATION REQUIRED',
          badgeBg: '#fef3c7',
          badgeColor: '#92400e',
          title: 'Guest Pass Created on Your Behalf',
          greeting: `Hello <strong>${hostUser.name}</strong>,`,
          messageHtml: `<p>A visitor pass was scheduled on your behalf. Please authorize or deny entry below:</p>`,
          details: [
            { label: 'Visitor Name', value: name, highlight: true },
            { label: 'Company', value: company || 'N/A' },
            { label: 'Purpose', value: purpose },
            { label: 'Expected Arrival (IST)', value: formatIST(expected_arrival_time), highlight: true }
          ],
          actions: [
            { text: '✔', url: approveUrl, bg: '#059669', type: 'approve', title: 'Approve Visitor' },
            { text: '✕', url: declineUrl, bg: '#e11d48', type: 'decline', title: 'Decline or Propose New Time' }
          ],
          secondaryUrl: baseUrl,
          secondaryText: 'Open Host Portal',
          footerNote: '⚡ Click ✔ to Approve immediately, or ✕ to Decline / Propose a new time.'
        })
      });
    }
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
      message: `Visitor accepted proposed arrival time (${formatIST(visit.proposed_arrival_time)}). Pass is now APPROVED.`,
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

// Host Zero-Login Direct Approval API (Public)
app.get('/api/public/host-approval/:token', (req, res) => {
  const visit = db.prepare(`
    SELECT x.id visit_id, x.visitor_code, x.status, x.valid_until, x.expected_arrival_time, x.proposed_arrival_time, x.expected_checkin,
           x.expected_checkout, x.rejection_reason, x.created_at visit_created_at, x.host_token,
           v.name visitor_name, v.mobile visitor_mobile, v.email visitor_email, v.company, v.purpose,
           v.department visitor_department, v.vehicle, v.photo,
           u.id host_id, u.name host_name, u.email host_email, u.department host_department, u.phone host_phone
    FROM visits x
    JOIN visitors v ON v.id = x.visitor_id
    LEFT JOIN users u ON u.id = v.host_id
    WHERE x.host_token = ?
  `).get(req.params.token);

  if (!visit) {
    return res.status(404).json({ message: 'Invalid or expired approval link.' });
  }

  const approval = db.prepare('SELECT * FROM approvals WHERE visit_id=? ORDER BY id DESC LIMIT 1').get(visit.visit_id);

  res.json({
    ...visit,
    approval_status: approval ? approval.status : visit.status,
    approval_notes: approval ? approval.notes : null,
    approval_action_time: approval ? approval.action_time : null
  });
});

app.post('/api/public/host-approval/:token', async (req, res) => {
  const visit = db.prepare(`
    SELECT x.id visit_id, x.visitor_code, x.status, x.expected_arrival_time, x.expected_checkin,
           x.host_token, x.pass_token,
           v.name visitor_name, v.mobile visitor_mobile, v.email visitor_email, v.company, v.purpose, v.host_id,
           u.id host_user_id, u.name host_name, u.email host_email
    FROM visits x
    JOIN visitors v ON v.id = x.visitor_id
    LEFT JOIN users u ON u.id = v.host_id
    WHERE x.host_token = ?
  `).get(req.params.token);

  if (!visit) {
    return res.status(404).json({ message: 'Invalid or expired approval link.' });
  }

  // Idempotency: check if already approved or rejected
  if (visit.status === 'APPROVED') {
    return res.status(400).json({
      message: 'This visit request has already been APPROVED.',
      status: 'APPROVED',
      visitor_name: visit.visitor_name,
      visitor_code: visit.visitor_code
    });
  }
  if (visit.status === 'REJECTED') {
    return res.status(400).json({
      message: 'This visit request has already been DECLINED.',
      status: 'REJECTED',
      visitor_name: visit.visitor_name
    });
  }

  const { action, notes, proposed_time } = req.body;
  if (!action || !['APPROVE', 'DECLINE', 'REJECT', 'PROPOSE_TIME'].includes(action)) {
    return res.status(400).json({ message: 'Valid action (APPROVE, DECLINE, or PROPOSE_TIME) is required.' });
  }

  const hostActorId = visit.host_id || visit.host_user_id || null;
  const hostName = visit.host_name || 'Host';

  if (action === 'APPROVE') {
    const newStatus = 'APPROVED';
    const noteText = (notes && notes.trim()) ? notes.trim() : 'Approved directly via email';

    db.prepare('UPDATE visits SET status=?, approved_by=? WHERE id=?').run(newStatus, hostActorId, visit.visit_id);
    db.prepare("UPDATE approvals SET status='APPROVED', action_time=CURRENT_TIMESTAMP, notes=? WHERE visit_id=?").run(noteText, visit.visit_id);
    logPassStateChange(visit.visit_id, visit.status, newStatus, hostActorId, 'HOST', noteText);
    audit(hostActorId || 0, 'EMAIL_APPROVE_VISIT', 'VISIT', visit.visit_id, `Approved by ${hostName} via email 1-tap`);

    // In-app alert to Guard & Receptionist
    createNotification({
      target_role: 'GUARD_RECEPTION',
      type: 'VISIT_APPROVED',
      title: '✅ Visitor Pass Approved',
      message: `${visit.visitor_name} has been approved by host ${hostName}.`,
      link_id: visit.visit_id
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
          messageHtml: `<p>Your host <strong>${hostName}</strong> has approved your visit request.</p>`,
          details: [
            { label: 'Visitor Pass Code', value: visit.visitor_code, highlight: true },
            { label: 'Host Name', value: hostName },
            { label: 'Expected Arrival (IST)', value: formatIST(visit.expected_arrival_time || visit.expected_checkin || new Date()), highlight: true }
          ],
          footerNote: 'Please present this Visitor Pass Code at reception upon arrival.'
        })
      }).catch(e => console.error('[VISITOR NOTIFY EMAIL ERROR]', e));
    }

    return res.json({
      success: true,
      status: 'APPROVED',
      message: `Visit for ${visit.visitor_name} has been approved successfully!`,
      visitor_name: visit.visitor_name,
      visitor_code: visit.visitor_code
    });
  } else if (action === 'PROPOSE_TIME') {
    if (!proposed_time) return res.status(400).json({ message: 'Proposed arrival time is required' });
    const newStatus = 'PENDING_VISITOR_CONFIRMATION';
    const noteText = (notes && notes.trim()) ? notes.trim() : `Counter time proposed: ${proposed_time}`;

    db.prepare('UPDATE visits SET status=?, proposed_arrival_time=? WHERE id=?').run(newStatus, proposed_time, visit.visit_id);
    db.prepare("UPDATE approvals SET status='PENDING', action_time=CURRENT_TIMESTAMP, notes=? WHERE visit_id=?").run(noteText, visit.visit_id);
    logPassStateChange(visit.visit_id, visit.status, newStatus, hostActorId, 'HOST', `Proposed counter time: ${proposed_time}`);
    audit(hostActorId || 0, 'EMAIL_PROPOSE_TIME', 'VISIT', visit.visit_id, proposed_time);

    // In-app alert to Guard & Receptionist
    createNotification({
      target_role: 'GUARD_RECEPTION',
      type: 'VISIT_RESCHEDULE_PROPOSED',
      title: '📅 Visit Reschedule Proposed by Host',
      message: `${visit.visitor_name}'s host proposed a new arrival time (${formatIST(proposed_time)}).`,
      link_id: visit.visit_id
    });

    // Notify Visitor via email
    if (visit.visitor_email) {
      const baseUrl = getAppBaseUrl(req);
      const confirmUrl = `${baseUrl}/?confirmToken=${visit.pass_token}`;
      sendEmail({
        to: visit.visitor_email,
        subject: `[Swagatham VMS] Host Proposed New Arrival Time: ${visit.visitor_name}`,
        html: buildEmailHtml({
          badgeText: 'RESCHEDULE PROPOSED',
          badgeBg: '#fffbeb',
          badgeColor: '#b45309',
          title: 'Host Proposed a New Meeting Time',
          greeting: `Dear <strong>${visit.visitor_name}</strong>,`,
          messageHtml: `<p>Your host <strong>${hostName}</strong> is not available at the requested time and has proposed a new arrival time:</p>`,
          details: [
            { label: 'Host Name', value: hostName },
            { label: 'New Proposed Arrival (IST)', value: formatIST(proposed_time), highlight: true }
          ],
          actionUrl: confirmUrl,
          actionText: 'Review & Confirm Reschedule',
          footerNote: 'Please click the link above to accept or decline this new proposed time.'
        })
      }).catch(e => console.error('[VISITOR NOTIFY EMAIL ERROR]', e));
    }

    return res.json({
      success: true,
      status: 'PENDING_VISITOR_CONFIRMATION',
      message: `Counter time proposal of ${formatIST(proposed_time)} sent to visitor.`,
      visitor_name: visit.visitor_name,
      proposed_time
    });
  } else {
    // DECLINE
    const newStatus = 'REJECTED';
    const reason = (notes && notes.trim()) ? notes.trim() : 'Declined by host via email';

    db.prepare('UPDATE visits SET status=?, rejection_reason=?, approved_by=? WHERE id=?').run(newStatus, reason, hostActorId, visit.visit_id);
    db.prepare("UPDATE approvals SET status='REJECTED', action_time=CURRENT_TIMESTAMP, notes=? WHERE visit_id=?").run(reason, visit.visit_id);
    logPassStateChange(visit.visit_id, visit.status, newStatus, hostActorId, 'HOST', reason);
    audit(hostActorId || 0, 'EMAIL_REJECT_VISIT', 'VISIT', visit.visit_id, `Declined by ${hostName} via email: ${reason}`);

    // In-app alert to Guard & Receptionist
    createNotification({
      target_role: 'GUARD_RECEPTION',
      type: 'VISIT_REJECTED',
      title: '❌ Visit Request Rejected',
      message: `${visit.visitor_name} was declined by host ${hostName}. Reason: ${reason}`,
      link_id: visit.visit_id
    });

    // Notify Visitor via email
    if (visit.visitor_email) {
      sendEmail({
        to: visit.visitor_email,
        subject: `[Swagatham VMS] Visitor Request Update: ${visit.visitor_name}`,
        html: buildEmailHtml({
          badgeText: 'REQUEST DECLINED',
          badgeBg: '#fef2f2',
          badgeColor: '#b91c1c',
          title: 'Visit Request Not Approved',
          greeting: `Dear <strong>${visit.visitor_name}</strong>,`,
          messageHtml: `<p>Your host <strong>${hostName}</strong> is unable to host this visit at the requested time.</p>`,
          details: [
            { label: 'Host Name', value: hostName },
            { label: 'Reason Provided', value: reason }
          ],
          footerNote: 'For inquiries or to reschedule, please contact your host or reception.'
        })
      }).catch(e => console.error('[VISITOR NOTIFY EMAIL ERROR]', e));
    }

    return res.json({
      success: true,
      status: 'REJECTED',
      message: `Visit request for ${visit.visitor_name} has been declined.`,
      visitor_name: visit.visitor_name
    });
  }
});

// Latest Generated Email Browser Endpoint (for local testing)
app.get('/api/public/email-preview/latest', (req, res) => {
  if (!lastSentEmail) {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Swagatham VMS - Email Preview</title>
        <style>body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; text-align: center; color: #475569; background: #f8fafc; }</style>
      </head>
      <body>
        <div style="max-width: 500px; margin: 40px auto; background: white; padding: 32px; border-radius: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.06);">
          <h2 style="color: #0f172a; margin-top: 0;">No Email Dispatched Yet</h2>
          <p>Register a visitor or pre-create a pass in the Swagatham application to trigger a host approval email.</p>
          <div style="margin-top: 24px;">
            <a href="/api/public/email-preview?type=host-approval" style="display: inline-block; background: #6d4ee8; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View Sample Host Approval Email</a>
          </div>
        </div>
      </body>
      </html>
    `);
  }
  const browserHtml = (lastSentEmail.html || '')
    .replace(/cid:swagatham_logo_text/g, '/email_logo_text.png')
    .replace(/cid:swagatham_watermark/g, '/email_watermark.png');
  res.setHeader('Content-Type', 'text/html');
  res.send(browserHtml);
});

// Futuristic Immediate Access Authorization Confirmation Renderer
function renderActionPage({
  status = 'APPROVED',
  title = 'Access Authorization',
  badgeText = '⚡ AUTHORIZED',
  visitorName = 'Visitor',
  visitorCode = null,
  company = 'N/A',
  purpose = 'Visit',
  hostName = 'Host',
  message = '',
  portalUrl = '/'
}) {
  const isApproved = status === 'APPROVED' || status === 'ALREADY_APPROVED';
  const isRejected = status === 'REJECTED' || status === 'ALREADY_REJECTED';
  const isError = status === 'ERROR';

  const themeColor = isApproved ? '#10b981' : (isRejected ? '#f43f5e' : '#64748b');
  const glowColor = isApproved ? 'rgba(16, 185, 129, 0.25)' : (isRejected ? 'rgba(244, 63, 94, 0.25)' : 'rgba(100, 116, 139, 0.2)');
  const icon = isApproved ? '⚡' : (isRejected ? '✕' : '⚠️');
  const actionTitle = isApproved ? 'ACCESS GRANTED' : (isRejected ? 'ACCESS DENIED' : title);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Swagatham VMS - ${actionTitle}</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@600;700&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #090d16;
    background-image: 
      radial-gradient(circle at 50% 12%, ${glowColor} 0%, transparent 60%),
      radial-gradient(circle at 20% 80%, rgba(109, 78, 232, 0.12) 0%, transparent 50%);
    font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;
    color: #f1f5f9;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px 16px;
  }
  .card {
    width: 100%;
    max-width: 480px;
    background: rgba(15, 23, 42, 0.82);
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 24px;
    padding: 36px 28px;
    box-shadow: 0 20px 50px rgba(0,0,0,0.6), 0 0 45px ${glowColor};
    text-align: center;
    position: relative;
    overflow: hidden;
  }
  .card::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0; height: 3px;
    background: linear-gradient(90deg, transparent, ${themeColor}, transparent);
  }
  .brand {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin-bottom: 22px;
  }
  .brand img {
    height: 36px;
    width: auto;
    filter: drop-shadow(0 2px 8px rgba(0,0,0,0.4));
  }
  .badge-status {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 7px 18px;
    border-radius: 9999px;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    background: ${isApproved ? 'rgba(16, 185, 129, 0.15)' : (isRejected ? 'rgba(244, 63, 94, 0.15)' : 'rgba(148, 163, 184, 0.15)')};
    color: ${themeColor};
    border: 1px solid ${themeColor};
    box-shadow: 0 0 16px ${glowColor};
    margin-bottom: 20px;
  }
  .pulse-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: ${themeColor};
    box-shadow: 0 0 8px ${themeColor};
    animation: vams-pulse 1.8s infinite;
  }
  @keyframes vams-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.4; transform: scale(0.85); }
  }
  .action-icon {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: ${isApproved ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.25), rgba(5, 150, 105, 0.45))' : 'linear-gradient(135deg, rgba(244, 63, 94, 0.25), rgba(225, 29, 72, 0.45))'};
    border: 1px solid ${themeColor};
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto 16px auto;
    font-size: 28px;
    color: #ffffff;
    box-shadow: 0 0 24px ${glowColor};
  }
  h1 {
    font-size: 24px;
    font-weight: 800;
    color: #ffffff;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
  }
  .desc {
    font-size: 14px;
    color: #94a3b8;
    line-height: 1.6;
    margin-bottom: 24px;
  }
  .desc strong {
    color: #f1f5f9;
  }
  .data-grid {
    background: rgba(30, 41, 59, 0.6);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 14px;
    padding: 16px 18px;
    margin-bottom: 24px;
    text-align: left;
  }
  .data-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    font-size: 13px;
  }
  .data-row:last-child {
    border-bottom: none;
    padding-bottom: 0;
  }
  .data-row:first-child {
    padding-top: 0;
  }
  .data-label {
    color: #64748b;
    font-weight: 600;
  }
  .data-val {
    color: #e2e8f0;
    font-weight: 700;
  }
  .pass-token-box {
    margin-top: 10px;
    padding: 10px 14px;
    border-radius: 8px;
    background: rgba(16, 185, 129, 0.12);
    border: 1px dashed #10b981;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .pass-token-label {
    font-size: 11px;
    color: #34d399;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
  }
  .pass-token-val {
    font-family: 'JetBrains Mono', monospace;
    font-size: 15px;
    color: #34d399;
    font-weight: 700;
  }
  .btn-portal {
    display: inline-block;
    width: 100%;
    padding: 12px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.15);
    color: #e2e8f0;
    font-size: 13px;
    font-weight: 700;
    text-decoration: none;
    transition: all 0.2s;
  }
  .btn-portal:hover {
    background: rgba(255, 255, 255, 0.14);
    color: #ffffff;
  }
  .footer-notice {
    margin-top: 18px;
    font-size: 11px;
    color: #64748b;
    line-height: 1.5;
  }
</style>
</head>
<body>
  <div class="card">
    <div class="brand">
      <img src="/email_logo_text.png" alt="Swagatham VMS" />
    </div>

    <div class="badge-status">
      <span class="pulse-dot"></span>
      <span>${badgeText}</span>
    </div>

    <div class="action-icon">
      ${icon}
    </div>

    <h1>${actionTitle}</h1>
    <div class="desc">${message}</div>

    ${!isError ? `
      <div class="data-grid">
        <div class="data-row">
          <span class="data-label">Visitor</span>
          <span class="data-val">${visitorName}</span>
        </div>
        ${company && company !== 'N/A' ? `
          <div class="data-row">
            <span class="data-label">Organization</span>
            <span class="data-val">${company}</span>
          </div>
        ` : ''}
        <div class="data-row">
          <span class="data-label">Purpose</span>
          <span class="data-val">${purpose}</span>
        </div>
        <div class="data-row">
          <span class="data-label">Host</span>
          <span class="data-val">${hostName}</span>
        </div>
        ${visitorCode && isApproved ? `
          <div class="pass-token-box">
            <span class="pass-token-label">Gate Pass Code</span>
            <span class="pass-token-val">${visitorCode}</span>
          </div>
        ` : ''}
      </div>
    ` : ''}

    <a href="${portalUrl}" class="btn-portal">Open OpsVision Console</a>

    <div class="footer-notice">
      🔒 Action recorded automatically in Swagatham Access System.<br>
      You may close this browser tab safely at any time.
    </div>
  </div>
</body>
</html>`;
}

// 1-Click Direct Host Action Endpoint (Zero Secondary Clicks Required)
app.get('/api/public/quick-host-action', async (req, res) => {
  const { token, action } = req.query;
  const baseUrl = getAppBaseUrl(req);
  const portalUrl = baseUrl;

  if (!token) {
    return res.status(400).send(renderActionPage({
      status: 'ERROR',
      title: 'Missing Authorization Token',
      message: 'No authorization token was provided in the link.',
      portalUrl
    }));
  }

  const visit = db.prepare(`
    SELECT x.id visit_id, x.visitor_code, x.status, x.expected_arrival_time, x.expected_checkin,
           x.host_token, x.pass_token,
           v.name visitor_name, v.mobile visitor_mobile, v.email visitor_email, v.company, v.purpose, v.host_id,
           u.id host_user_id, u.name host_name, u.email host_email, u.department host_department
    FROM visits x
    JOIN visitors v ON v.id = x.visitor_id
    LEFT JOIN users u ON u.id = v.host_id
    WHERE x.host_token = ?
  `).get(token);

  if (!visit) {
    return res.status(404).send(renderActionPage({
      status: 'ERROR',
      title: 'Invalid or Expired Link',
      message: 'This authorization link is invalid, expired, or has already been used.',
      portalUrl
    }));
  }

  const hostActorId = visit.host_id || visit.host_user_id || null;
  const hostName = visit.host_name || 'Host';

  // If already actioned previously
  if (visit.status === 'APPROVED') {
    return res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>✔ Already Approved</title>
        <style>
          body { margin: 0; padding: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 85vh; color: #0f172a; }
          .card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 32px 28px; text-align: center; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.06); max-width: 340px; width: 100%; box-sizing: border-box; }
          .icon { width: 56px; height: 56px; border-radius: 50%; background: #ecfdf5; color: #059669; font-size: 32px; font-weight: 900; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px auto; box-shadow: 0 4px 12px rgba(5,150,105,0.18); }
          h2 { margin: 0 0 8px 0; font-size: 20px; font-weight: 800; color: #0f172a; }
          p { margin: 0 0 20px 0; font-size: 13px; color: #64748b; line-height: 1.5; }
          .btn-close { background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 10px; padding: 10px 24px; font-size: 13px; font-weight: 700; color: #334155; cursor: pointer; }
          .btn-close:hover { background: #e2e8f0; }
        </style>
        <script>
          window.onload = function() {
            window.open('', '_self', '');
            window.close();
            setTimeout(function() { window.close(); }, 350);
          };
        </script>
      </head>
      <body>
        <div class="card">
          <div class="icon">✔</div>
          <h2>Already Approved</h2>
          <p>Pass for <strong>${visit.visitor_name || 'Visitor'}</strong> was previously approved.<br>This tab can now be closed.</p>
          <button class="btn-close" onclick="window.close()">Close Tab</button>
        </div>
      </body>
      </html>
    `);
  }

  // If action is DECLINE or not APPROVE, redirect immediately to decision page for reason / counter time
  if (action !== 'APPROVE') {
    return res.redirect(`${baseUrl}/?hostToken=${token}&action=DECLINE`);
  }

  // Fresh APPROVE action to execute immediately
  const newStatus = 'APPROVED';
  const noteText = 'Authorized directly via 1-click email action';

  db.prepare('UPDATE visits SET status=?, approved_by=? WHERE id=?').run(newStatus, hostActorId, visit.visit_id);
  db.prepare("UPDATE approvals SET status='APPROVED', action_time=CURRENT_TIMESTAMP, notes=? WHERE visit_id=?").run(noteText, visit.visit_id);
  logPassStateChange(visit.visit_id, visit.status, newStatus, hostActorId, 'HOST', noteText);
  audit(hostActorId || 0, 'EMAIL_QUICK_AUTHORIZE', 'VISIT', visit.visit_id, `Authorized by ${hostName} via 1-click email`);

  // In-app alert to Guard & Receptionist
  createNotification({
    target_role: 'GUARD_RECEPTION',
    type: 'VISIT_APPROVED',
    title: '✅ Visitor Pass Approved',
    message: `${visit.visitor_name} has been approved by host ${hostName}.`,
    link_id: visit.visit_id
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
        messageHtml: `<p>Your host <strong>${hostName}</strong> has authorized your visit request.</p>`,
        details: [
          { label: 'Visitor Pass Code', value: visit.visitor_code, highlight: true },
          { label: 'Host Name', value: hostName },
          { label: 'Expected Arrival (IST)', value: formatIST(visit.expected_arrival_time || visit.expected_checkin || new Date()), highlight: true }
        ],
        footerNote: 'Please present this Visitor Pass Code at reception upon arrival.'
      })
    }).catch(e => console.error('[VISITOR NOTIFY EMAIL ERROR]', e));
  }

  return res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>✔ Visit Approved</title>
      <style>
        body { margin: 0; padding: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 85vh; color: #0f172a; }
        .card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 32px 28px; text-align: center; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.06); max-width: 340px; width: 100%; box-sizing: border-box; }
        .icon { width: 56px; height: 56px; border-radius: 50%; background: #ecfdf5; color: #059669; font-size: 32px; font-weight: 900; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px auto; box-shadow: 0 4px 12px rgba(5,150,105,0.18); }
        h2 { margin: 0 0 8px 0; font-size: 20px; font-weight: 800; color: #0f172a; }
        p { margin: 0 0 20px 0; font-size: 13px; color: #64748b; line-height: 1.5; }
        .btn-close { background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 10px; padding: 10px 24px; font-size: 13px; font-weight: 700; color: #334155; cursor: pointer; transition: all 0.15s ease; }
        .btn-close:hover { background: #e2e8f0; }
      </style>
      <script>
        window.onload = function() {
          window.open('', '_self', '');
          window.close();
          setTimeout(function() { window.close(); }, 350);
        };
      </script>
    </head>
    <body>
      <div class="card">
        <div class="icon">✔</div>
        <h2>Visit Approved</h2>
        <p>Pass for <strong>${visit.visitor_name || 'Visitor'}</strong> is approved. Gate clearance is active.<br>This tab can now be closed.</p>
        <button class="btn-close" onclick="window.close()">Close Tab</button>
      </div>
    </body>
    </html>
  `);
});

// Visitor Entry Endpoint (Gate Check-In)
app.post('/api/visits/:id/entry', auth, roles('GUARD', 'RECEPTION', 'ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const visit = db.prepare('SELECT x.*, v.name visitor_name, v.email visitor_email, v.company visitor_company, v.purpose visitor_purpose, v.mobile visitor_mobile, v.host_id, u.name host_name, u.email host_email, u.department host_department FROM visits x JOIN visitors v ON v.id=x.visitor_id LEFT JOIN users u ON u.id=v.host_id WHERE x.id=?').get(req.params.id);
  if (!visit) return res.status(404).json({ message: 'Visit not found' });
  if (visit.status !== 'APPROVED') return res.status(400).json({ message: `Cannot check in. Visit status is ${visit.status}` });

  const entryTimeStr = formatIST(new Date());
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
    const demoToken = 'HTOKEN-DEMO-SAMPLE';
    const baseUrl = getAppBaseUrl(req);
    html = buildEmailHtml({
      badgeText: 'APPROVAL REQUIRED',
      badgeBg: '#eff6ff',
      badgeColor: '#1d4ed8',
      title: 'New Visitor Approval Request',
      greeting: 'Hello <strong>Colonel SG Jyothy</strong>,',
      messageHtml: '<p>A visitor has arrived / registered to meet you at reception. Please review and choose an action directly below:</p>',
      details: [
        { label: 'Visitor Name', value: 'Raghavendra M', highlight: true },
        { label: 'Company', value: 'Spandana Technologies' },
        { label: 'Purpose', value: 'Security Architecture Review' },
        { label: 'Registered At (IST)', value: formatIST(new Date()), highlight: true }
      ],
      actions: [
        { text: '✔', url: `${baseUrl}/api/public/quick-host-action?token=${demoToken}&action=APPROVE`, bg: '#059669', type: 'approve', title: 'Approve Visitor' },
        { text: '✕', url: `${baseUrl}/?hostToken=${demoToken}&action=DECLINE`, bg: '#e11d48', type: 'decline', title: 'Decline or Propose New Time' }
      ],
      secondaryUrl: baseUrl,
      secondaryText: 'Open Host Portal',
      footerNote: '⚡ Click ✔ to Approve immediately, or ✕ to Decline / Propose a new time.',
      logoTextSrc,
      watermarkSrc
    });
  }

  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

app.listen(process.env.PORT || 8000, () => console.log(`OpsVision VAMS API running on http://localhost:${process.env.PORT || 8000}`));
