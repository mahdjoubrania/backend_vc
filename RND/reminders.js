
const express = require('express');

const WINDOW_MIN = 10;          // نرسل عندما يكون الموعد خلال 10 دقائق أو أقل
const MIN_LEAD_MIN = 15;        // موعد حُجز قبل أقل من 15 د من وقته (زبون حاضر) => لا تذكير
const TICK_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 15000;

// أكواد أخطاء Meta المؤقتة (إعادة المحاولة) — أي شيء آخر يُعتبر نهائياً
const TRANSIENT_CODES = new Set([4, 80007, 130429, 131056, 131048, 2, 1]);

/* ---------- دوال نقية ---------- */
function normalizePhone(raw) {
  let d = String(raw == null ? '' : raw).replace(/[^\d+]/g, '');
  if (!d) return null;
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('213')) d = d.slice(3);
  else if (d.startsWith('0')) d = d.slice(1);
  d = d.replace(/^0+/, '');
  // أرقام جزائرية: 9 أرقام تبدأ بـ 5/6/7 (موبايل) أو 2/3/4 (ثابت)
  if (!/^[2-7]\d{8}$/.test(d)) return null;
  return '213' + d;
}

function cleanParam(v, fallback = '-') {
  let s = String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
  if (s.length > 60) s = s.slice(0, 57) + '...';
  return s || fallback;
}

function pad2(n) { return String(n).padStart(2, '0'); }

// "YYYY-MM-DD HH:MM:SS" بتوقيت الجزائر (UTC+1 بدون توقيت صيفي)
function algiersString(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Algiers', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(date).reduce((o, p) => { o[p.type] = p.value; return o; }, {});
  const hh = parts.hour === '24' ? '00' : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day} ${hh}:${parts.minute}:${parts.second}`;
}

// معاملات القالب بالترتيب: 1 اسم، 2 ساعة، 3 سيارة، 4 اسم، 5 ساعة، 6 سيارة (فرنسي ثم عربي)
function buildParams({ name, time, vehicle }) {
  const n = cleanParam(name, 'client');
  const t = cleanParam(time, '--:--');
  const v = cleanParam(vehicle, 'votre véhicule');
  return [n, t, v, n, t, v];
}

function buildPayload(cfg, to, params) {
  return {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: cfg.templateName,
      language: { code: cfg.templateLang },
      components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }]
    }
  };
}

function classifyError(status, body, networkErr) {
  if (networkErr) return { transient: true, message: String(networkErr.message || networkErr).slice(0, 200) };
  const err = (body && body.error) || {};
  const code = Number(err.code);
  const sub = Number(err.error_subcode);
  const msg = `${status}${code ? ' / ' + code : ''}${err.message ? ': ' + err.message : ''}`.slice(0, 250);
  if (status >= 500) return { transient: true, message: msg };
  if (TRANSIENT_CODES.has(code) || TRANSIENT_CODES.has(sub)) return { transient: true, message: msg };
  return { transient: false, message: msg };
}

function readConfig(env) {
  const mode = String(env.WHATSAPP_REMINDERS_MODE || 'off').toLowerCase();
  return {
    mode: ['live', 'dry-run'].includes(mode) ? mode : 'off',
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || '',
    token: env.WHATSAPP_ACCESS_TOKEN || '',
    templateName: env.WHATSAPP_TEMPLATE_NAME || 'rappel_rendez_vous',
    templateLang: env.WHATSAPP_TEMPLATE_LANG || 'fr',
    apiVersion: env.WHATSAPP_API_VERSION || 'v25.0'
  };
}

/* ---------- المصنع (قابل للاختبار بحقن db / fetch) ---------- */
function create({ db, fetchFn, env = process.env, log = console, nowFn = () => new Date() }) {
  let running = false;
  let columnsOk = null;                 // null = لم يُفحص بعد
  let warnedMissing = false;
  const dryLogged = new Set();
  const cfg = () => readConfig(env);

  async function sendTemplate(c, to, params) {
    if (!c.phoneNumberId || !c.token) {
      return { ok: false, transient: false, message: 'WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN غير مضبوطين' };
    }
    const url = `https://graph.facebook.com/${c.apiVersion}/${c.phoneNumberId}/messages`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetchFn(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload(c, to, params)),
        signal: ctrl.signal
      });
      let body = null;
      try { body = await res.json(); } catch (e) { /* رد غير JSON */ }
      if (res.ok && body && body.messages && body.messages[0]) {
        return { ok: true, messageId: String(body.messages[0].id || '').slice(0, 100) };
      }
      return Object.assign({ ok: false }, classifyError(res.status, body));
    } catch (e) {
      return Object.assign({ ok: false }, classifyError(0, null, e));
    } finally {
      clearTimeout(timer);
    }
  }

  async function checkColumns() {
    if (columnsOk === true) return true;
    try {
      await db.query('SELECT reminder_sent_at, reminder_status, reminder_error, reminder_message_id FROM appointments LIMIT 1');
      columnsOk = true;
    } catch (e) {
      if (e && (e.code === 'ER_BAD_FIELD_ERROR' || e.errno === 1054)) columnsOk = false;
      else throw e;
    }
    return columnsOk;
  }

  const BASE_SELECT = `
    SELECT a.id, c.full_name AS client_name, a.tlf AS phone,
           COALESCE(NULLIF(TRIM(CONCAT(COALESCE(v.make,''),' ',COALESCE(v.model,''))),''), NULL) AS vehicle_name,
           DATE_FORMAT(a.appointment_date, '%Y-%m-%d %H:%i:%s') AS appt_str,
           DATE_FORMAT(a.appointment_date, '%H:%i') AS appt_hm,
           TIMESTAMPDIFF(MINUTE, CONVERT_TZ(a.created_at, '+00:00', '+01:00'), a.appointment_date) AS lead_min
    FROM appointments a
    LEFT JOIN clients c ON a.client_id = c.id
    LEFT JOIN vehicules v ON a.vehicle_id = v.id`;

  async function sendOne(c, row, { force = false } = {}) {
    const to = normalizePhone(row.phone);
    if (!to) {
      await db.query("UPDATE appointments SET reminder_status='FAILED', reminder_error=? WHERE id=?", ['Numéro invalide: ' + String(row.phone || '').slice(0, 40), row.id]);
      return { ok: false, status: 'FAILED', message: 'رقم الهاتف غير صالح' };
    }
    const params = buildParams({ name: row.client_name, time: row.appt_hm, vehicle: row.vehicle_name });

    // claim ذري: يضمن عدم الإرسال مرتين حتى مع أكثر من نسخة سيرفر
    const where = force
      ? "id=? AND (reminder_status IS NULL OR reminder_status<>'SENDING')"
      : 'id=? AND reminder_sent_at IS NULL AND reminder_status IS NULL';
    const [claim] = await db.query(`UPDATE appointments SET reminder_status='SENDING', reminder_error=NULL WHERE ${where}`, [row.id]);
    if (!claim || claim.affectedRows !== 1) return { ok: false, status: 'SKIPPED', message: 'تمت معالجته مسبقاً' };

    const r = await sendTemplate(c, to, params);
    if (r.ok) {
      await db.query("UPDATE appointments SET reminder_status='SENT', reminder_sent_at=CONVERT_TZ(NOW(),'+00:00','+01:00'), reminder_message_id=?, reminder_error=NULL WHERE id=?", [r.messageId, row.id]);
      log.log(`[reminders] SENT id=${row.id} to=${to}`);
      return { ok: true, status: 'SENT' };
    }
    if (r.transient && !force) {
      await db.query('UPDATE appointments SET reminder_status=NULL, reminder_error=? WHERE id=?', [r.message, row.id]);
      log.warn(`[reminders] transient failure id=${row.id}: ${r.message} (retry next tick)`);
      return { ok: false, status: 'RETRY', message: r.message };
    }
    await db.query("UPDATE appointments SET reminder_status='FAILED', reminder_error=? WHERE id=?", [r.message.slice(0, 255), row.id]);
    log.error(`[reminders] FAILED id=${row.id}: ${r.message}`);
    return { ok: false, status: 'FAILED', message: r.message };
  }

  async function tick() {
    const c = cfg();
    if (c.mode === 'off' || running) return;
    running = true;
    try {
      const ok = await checkColumns();
      if (!ok && c.mode === 'live') {
        if (!warnedMissing) { warnedMissing = true; log.error('[reminders] أعمدة reminder_* غير موجودة: شغّل phase_whatsapp_reminders.sql ثم أعد التشغيل. التذكير متوقف.'); }
        return;
      }
      const now = nowFn();
      const nowStr = algiersString(now);
      const endStr = algiersString(new Date(now.getTime() + WINDOW_MIN * 60000));
      const filter = ok ? 'AND a.reminder_sent_at IS NULL AND a.reminder_status IS NULL' : '';
      const [rows] = await db.query(
        `${BASE_SELECT}
         WHERE a.status IN ('PENDING','READY_FOR_WORKSHOP')
           AND a.appointment_date > ? AND a.appointment_date <= ?
           AND a.tlf IS NOT NULL AND TRIM(a.tlf) <> '' ${filter}`, [nowStr, endStr]);

      for (const row of rows) {
        if (c.mode === 'dry-run') {
          if (dryLogged.has(row.id)) continue;
          dryLogged.add(row.id);
          log.log(`[reminders][DRY-RUN] id=${row.id} to=${normalizePhone(row.phone)} params=${JSON.stringify(buildParams({ name: row.client_name, time: row.appt_hm, vehicle: row.vehicle_name }))}`);
          continue;
        }
        if (row.lead_min !== null && row.lead_min !== undefined && Number(row.lead_min) < MIN_LEAD_MIN) {
          await db.query("UPDATE appointments SET reminder_status='SKIPPED', reminder_error='Rendez-vous pris moins de 15 min avant' WHERE id=? AND reminder_status IS NULL", [row.id]);
          continue;
        }
        try { await sendOne(c, row); } catch (e) { log.error('[reminders] erreur sur id=' + row.id, e.message); }
      }
    } catch (e) {
      log.error('[reminders] tick error:', e && e.message);
    } finally {
      running = false;
    }
  }

  let timer = null;
  function start() {
    if (timer) return;
    const c = cfg();
    log.log(`[reminders] mode=${c.mode}`);
    if (c.mode === 'off') return;
    const first = setTimeout(tick, 5000); if (first.unref) first.unref();
    timer = setInterval(tick, TICK_MS);
    if (timer.unref) timer.unref();
  }

  /* ---------- Express router ---------- */
  function buildRouter(verifyToken, requireRole) {
    const router = express.Router();

    router.get('/appointments/reminders-today', requireRole('ADMIN', 'RECEPTION'), async (req, res) => {
      const c = cfg();
      try {
        const [rows] = await db.query(`SELECT id, reminder_status, reminder_sent_at, reminder_error
          FROM appointments WHERE DATE(appointment_date) = DATE(CONVERT_TZ(NOW(), '+00:00', '+01:00'))`);
        res.json({ mode: c.mode, items: rows });
      } catch (e) {
        res.json({ mode: c.mode, items: [], migrationNeeded: !!(e && e.code === 'ER_BAD_FIELD_ERROR') });
      }
    });

    router.post('/appointments/:id/reminder', requireRole('ADMIN', 'RECEPTION'), async (req, res) => {
      const c = cfg();
      if (c.mode === 'off') return res.status(400).json({ message: 'Les rappels WhatsApp sont désactivés.' });
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'ID invalide.' });
      try {
        if (!(await checkColumns())) return res.status(500).json({ message: 'Migration SQL requise (phase_whatsapp_reminders.sql).' });
        const [rows] = await db.query(`${BASE_SELECT} WHERE a.id = ?`, [id]);
        if (!rows.length) return res.status(404).json({ message: 'Rendez-vous introuvable.' });
        if (c.mode === 'dry-run') return res.json({ message: 'Mode test (dry-run) : rien envoyé.', dryRun: true });
        const r = await sendOne(c, rows[0], { force: true });
        if (r.ok) return res.json({ message: 'Rappel envoyé.' });
        return res.status(r.status === 'SKIPPED' ? 409 : 502).json({ message: 'Échec : ' + r.message });
      } catch (e) {
        log.error('[reminders] resend error:', e && e.message);
        res.status(500).json({ message: 'Erreur serveur.' });
      }
    });

    router.get('/whatsapp/status', requireRole('ADMIN'), (req, res) => {
      const c = cfg();
      res.json({ mode: c.mode, hasPhoneNumberId: !!c.phoneNumberId, hasToken: !!c.token,
        template: c.templateName, lang: c.templateLang, apiVersion: c.apiVersion });
    });

    router.post('/whatsapp/test', requireRole('ADMIN'), async (req, res) => {
      const c = cfg();
      const to = normalizePhone(req.body && req.body.phone);
      if (!to) return res.status(400).json({ message: 'Numéro invalide.' });
      const r = await sendTemplate(c, to, buildParams({ name: 'Test', time: '10:00', vehicle: 'Véhicule test' }));
      if (r.ok) return res.json({ message: 'Message de test envoyé.', messageId: r.messageId });
      res.status(502).json({ message: 'Échec : ' + r.message });
    });

    return router;
  }

  return { tick, start, sendOne, buildRouter, _state: () => ({ columnsOk, dryLogged }) };
}

let _default = null;
function getDefault() {
  if (!_default) {
    _default = create({ db: require('../config/db'), fetchFn: (...a) => fetch(...a) });
  }
  return _default;
}

module.exports = {
  create, getDefault, normalizePhone, buildParams, buildPayload, classifyError, algiersString, readConfig, cleanParam,
  start: () => getDefault().start(),
  buildRouter: (...a) => getDefault().buildRouter(...a)
};