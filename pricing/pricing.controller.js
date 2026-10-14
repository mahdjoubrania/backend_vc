// =========================================================
// VérifCar — Tarifs : endpoints publics + gestion ADMIN
// =========================================================
const db = require('../config/db');
const P = require('./pricing.service');

const str = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, max);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const pctOk = (v) => Number.isFinite(v) && v > 0 && v <= 90;
const err500 = (res, where, e) => { console.error(where, e); res.status(500).json({ message: 'Erreur serveur.' }); };

/* ------------------------- PUBLIC ------------------------- */

// GET /api/public/services
exports.publicServices = async (req, res) => {
  try {
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ services: await P.publicCatalog() });
  } catch (e) { err500(res, 'publicServices', e); }
};

// POST /api/public/quote  { service_id, phone? }
exports.publicQuote = async (req, res) => {
  try {
    const q = await P.quote(str(req.body?.service_id, 30), req.body?.phone);
    if (q.error) return res.status(400).json({ success: false, code: q.error });
    res.json({
      success: true,
      base_price: q.base_price,
      discount_percent: q.discount_percent,
      discount_source: q.discount_source,           // PROMO | LOYALTY | null
      discount_label: q.discount_source === 'PROMO' ? q.discount_label : null,
      promo_ends_on: q.promo_ends_on,
      amount: q.amount
    });
  } catch (e) { err500(res, 'publicQuote', e); }
};

/* ------------------------- ADMIN ------------------------- */

// GET /api/admin/pricing
exports.getPricing = async (req, res) => {
  try {
    const [services, promos, loyalty] = await Promise.all([
      P.getServices(),
      db.query('SELECT id, service_id, percent, label, starts_on, ends_on, active, created_at FROM promotions ORDER BY active DESC, created_at DESC').then(([r]) => r),
      P.getLoyaltySettings()
    ]);
    const today = P.algiersToday();
    res.json({
      today,
      services,
      promotions: promos.map((p) => ({
        ...p,
        percent: Number(p.percent),
        running: !!p.active && (!p.starts_on || p.starts_on <= today) && (!p.ends_on || p.ends_on >= today)
      })),
      loyalty
    });
  } catch (e) { err500(res, 'getPricing', e); }
};

// PUT /api/admin/pricing/services/:id  { base_price|null, active, label_fr, label_ar, label_en }
exports.updateService = async (req, res) => {
  try {
    const id = str(req.params.id, 30);
    const b = req.body || {};
    let price = b.base_price;
    if (price === '' || price === null || price === undefined) price = null;
    else {
      price = Math.round(Number(price));
      if (!Number.isFinite(price) || price < 0 || price > 10000000) return res.status(400).json({ message: 'Prix invalide.' });
    }
    const labels = ['label_fr', 'label_ar', 'label_en'].map((k) => str(b[k], 100));
    if (labels.some((l) => l.length < 2)) return res.status(400).json({ message: 'Les trois libellés (FR / AR / EN) sont obligatoires.' });
    const [r] = await db.query(
      'UPDATE services SET base_price = ?, active = ?, label_fr = ?, label_ar = ?, label_en = ? WHERE id = ?',
      [price, b.active ? 1 : 0, ...labels, id]
    );
    if (!r.affectedRows) return res.status(404).json({ message: 'Prestation introuvable.' });
    res.json({ success: true });
  } catch (e) { err500(res, 'updateService', e); }
};

function readPromo(b) {
  const percent = Number(b.percent);
  if (!pctOk(percent)) return { error: 'La remise doit être comprise entre 1 et 90 %.' };
  const label = str(b.label, 100);
  if (label.length < 2) return { error: 'Le nom de la promotion est obligatoire.' };
  const service_id = b.service_id ? str(b.service_id, 30) : null;
  const starts_on = b.starts_on ? String(b.starts_on) : null;
  const ends_on = b.ends_on ? String(b.ends_on) : null;
  if ((starts_on && !isDate(starts_on)) || (ends_on && !isDate(ends_on))) return { error: 'Dates invalides.' };
  if (starts_on && ends_on && ends_on < starts_on) return { error: 'La date de fin est avant la date de début.' };
  return { service_id, percent, label, starts_on, ends_on, active: b.active === undefined ? 1 : (b.active ? 1 : 0) };
}

// POST /api/admin/pricing/promotions
exports.createPromotion = async (req, res) => {
  try {
    const p = readPromo(req.body || {});
    if (p.error) return res.status(400).json({ message: p.error });
    const [r] = await db.query(
      'INSERT INTO promotions (service_id, percent, label, starts_on, ends_on, active) VALUES (?, ?, ?, ?, ?, ?)',
      [p.service_id, p.percent, p.label, p.starts_on, p.ends_on, p.active]
    );
    res.status(201).json({ success: true, id: r.insertId });
  } catch (e) {
    if (e.code === 'ER_NO_REFERENCED_ROW_2') return res.status(400).json({ message: 'Prestation inconnue.' });
    err500(res, 'createPromotion', e);
  }
};

// PUT /api/admin/pricing/promotions/:id
exports.updatePromotion = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const p = readPromo(req.body || {});
    if (p.error) return res.status(400).json({ message: p.error });
    const [r] = await db.query(
      'UPDATE promotions SET service_id = ?, percent = ?, label = ?, starts_on = ?, ends_on = ?, active = ? WHERE id = ?',
      [p.service_id, p.percent, p.label, p.starts_on, p.ends_on, p.active, id]
    );
    if (!r.affectedRows) return res.status(404).json({ message: 'Promotion introuvable.' });
    res.json({ success: true });
  } catch (e) { err500(res, 'updatePromotion', e); }
};

// DELETE /api/admin/pricing/promotions/:id
exports.deletePromotion = async (req, res) => {
  try {
    const [r] = await db.query('DELETE FROM promotions WHERE id = ?', [Number(req.params.id)]);
    if (!r.affectedRows) return res.status(404).json({ message: 'Promotion introuvable.' });
    res.json({ success: true });
  } catch (e) { err500(res, 'deletePromotion', e); }
};

// PUT /api/admin/pricing/loyalty  { enabled, min_completed, percent }
exports.updateLoyalty = async (req, res) => {
  try {
    const b = req.body || {};
    const min = Math.round(Number(b.min_completed));
    const pct = Number(b.percent);
    if (!Number.isFinite(min) || min < 1 || min > 100) return res.status(400).json({ message: 'Nombre d\'inspections invalide (1 à 100).' });
    if (!pctOk(pct)) return res.status(400).json({ message: 'La remise doit être comprise entre 1 et 90 %.' });
    await db.query(
      'INSERT INTO loyalty_settings (id, enabled, min_completed, percent) VALUES (1, ?, ?, ?) ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), min_completed = VALUES(min_completed), percent = VALUES(percent)',
      [b.enabled ? 1 : 0, min, pct]
    );
    res.json({ success: true });
  } catch (e) { err500(res, 'updateLoyalty', e); }
};

// GET /api/admin/pricing/loyal-clients?q=   → clients avec nb d'inspections terminées et remise effective
exports.loyalClients = async (req, res) => {
  try {
    const q = str(req.query.q, 60);
    const s = await P.getLoyaltySettings();
    const params = [];
    let where = '';
    if (q) { where = 'WHERE c.full_name LIKE ? OR c.phone LIKE ?'; params.push(`%${q}%`, `%${q}%`); }
    const [rows] = await db.query(
      `SELECT c.id, c.full_name, c.phone, c.loyalty_percent,
              (SELECT COUNT(*) FROM appointments a WHERE a.client_id = c.id AND a.status = 'COMPLETED') AS completed,
              (SELECT MAX(a.appointment_date) FROM appointments a WHERE a.client_id = c.id AND a.status = 'COMPLETED') AS last_visit
       FROM clients c ${where}
       ORDER BY (c.loyalty_percent IS NOT NULL) DESC, completed DESC, c.full_name
       LIMIT 300`,
      params
    );
    res.json({
      settings: s,
      clients: rows.map((c) => {
        const completed = Number(c.completed) || 0;
        const manual = c.loyalty_percent !== null;
        const auto = s.enabled && completed >= s.min_completed ? s.percent : 0;
        return {
          id: c.id, full_name: c.full_name, phone: c.phone, completed, last_visit: c.last_visit,
          loyalty_percent: manual ? Number(c.loyalty_percent) : null,
          effective_percent: manual ? Number(c.loyalty_percent) : auto,
          mode: manual ? (Number(c.loyalty_percent) === 0 ? 'EXCLUDED' : 'MANUAL') : (auto > 0 ? 'AUTO' : 'NONE')
        };
      })
    });
  } catch (e) { err500(res, 'loyalClients', e); }
};

// PUT /api/admin/pricing/clients/:id/loyalty  { percent: null | 0..90 }
exports.setClientLoyalty = async (req, res) => {
  try {
    const id = Number(req.params.id);
    let pct = req.body?.percent;
    if (pct === null || pct === '' || pct === undefined) pct = null;
    else {
      pct = Number(pct);
      if (!Number.isFinite(pct) || pct < 0 || pct > 90) return res.status(400).json({ message: 'Remise invalide (0 à 90 %).' });
    }
    const [r] = await db.query('UPDATE clients SET loyalty_percent = ? WHERE id = ?', [pct, id]);
    if (!r.affectedRows) return res.status(404).json({ message: 'Client introuvable.' });
    res.json({ success: true });
  } catch (e) { err500(res, 'setClientLoyalty', e); }
};
