// =========================================================
// Écran TV de la salle d'attente — lecture seule
//  GET /api/display/today   en-tête  X-Display-Key: <DISPLAY_KEY du fichier .env>
// Aucun compte du personnel sur la TV : la clé ne donne accès qu'à cette liste,
// avec le minimum d'informations (prénom + initiale, véhicule, plaque partielle, heure, statut).
// =========================================================
const express = require('express');
const crypto = require('crypto');
const rateLimit = require('../middleware/rate-limit');
const db = require('../config/db');

const router = express.Router();

const limiter = rateLimit({
  windowMs: 60 * 1000, limit: 60,
  message: { success: false, code: 'RATE_LIMIT' }
});

function keyOk(given) {
  const expected = String(process.env.DISPLAY_KEY || '');
  if (expected.length < 16 || !given) return false;
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

// "Karim Benali" → "Karim B."
function shortName(full) {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  const first = parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase();
  return parts.length > 1 ? `${first} ${parts[parts.length - 1].charAt(0).toUpperCase()}.` : first;
}

// plaque partiellement masquée : seuls les 5 derniers caractères restent visibles
function maskPlate(p) {
  const s = String(p || '').trim();
  if (!s) return null;
  return s.length <= 5 ? s : '•••' + s.slice(-5);
}

router.get('/today', limiter, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!process.env.DISPLAY_KEY) return res.status(503).json({ success: false, code: 'NOT_CONFIGURED' });
  if (!keyOk(req.get('X-Display-Key'))) return res.status(401).json({ success: false, code: 'BAD_KEY' });
  try {
    const [rows] = await db.query(`
      SELECT a.id, c.full_name, v.make, v.model, v.license_plate,
             a.appointment_date, a.status, a.started_at
      FROM appointments a
      LEFT JOIN clients c ON a.client_id = c.id
      LEFT JOIN vehicules v ON a.vehicle_id = v.id
      WHERE DATE(a.appointment_date) = DATE(CONVERT_TZ(NOW(), '+00:00', '+01:00'))
        AND a.status IN ('PENDING', 'READY_FOR_WORKSHOP', 'IN_WORKSHOP', 'IN_PROGRESS')
      ORDER BY a.appointment_date ASC
    `);
    res.json(rows.map((r) => ({
      id: r.id,
      client_name: shortName(r.full_name),
      vehicle_name: [r.make, r.model].filter((x) => x && x !== 'Inconnu').join(' ') || null,
      license_plate: maskPlate(r.license_plate),
      appointment_date: r.appointment_date,
      status: r.status,
      started_at: r.started_at
    })));
  } catch (e) {
    console.error('display/today error:', e);
    res.status(500).json({ success: false, code: 'SERVER' });
  }
});

module.exports = router;
