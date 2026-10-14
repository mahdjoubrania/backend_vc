// =========================================================
// VérifCar — moteur de prix (source de vérité côté serveur)
// Règle : prix final = prix de base − le PLUS GRAND des rabais applicables
//         (promotion active OU fidélité), jamais cumulés.
// =========================================================
const db = require('../config/db');

const LANGS = ['fr', 'ar', 'en'];

function algiersToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Algiers', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

// Normalise un téléphone algérien en "0XXXXXXXXX" (format de la table clients)
function normalizePhone(raw) {
  let d = String(raw == null ? '' : raw).replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1); else if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('213')) d = d.slice(3);
  d = d.replace(/^0+/, '');
  if (/^[567]\d{8}$/.test(d) || /^[234]\d{7,8}$/.test(d)) return '0' + d;
  return null;
}

const roundDA = (n) => Math.round(n / 10) * 10;          // arrondi à 10 DA
const applyPercent = (base, pct) => roundDA(base * (1 - pct / 100));

async function getServices(conn = db) {
  const [rows] = await conn.query('SELECT id, label_fr, label_ar, label_en, base_price, active, sort_order FROM services ORDER BY sort_order, id');
  return rows;
}

// Promotions actives aujourd'hui (dates incluses)
async function getActivePromotions(conn = db) {
  const today = algiersToday();
  const [rows] = await conn.query(
    `SELECT id, service_id, percent, label, starts_on, ends_on FROM promotions
     WHERE active = 1 AND (starts_on IS NULL OR starts_on <= ?) AND (ends_on IS NULL OR ends_on >= ?)`,
    [today, today]
  );
  return rows.map((p) => ({ ...p, percent: Number(p.percent) }));
}

function bestPromoFor(serviceId, promos) {
  return promos
    .filter((p) => p.service_id === null || p.service_id === serviceId)
    .sort((a, b) => b.percent - a.percent)[0] || null;
}

async function getLoyaltySettings(conn = db) {
  const [[row]] = await conn.query('SELECT enabled, min_completed, percent FROM loyalty_settings WHERE id = 1');
  return row ? { enabled: !!row.enabled, min_completed: Number(row.min_completed), percent: Number(row.percent) } : { enabled: false, min_completed: 0, percent: 0 };
}

// Rabais fidélité d'un client (par téléphone). Manuel prioritaire sur l'automatique.
async function loyaltyFor(phone, conn = db) {
  const p = normalizePhone(phone);
  if (!p) return { percent: 0, completed: 0 };
  const [[client]] = await conn.query('SELECT id, loyalty_percent FROM clients WHERE phone = ? LIMIT 1', [p]);
  if (!client) return { percent: 0, completed: 0 };
  const [[{ completed }]] = await conn.query(
    "SELECT COUNT(*) AS completed FROM appointments WHERE client_id = ? AND status = 'COMPLETED'", [client.id]
  );
  if (client.loyalty_percent !== null && client.loyalty_percent !== undefined) {
    return { percent: Number(client.loyalty_percent), completed: Number(completed), manual: true };
  }
  const s = await getLoyaltySettings(conn);
  const ok = s.enabled && Number(completed) >= s.min_completed && s.min_completed > 0;
  return { percent: ok ? s.percent : 0, completed: Number(completed), manual: false };
}

// Devis complet pour une prestation (+ téléphone facultatif pour la fidélité)
async function quote(serviceId, phone, conn = db) {
  const [[svc]] = await conn.query('SELECT id, label_fr, label_ar, label_en, base_price, active FROM services WHERE id = ?', [serviceId]);
  if (!svc || !svc.active) return { error: 'SERVICE' };
  if (svc.base_price === null || svc.base_price === undefined) return { error: 'NO_PRICE', service: svc };
  const base = Number(svc.base_price);
  const promo = bestPromoFor(svc.id, await getActivePromotions(conn));
  const loyal = phone ? await loyaltyFor(phone, conn) : { percent: 0 };

  let discount = { percent: 0, source: null, label: null };
  if (promo && promo.percent > discount.percent) discount = { percent: promo.percent, source: 'PROMO', label: promo.label, ends_on: promo.ends_on };
  if (loyal.percent > discount.percent) discount = { percent: loyal.percent, source: 'LOYALTY', label: 'Client fidèle' };

  return {
    service: svc,
    base_price: base,
    discount_percent: discount.percent,
    discount_source: discount.source,
    discount_label: discount.label,
    promo_ends_on: discount.ends_on || null,
    amount: discount.percent > 0 ? applyPercent(base, discount.percent) : base
  };
}

// Liste publique : prix de base + meilleure promo (sans fidélité, client anonyme)
async function publicCatalog() {
  const [services, promos] = await Promise.all([getServices(), getActivePromotions()]);
  return services.filter((s) => s.active).map((s) => {
    const promo = bestPromoFor(s.id, promos);
    const base = s.base_price === null ? null : Number(s.base_price);
    return {
      id: s.id,
      labels: { fr: s.label_fr, ar: s.label_ar, en: s.label_en },
      base_price: base,
      bookable: base !== null,
      promo: promo && base !== null ? { percent: promo.percent, label: promo.label, ends_on: promo.ends_on } : null,
      price: base === null ? null : (promo ? applyPercent(base, promo.percent) : base)
    };
  });
}

module.exports = { quote, publicCatalog, getServices, getActivePromotions, getLoyaltySettings, loyaltyFor, normalizePhone, applyPercent, algiersToday, LANGS };
