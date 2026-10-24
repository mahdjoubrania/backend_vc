// =========================================================
// VérifCar — Avis clients = avis GOOGLE MAPS
//
// Parcours :
//  1. Inspection TERMINÉE → « Demander un avis » sur le rapport
//     GET /api/inspection/review-link/:id → lien de NOTRE site : <site>/review.html?t=TOKEN (+ WhatsApp)
//  2. Le client ouvre le lien → la page enregistre le clic (POST /api/public/review-click)
//     puis l'envoie sur la page « Écrire un avis » de notre fiche Google Maps
//  3. Le site affiche la note, le nombre d'avis et les 5 derniers avis Google : GET /api/public/google-reviews
//  4. L'admin voit les statistiques : GET /api/admin/reviews/stats
//
// Les avis sont écrits et publiés par Google (pas de modération ni de faux avis possibles chez nous).
// Table "review_requests" (liens envoyés / cliqués) créée automatiquement.
// =========================================================
const crypto = require('crypto');
const db = require('../config/db');
const reminders = require('../RND/reminders');          // normalizePhone → format WhatsApp 213XXXXXXXXX
const google = require('./google-places');

const SITE_URL = () => String(process.env.PUBLIC_SITE_URL || 'https://www.verifcar.dz').replace(/\/+$/, '');
const TOKEN_RE = /^[A-Za-z0-9_-]{16}$/;
const firstName = (n) => { const f = String(n || '').trim().split(/\s+/)[0] || ''; return f ? f.charAt(0).toUpperCase() + f.slice(1).toLowerCase() : ''; };
const err500 = (res, where, e) => { console.error(where, e); res.status(500).json({ success: false, message: 'Erreur serveur.' }); };

let tableReady = null;
function ensureTable() {
  if (!tableReady) {
    tableReady = db.query(
      `CREATE TABLE IF NOT EXISTS review_requests (
         id             INT AUTO_INCREMENT PRIMARY KEY,
         inspection_id  BIGINT UNSIGNED NOT NULL,
         token          CHAR(16)     NOT NULL,
         sent_count     INT          NOT NULL DEFAULT 1,
         created_by     INT          NULL,
         created_at     DATETIME     NOT NULL,
         last_sent_at   DATETIME     NOT NULL,
         clicked_at     DATETIME     NULL,
         click_count    INT          NOT NULL DEFAULT 0,
         UNIQUE KEY uq_rr_inspection (inspection_id),
         UNIQUE KEY uq_rr_token (token),
         KEY idx_rr_created (created_at)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    ).catch((e) => { tableReady = null; throw e; });
  }
  return tableReady;
}
const NOW_DZ = "CONVERT_TZ(NOW(), '+00:00', '+01:00')";

/* ===================== STAFF : lien à envoyer au client ===================== */

// GET /api/inspection/review-link/:id   (id = n° d'inspection uniquement)
exports.staffInvite = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'ID invalide.' });
    if (!google.writeReviewUrl()) {
      return res.status(503).json({ message: 'Lien Google non configuré : renseignez GOOGLE_PLACE_ID (ou GOOGLE_REVIEW_URL) dans le fichier .env du serveur.' });
    }
    const [rows] = await db.query(
      `SELECT i.id, i.status, c.full_name, COALESCE(NULLIF(c.phone, ''), a.tlf) AS phone
       FROM inspections i
       LEFT JOIN appointments a ON a.id = i.appointment_id
       LEFT JOIN clients c ON c.id = a.client_id
       WHERE i.id = ? LIMIT 1`, [id]);
    if (!rows.length) return res.status(404).json({ message: 'Inspection introuvable.' });
    const insp = rows[0];
    if (String(insp.status).toUpperCase() !== 'COMPLETED') return res.status(409).json({ message: 'L\'inspection n\'est pas encore terminée.' });

    await ensureTable();
    let [found] = await db.query('SELECT token, clicked_at FROM review_requests WHERE inspection_id = ?', [insp.id]);
    if (found.length) {
      await db.query(`UPDATE review_requests SET sent_count = sent_count + 1, last_sent_at = ${NOW_DZ} WHERE inspection_id = ?`, [insp.id]);
    } else {
      for (let i = 0; i < 3 && !found.length; i++) {
        try {
          await db.query(
            `INSERT INTO review_requests (inspection_id, token, created_by, created_at, last_sent_at) VALUES (?, ?, ?, ${NOW_DZ}, ${NOW_DZ})`,
            [insp.id, crypto.randomBytes(12).toString('base64url'), req.user ? req.user.id : null]);
        } catch (e) { if (!(e && e.code === 'ER_DUP_ENTRY')) throw e; }
        [found] = await db.query('SELECT token, clicked_at FROM review_requests WHERE inspection_id = ?', [insp.id]);
      }
    }
    if (!found.length) return res.status(500).json({ message: 'Erreur serveur.' });

    const url = `${SITE_URL()}/review.html?t=${found[0].token}`;
    const name = firstName(insp.full_name);
    const text = `Bonjour ${name}, merci d'avoir choisi VérifCar ! Votre avis sur Google nous aide beaucoup (1 minute) : ${url}\n\n` +
                 `مرحباً ${name}، شكراً لاختيارك VérifCar! رأيك على Google يساعدنا كثيراً (دقيقة واحدة): ${url}`;
    const to = reminders.normalizePhone(insp.phone);
    res.json({
      url,
      status: found[0].clicked_at ? 'CLICKED' : 'SENT',   // CLICKED = le client a déjà ouvert le lien
      wa_link: to ? `https://wa.me/${to}?text=${encodeURIComponent(text)}` : null,
      text
    });
  } catch (e) { err500(res, 'staffInvite', e); }
};

/* ===================== PUBLIC ===================== */

// POST /api/public/review-click { token } → enregistre le clic et renvoie l'adresse Google « Écrire un avis »
exports.publicClick = async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const target = google.writeReviewUrl();
  if (!target) return res.status(503).json({ success: false, code: 'NOT_CONFIGURED' });
  try {
    const token = String((req.body && req.body.token) || '');
    if (TOKEN_RE.test(token)) {
      await ensureTable();
      await db.query(
        `UPDATE review_requests SET click_count = click_count + 1, clicked_at = COALESCE(clicked_at, ${NOW_DZ}) WHERE token = ?`,
        [token]);
    }
  } catch (e) {
    console.error('publicClick:', e.message);   // le client est quand même redirigé vers Google
  }
  res.json({ success: true, url: target });
};

// GET /api/public/google-reviews → note, nombre d'avis, 5 avis (ou { configured:false })
exports.publicGoogle = async (req, res) => {
  try {
    const g = await google.get();
    res.set('Cache-Control', 'public, max-age=600');
    if (!g.configured || g.unavailable) return res.json({ configured: !!g.configured, available: false });
    res.json({
      configured: true, available: true,
      rating: g.rating, count: g.count,
      maps_url: google.mapsUrl(g), write_review_url: google.writeReviewUrl(),
      reviews: g.reviews
    });
  } catch (e) { err500(res, 'publicGoogle', e); }
};

/* ===================== ADMIN : statistiques ===================== */

// GET /api/admin/reviews/stats[?refresh=1]
exports.adminStats = async (req, res) => {
  try {
    const g = await google.get({ force: req.query.refresh === '1' });
    const hist = await google.history(365);

    // évolution du nombre d'avis Google
    const now = hist.length ? hist[hist.length - 1] : null;
    const countAt = (days) => {
      const d = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
      const before = hist.filter((h) => h.date <= d);
      return before.length ? before[before.length - 1].count : (hist.length ? hist[0].count : null);
    };
    const monthStart = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Algiers' }).format(new Date()).slice(0, 8) + '01';
    const firstOfMonth = hist.filter((h) => h.date < monthStart);
    const baseMonth = firstOfMonth.length ? firstOfMonth[firstOfMonth.length - 1].count : (hist.length ? hist[0].count : null);
    const current = g.count != null ? g.count : (now ? now.count : null);

    await ensureTable();
    const [[tot]] = await db.query(
      `SELECT COUNT(*) AS sent, SUM(clicked_at IS NOT NULL) AS clicked,
              SUM(created_at >= DATE_SUB(${NOW_DZ}, INTERVAL 30 DAY)) AS sent30,
              SUM(clicked_at IS NOT NULL AND created_at >= DATE_SUB(${NOW_DZ}, INTERVAL 30 DAY)) AS clicked30
       FROM review_requests`);
    const [[done30]] = await db.query(
      `SELECT COUNT(*) AS n FROM inspections WHERE status = 'COMPLETED' AND updated_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`);
    const [recent] = await db.query(
      `SELECT r.inspection_id, r.created_at, r.last_sent_at, r.sent_count, r.clicked_at, r.click_count,
              c.full_name AS client_name, v.make, v.model, u.full_name AS sent_by
       FROM review_requests r
       LEFT JOIN inspections i ON i.id = r.inspection_id
       LEFT JOIN appointments a ON a.id = i.appointment_id
       LEFT JOIN clients c ON c.id = a.client_id
       LEFT JOIN vehicules v ON v.id = a.vehicle_id
       LEFT JOIN users u ON u.id = r.created_by
       ORDER BY r.last_sent_at DESC
       LIMIT 30`);

    const n = (v) => Number(v) || 0;
    res.json({
      google: {
        configured: !!g.configured,
        available: !!(g.configured && !g.unavailable),
        rating: g.rating == null ? null : g.rating,
        count: current,
        new_this_month: current != null && baseMonth != null ? Math.max(0, current - baseMonth) : null,
        new_30d: current != null && countAt(30) != null ? Math.max(0, current - countAt(30)) : null,
        maps_url: google.mapsUrl(g),
        write_review_url: google.writeReviewUrl(),
        reviews: g.reviews || [],
        fetched_at: g.fetched_at || null,
        error: google.lastError()
      },
      history: hist,
      requests: {
        sent: n(tot.sent), clicked: n(tot.clicked),
        sent_30d: n(tot.sent30), clicked_30d: n(tot.clicked30),
        completed_inspections_30d: n(done30.n)
      },
      recent: recent.map((r) => ({
        inspection_id: r.inspection_id,
        client_name: r.client_name,
        vehicle: [r.make, r.model && r.model !== 'Inconnu' ? r.model : ''].filter(Boolean).join(' '),
        sent_at: r.last_sent_at, first_sent_at: r.created_at, sent_count: r.sent_count,
        clicked_at: r.clicked_at, click_count: r.click_count, sent_by: r.sent_by
      }))
    });
  } catch (e) { err500(res, 'adminStats', e); }
};
