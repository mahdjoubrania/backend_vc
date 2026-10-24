// =========================================================
// VérifCar — Codes promo
//  - remise en % OU montant fixe (DA)
//  - valables entre deux dates (facultatif) et pour certaines prestations (facultatif)
//  - utilisables sur le site (réservation en ligne) et à la réception
//  - JAMAIS cumulés : le client obtient la plus grande remise (code / promotion / fidélité)
// Table "promo_codes" créée automatiquement.
// =========================================================
const db = require('../config/db');

const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,29}$/;
const SERVICE_RE = /^[a-z0-9_-]{1,30}$/;
const normCode = (v) => String(v == null ? '' : v).trim().toUpperCase().replace(/\s+/g, '');

// Cases à cocher de la réception (libellés) → identifiants des prestations
const RECEPTION_LABELS = {
  'VÉRIFICATION COMPLÈTE': 'complete', 'VERIFICATION COMPLETE': 'complete',
  'KILOMETRAGE': 'kilometrage', 'KILOMÉTRAGE': 'kilometrage',
  'MOTEUR': 'moteur', 'TOLE': 'tole', 'TÔLE': 'tole',
  'SUSPENSION': 'suspension', 'SCANNER': 'scanner'
};
function serviceIdFromAny(v) {
  const s = String(v == null ? '' : v).trim();
  if (SERVICE_RE.test(s)) return s;
  return RECEPTION_LABELS[s.toUpperCase()] || null;
}

function algiersToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Algiers', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
const roundDA = (n) => Math.round(n / 10) * 10;

let tableReady = null;
function ensureTable() {
  if (!tableReady) {
    tableReady = db.query(
      `CREATE TABLE IF NOT EXISTS promo_codes (
         id            INT AUTO_INCREMENT PRIMARY KEY,
         code          VARCHAR(30)   NOT NULL,
         label         VARCHAR(100)  NULL,
         discount_type VARCHAR(10)   NOT NULL DEFAULT 'PERCENT',
         value         DECIMAL(10,2) NOT NULL,
         service_ids   VARCHAR(255)  NULL,
         starts_on     DATE          NULL,
         ends_on       DATE          NULL,
         active        TINYINT(1)    NOT NULL DEFAULT 1,
         created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
         UNIQUE KEY uq_promo_codes_code (code)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    ).catch((e) => { tableReady = null; throw e; });
  }
  return tableReady;
}

function rowToCode(r) {
  return {
    id: r.id, code: r.code, label: r.label,
    discount_type: r.discount_type === 'AMOUNT' ? 'AMOUNT' : 'PERCENT',
    value: Number(r.value),
    service_ids: r.service_ids ? String(r.service_ids).split(',').filter(Boolean) : [],
    starts_on: r.starts_on ? String(r.starts_on).slice(0, 10) : null,
    ends_on: r.ends_on ? String(r.ends_on).slice(0, 10) : null,
    active: !!Number(r.active)
  };
}

async function findCode(code, conn = db) {
  const c = normCode(code);
  if (!CODE_RE.test(c)) return null;
  await ensureTable();
  const [rows] = await conn.query('SELECT * FROM promo_codes WHERE code = ? LIMIT 1', [c]);
  return rows.length ? rowToCode(rows[0]) : null;
}

// État d'un code pour une liste de prestations : OK | INVALID | INACTIVE | NOT_YET | EXPIRED | SERVICE
function status(pc, serviceIds) {
  if (!pc) return 'INVALID';
  if (!pc.active) return 'INACTIVE';
  const today = algiersToday();
  if (pc.starts_on && pc.starts_on > today) return 'NOT_YET';
  if (pc.ends_on && pc.ends_on < today) return 'EXPIRED';
  if (pc.service_ids.length) {
    const ids = (serviceIds || []).filter(Boolean);
    if (!ids.length || ids.some((id) => !pc.service_ids.includes(id))) return 'SERVICE';
  }
  return 'OK';
}

// Montant après application du code
function apply(pc, base) {
  const b = Number(base) || 0;
  if (pc.discount_type === 'AMOUNT') return Math.max(0, Math.round(b - pc.value));
  return Math.max(0, roundDA(b * (1 - pc.value / 100)));
}

const MESSAGES = {
  INVALID: 'Code promo inconnu.',
  INACTIVE: 'Ce code promo est désactivé.',
  NOT_YET: "Ce code promo n'est pas encore valable.",
  EXPIRED: 'Ce code promo a expiré.',
  SERVICE: "Ce code promo n'est pas valable pour cette prestation."
};

// Nombre d'utilisations (réservations en ligne non refusées + rendez-vous créés à la réception)
async function usageCounts() {
  const out = {};
  const add = (rows) => rows.forEach((r) => { if (r.code) out[r.code] = (out[r.code] || 0) + Number(r.n); });
  try { const [a] = await db.query("SELECT promo_code AS code, COUNT(*) AS n FROM online_bookings WHERE promo_code IS NOT NULL AND status <> 'REJECTED' GROUP BY promo_code"); add(a); } catch (_) { /* colonne absente */ }
  try { const [b] = await db.query("SELECT promo_code AS code, COUNT(*) AS n FROM appointments WHERE promo_code IS NOT NULL AND status <> 'CANCELLED' GROUP BY promo_code"); add(b); } catch (_) { /* colonne absente */ }
  return out;
}

module.exports = { ensureTable, findCode, status, apply, normCode, CODE_RE, SERVICE_RE, serviceIdFromAny, MESSAGES, rowToCode, usageCounts, algiersToday };
