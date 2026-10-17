// =========================================================
// VérifCar — Avis clients (vrais clients uniquement, modérés par l'ADMIN)
//
// Parcours :
//  1. Inspection TERMINÉE → la réception clique « Demander un avis » sur le rapport
//     GET /api/inspection/review-link/:id → lien unique review.html?t=TOKEN (+ lien WhatsApp)
//  2. Le client ouvre le lien : GET /api/public/reviews/invite/:token, puis
//     POST /api/public/reviews { token, rating, comment, display_name, lang } → statut PENDING
//  3. L'admin approuve / refuse : GET /api/admin/reviews, PUT /api/admin/reviews/:id
//  4. Le site affiche les avis APPROUVÉS : GET /api/public/reviews
//
// Un seul avis par inspection ; aucun avis possible sans lien d'invitation.
// L'admin ne peut PAS modifier le texte d'un avis (seulement l'approuver ou le refuser).
// Table "reviews" créée automatiquement au premier appel.
// =========================================================
const crypto = require('crypto');
const db = require('../config/db');
const reminders = require('../RND/reminders');          // normalizePhone → format WhatsApp 213XXXXXXXXX

const SITE_URL = () => String(process.env.PUBLIC_SITE_URL || 'https://www.verifcar.dz').replace(/\/+$/, '');
const TOKEN_RE = /^[A-Za-z0-9_-]{16}$/;
const clean = (v, max) => String(v == null ? '' : v)
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
  .replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
const firstName = (n) => { const f = String(n || '').trim().split(/\s+/)[0] || ''; return f ? f.charAt(0).toUpperCase() + f.slice(1).toLowerCase() : ''; };
const err500 = (res, where, e) => { console.error(where, e); res.status(500).json({ success: false, message: 'Erreur serveur.' }); };

let tableReady = null;
function ensureTable() {
  if (!tableReady) {
    tableReady = db.query(
      `CREATE TABLE IF NOT EXISTS reviews (
         id             INT AUTO_INCREMENT PRIMARY KEY,
         inspection_id  BIGINT UNSIGNED NOT NULL,
         token          CHAR(16)     NOT NULL,
         author_name    VARCHAR(60)  NULL,
         vehicle        VARCHAR(80)  NULL,
         rating         TINYINT      NULL,
         comment        VARCHAR(600) NULL,
         lang           CHAR(2)      NULL,
         status         ENUM('INVITED','PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'INVITED',
         created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
         submitted_at   DATETIME     NULL,
         moderated_by   INT          NULL,
         moderated_at   DATETIME     NULL,
         client_ip      VARCHAR(45)  NULL,
         UNIQUE KEY uq_reviews_inspection (inspection_id),
         UNIQUE KEY uq_reviews_token (token),
         KEY idx_reviews_status (status, submitted_at)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    ).catch((e) => { tableReady = null; throw e; });
  }
  return tableReady;
}

/* ===================== STAFF : lien d'invitation ===================== */

// GET /api/inspection/review-link/:id   (id = n° d'inspection ou de rendez-vous)
exports.staffInvite = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'ID invalide.' });
    const sel = `SELECT i.id, i.status, c.full_name, COALESCE(NULLIF(c.phone, ''), a.tlf) AS phone, v.make, v.model
                 FROM inspections i
                 LEFT JOIN appointments a ON a.id = i.appointment_id
                 LEFT JOIN clients c ON c.id = a.client_id
                 LEFT JOIN vehicules v ON v.id = a.vehicle_id`;
    let [rows] = await db.query(`${sel} WHERE i.id = ? LIMIT 1`, [id]);
    if (!rows.length) [rows] = await db.query(`${sel} WHERE i.appointment_id = ? LIMIT 1`, [id]);
    if (!rows.length) return res.status(404).json({ message: 'Inspection introuvable.' });
    const insp = rows[0];
    if (String(insp.status).toUpperCase() !== 'COMPLETED') return res.status(409).json({ message: 'L\'inspection n\'est pas encore terminée.' });

    await ensureTable();
    let [found] = await db.query('SELECT token, status FROM reviews WHERE inspection_id = ?', [insp.id]);
    if (!found.length) {
      const vehicle = clean([insp.make, insp.model && insp.model !== 'Inconnu' ? insp.model : ''].filter(Boolean).join(' '), 80) || null;
      for (let i = 0; i < 3 && !found.length; i++) {
        try {
          await db.query('INSERT INTO reviews (inspection_id, token, vehicle) VALUES (?, ?, ?)',
            [insp.id, crypto.randomBytes(12).toString('base64url'), vehicle]);
        } catch (e) { if (!(e && e.code === 'ER_DUP_ENTRY')) throw e; }
        [found] = await db.query('SELECT token, status FROM reviews WHERE inspection_id = ?', [insp.id]);
      }
    }
    if (!found.length) return res.status(500).json({ message: 'Erreur serveur.' });

    const url = `${SITE_URL()}/review.html?t=${found[0].token}`;
    const name = firstName(insp.full_name);
    const text = `Bonjour ${name}, merci d'avoir choisi VérifCar ! Votre avis compte beaucoup pour nous (1 minute) : ${url}\n\n` +
                 `مرحباً ${name}، شكراً لاختيارك VérifCar! رأيك يهمنا كثيراً (دقيقة واحدة): ${url}`;
    const to = reminders.normalizePhone(insp.phone);
    res.json({
      url,
      status: found[0].status,                       // INVITED = pas encore répondu
      wa_link: to ? `https://wa.me/${to}?text=${encodeURIComponent(text)}` : null,
      text
    });
  } catch (e) { err500(res, 'staffInvite', e); }
};

/* ===================== PUBLIC ===================== */

// GET /api/public/reviews/invite/:token
exports.publicInvite = async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const token = String(req.params.token || '');
    if (!TOKEN_RE.test(token)) return res.status(400).json({ success: false, code: 'INVALID' });
    await ensureTable();
    const [rows] = await db.query(
      `SELECT r.status, r.vehicle, c.full_name
       FROM reviews r
       LEFT JOIN inspections i ON i.id = r.inspection_id
       LEFT JOIN appointments a ON a.id = i.appointment_id
       LEFT JOIN clients c ON c.id = a.client_id
       WHERE r.token = ? LIMIT 1`, [token]);
    if (!rows.length) return res.status(404).json({ success: false, code: 'NOT_FOUND' });
    const fn = firstName(rows[0].full_name);
    res.json({
      success: true,
      first_name: fn,
      vehicle: rows[0].vehicle,
      can_submit: rows[0].status === 'INVITED',
      suggested_name: fn
    });
  } catch (e) { err500(res, 'publicInvite', e); }
};

// POST /api/public/reviews  { token, rating, comment, display_name, lang }
exports.publicSubmit = async (req, res) => {
  try {
    const b = req.body || {};
    const token = String(b.token || '');
    if (!TOKEN_RE.test(token)) return res.status(400).json({ success: false, code: 'INVALID' });
    const rating = Number(b.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ success: false, code: 'RATING' });
    const comment = clean(b.comment, 600);
    if (comment.length < 10) return res.status(400).json({ success: false, code: 'COMMENT' });
    let name = clean(String(b.display_name || '').replace(/\s+/g, ' '), 40);
    if (name.length < 2) return res.status(400).json({ success: false, code: 'NAME' });
    const lang = ['fr', 'ar', 'en'].includes(b.lang) ? b.lang : 'fr';
    if (b.website) return res.json({ success: true });            // pot de miel anti-robot

    await ensureTable();
    const [r] = await db.query(
      `UPDATE reviews SET rating = ?, comment = ?, author_name = ?, lang = ?, status = 'PENDING',
              submitted_at = CONVERT_TZ(NOW(), '+00:00', '+01:00'), client_ip = ?
       WHERE token = ? AND status = 'INVITED'`,
      [rating, comment, name, lang, String(req.ip || '').slice(0, 45), token]
    );
    if (!r.affectedRows) {
      const [ex] = await db.query('SELECT status FROM reviews WHERE token = ?', [token]);
      return res.status(ex.length ? 409 : 404).json({ success: false, code: ex.length ? 'ALREADY' : 'NOT_FOUND' });
    }
    res.json({ success: true });
  } catch (e) { err500(res, 'publicSubmit', e); }
};

// GET /api/public/reviews   → avis approuvés + moyenne
exports.publicList = async (req, res) => {
  try {
    await ensureTable();
    const [[stats]] = await db.query("SELECT COUNT(*) AS count, AVG(rating) AS avg FROM reviews WHERE status = 'APPROVED'");
    const [rows] = await db.query(
      `SELECT author_name, vehicle, rating, comment, lang, DATE_FORMAT(submitted_at, '%Y-%m-%d') AS date
       FROM reviews WHERE status = 'APPROVED'
       ORDER BY submitted_at DESC LIMIT 12`);
    res.set('Cache-Control', 'public, max-age=120');
    res.json({
      count: Number(stats.count) || 0,
      average: stats.avg === null ? null : Math.round(Number(stats.avg) * 10) / 10,
      reviews: rows.map((r) => ({ ...r, rating: Number(r.rating) }))
    });
  } catch (e) { err500(res, 'publicList', e); }
};

/* ===================== ADMIN : modération ===================== */

// GET /api/admin/reviews?status=PENDING|APPROVED|REJECTED|INVITED|ALL
exports.adminList = async (req, res) => {
  try {
    await ensureTable();
    const status = String(req.query.status || 'PENDING').toUpperCase();
    const params = [];
    let where = '';
    if (status !== 'ALL') {
      if (!['PENDING', 'APPROVED', 'REJECTED', 'INVITED'].includes(status)) return res.status(400).json({ message: 'Statut invalide.' });
      where = 'WHERE r.status = ?'; params.push(status);
    }
    const [rows] = await db.query(
      `SELECT r.id, r.inspection_id, r.author_name, r.vehicle, r.rating, r.comment, r.lang, r.status,
              r.created_at, r.submitted_at, r.moderated_at, u.full_name AS moderated_by_name,
              c.full_name AS client_name, c.phone AS client_phone
       FROM reviews r
       LEFT JOIN users u ON u.id = r.moderated_by
       LEFT JOIN inspections i ON i.id = r.inspection_id
       LEFT JOIN appointments a ON a.id = i.appointment_id
       LEFT JOIN clients c ON c.id = a.client_id
       ${where}
       ORDER BY COALESCE(r.submitted_at, r.created_at) DESC
       LIMIT 300`, params);
    const [counts] = await db.query('SELECT status, COUNT(*) AS n FROM reviews GROUP BY status');
    const byStatus = { INVITED: 0, PENDING: 0, APPROVED: 0, REJECTED: 0 };
    counts.forEach((c) => { byStatus[c.status] = Number(c.n); });
    res.json({ reviews: rows, counts: byStatus });
  } catch (e) { err500(res, 'adminList', e); }
};

// PUT /api/admin/reviews/:id   { status: 'APPROVED' | 'REJECTED' }
exports.adminModerate = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const status = String(req.body?.status || '').toUpperCase();
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'ID invalide.' });
    if (!['APPROVED', 'REJECTED'].includes(status)) return res.status(400).json({ message: 'Statut invalide.' });
    await ensureTable();
    const [r] = await db.query(
      `UPDATE reviews SET status = ?, moderated_by = ?, moderated_at = CONVERT_TZ(NOW(), '+00:00', '+01:00')
       WHERE id = ? AND status IN ('PENDING', 'APPROVED', 'REJECTED')`,
      [status, req.user?.id || null, id]);
    if (!r.affectedRows) return res.status(404).json({ message: 'Avis introuvable (ou pas encore rédigé par le client).' });
    res.json({ success: true });
  } catch (e) { err500(res, 'adminModerate', e); }
};
