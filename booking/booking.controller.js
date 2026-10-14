// =========================================================
// VérifCar — Réservations en ligne (site public)
//  - createPublicBooking : appelé par le site public (sans connexion)
//  - list / receipt / accept / reject : réservés à ADMIN + RECEPTION
// Tables : online_bookings + booking_receipts (voir sql/phase_online_bookings.sql)
// =========================================================
const crypto = require('crypto');
const db = require('../config/db');

const pricing = require('../pricing/pricing.service');   // prestations + prix gérés par l'admin (table services)

// --- Règles métier (doivent rester alignées avec js/config.js du site public) ---
const OPEN_DAYS = [6, 0, 1, 2, 3];                 // Sam → Mer (Jeu=4, Ven=5 fermés)
const SLOTS = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00'];
const MAX_DAYS_AHEAD = 90;
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const LANGS = ['fr', 'ar', 'en'];
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;               // ISO 3779 : 17 caractères, sans I/O/Q
const cleanVin = v => String(v == null ? '' : v).toUpperCase().replace(/[\s.\-]/g, '');

// --- Utilitaires ---
const str = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, max);

// Téléphone algérien → format local "0XXXXXXXXX" (comme dans la table clients)
function normalizePhone(raw) {
  let d = String(raw == null ? '' : raw).replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('213')) d = d.slice(3);
  d = d.replace(/^0+/, '');
  if (/^[567]\d{8}$/.test(d) || /^[234]\d{7,8}$/.test(d)) return '0' + d;
  return null;
}

// Date du jour à Alger (YYYY-MM-DD)
function algiersToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Algiers', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function addDays(isoDate, n) {
  const d = new Date(isoDate + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Détecte le vrai type du fichier (ne fait pas confiance au type annoncé)
function sniffMime(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return 'image/png';
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buf.slice(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  return null;
}

function decodeReceipt(dataUrl) {
  const m = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ''));
  if (!m) return { error: 'RECEIPT_REQUIRED' };
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length) return { error: 'RECEIPT_REQUIRED' };
  if (buf.length > MAX_RECEIPT_BYTES) return { error: 'RECEIPT_TOO_LARGE' };
  const mime = sniffMime(buf);
  if (!mime) return { error: 'RECEIPT_TYPE' };
  return { buf, mime };
}

function newReference() {
  const d = algiersToday().replace(/-/g, '').slice(2);           // YYMMDD
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';                  // sans 0/O/1/I
  let r = '';
  const bytes = crypto.randomBytes(4);
  for (const b of bytes) r += abc[b % abc.length];
  return `VC-${d}-${r}`;
}

const fail = (res, http, code) => res.status(http).json({ success: false, code });

// =========================================================
// POST /api/public/bookings  (public)
// Body JSON : { name, phone, vehicle, vin, plate, service_id, date, time,
//               transaction, message, lang, receipt (data URL base64), website (piège) }
// =========================================================
exports.createPublicBooking = async (req, res) => {
  try {
    const b = req.body || {};

    // Piège anti-robot : champ caché que les humains laissent vide
    if (b.website) return res.status(201).json({ success: true, reference: newReference() });

    // Le client doit avoir accepté les conditions de réservation (case à cocher du site)
    if (b.accept_terms !== true) return fail(res, 400, 'TERMS');

    const name = str(b.name, 100);
    const phone = normalizePhone(b.phone);
    const vehicle = str(b.vehicle, 100);
    const vin = cleanVin(b.vin);
    const plate = str(b.plate, 40) || null;
    const serviceId = str(b.service_id, 30);
    const date = str(b.date, 10);
    const time = str(b.time, 5);
    const transaction = str(b.transaction, 40);
    const message = str(b.message, 500) || null;
    const lang = LANGS.includes(b.lang) ? b.lang : 'fr';

    if (name.length < 2 || vehicle.length < 2 || !date || !time || !serviceId) return fail(res, 400, 'REQUIRED');
    if (!phone) return fail(res, 400, 'PHONE');
    if (!VIN_RE.test(vin)) return fail(res, 400, 'VIN');
    // Prix calculé côté serveur (jamais celui envoyé par le navigateur)
    const q = await pricing.quote(serviceId, phone);
    if (q.error === 'NO_PRICE') return fail(res, 400, 'SERVICE_NO_PRICE');
    if (q.error) return fail(res, 400, 'SERVICE');
    if (!SLOTS.includes(time)) return fail(res, 400, 'TIME');

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date + 'T12:00:00Z'))) return fail(res, 400, 'DATE');
    const today = algiersToday();
    if (date < today) return fail(res, 400, 'DATE_PAST');
    if (date > addDays(today, MAX_DAYS_AHEAD)) return fail(res, 400, 'DATE_TOO_FAR');
    if (!OPEN_DAYS.includes(new Date(date + 'T12:00:00Z').getUTCDay())) return fail(res, 400, 'CLOSED_DAY');

    if (!/^[A-Za-z0-9][A-Za-z0-9 \-/_.]{3,39}$/.test(transaction)) return fail(res, 400, 'TRANSACTION');

    const receipt = decodeReceipt(b.receipt);
    if (receipt.error) return fail(res, 400, receipt.error);

    const [dup] = await db.query('SELECT id FROM online_bookings WHERE transaction_ref = ? LIMIT 1', [transaction]);
    if (dup.length) return fail(res, 409, 'TRANSACTION_USED');

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      let bookingId, reference;
      for (let attempt = 0; attempt < 3 && !bookingId; attempt++) {
        reference = newReference();
        try {
          const [r] = await conn.query(
            `INSERT INTO online_bookings
             (reference, full_name, phone, vehicle, vin, plate, service_id, service_label,
              base_price, discount_percent, discount_source, discount_label, amount_due,
              appointment_date, transaction_ref, message, lang, client_ip)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [reference, name, phone, vehicle, vin, plate, serviceId, q.service.label_fr,
             q.base_price, q.discount_percent, q.discount_source, q.discount_label, q.amount,
             `${date} ${time}:00`, transaction, message, lang, req.ip || null]
          );
          bookingId = r.insertId;
        } catch (e) {
          if (e.code !== 'ER_DUP_ENTRY') throw e;
          if (/transaction/i.test(e.message)) { await conn.rollback(); return fail(res, 409, 'TRANSACTION_USED'); }
          // sinon : collision de référence → on réessaie
        }
      }
      if (!bookingId) throw new Error('Référence unique introuvable');

      await conn.query(
        'INSERT INTO booking_receipts (booking_id, mime_type, size_bytes, data) VALUES (?, ?, ?, ?)',
        [bookingId, receipt.mime, receipt.buf.length, receipt.buf]
      );
      await conn.commit();
      return res.status(201).json({ success: true, reference, amount: q.amount });
    } catch (e) {
      await conn.rollback().catch(() => {});
      throw e;
    } finally {
      conn.release();
    }
  } catch (error) {
    console.error('createPublicBooking error:', error);
    return fail(res, 500, 'SERVER');
  }
};

// =========================================================
// RÉCEPTION / ADMIN
// =========================================================

// GET /api/admin/online-bookings?status=PENDING_REVIEW|ACCEPTED|REJECTED|ALL
exports.listBookings = async (req, res) => {
  try {
    const status = String(req.query.status || 'PENDING_REVIEW').toUpperCase();
    const params = [];
    let where = '';
    if (status !== 'ALL') {
      if (!['PENDING_REVIEW', 'ACCEPTED', 'REJECTED'].includes(status)) return res.status(400).json({ message: 'Statut invalide.' });
      where = 'WHERE ob.status = ?';
      params.push(status);
    }
    const [rows] = await db.query(
      `SELECT ob.id, ob.reference, ob.full_name, ob.phone, ob.vehicle, ob.vin, ob.plate,
              ob.service_id, ob.service_label, ob.base_price, ob.discount_percent, ob.discount_source,
              ob.discount_label, ob.amount_due, ob.appointment_date, ob.transaction_ref,
              ob.message, ob.lang, ob.status, ob.reject_reason, ob.reviewed_at,
              ob.appointment_id, ob.created_at,
              br.mime_type AS receipt_type, br.size_bytes AS receipt_size,
              u.full_name AS reviewed_by_name
       FROM online_bookings ob
       LEFT JOIN booking_receipts br ON br.booking_id = ob.id
       LEFT JOIN users u ON u.id = ob.reviewed_by
       ${where}
       ORDER BY ob.created_at DESC
       LIMIT 200`,
      params
    );
    res.json(rows);
  } catch (error) {
    console.error('listBookings error:', error);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// GET /api/admin/online-bookings/pending-count  (badge)
exports.pendingCount = async (req, res) => {
  try {
    const [[row]] = await db.query("SELECT COUNT(*) AS count FROM online_bookings WHERE status = 'PENDING_REVIEW'");
    res.json({ count: Number(row.count) || 0 });
  } catch (error) {
    console.error('pendingCount error:', error);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// GET /api/admin/online-bookings/:id/receipt  → fichier brut (image ou PDF)
exports.getReceipt = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'ID invalide.' });
    const [rows] = await db.query('SELECT mime_type, data FROM booking_receipts WHERE booking_id = ?', [id]);
    if (!rows.length) return res.status(404).json({ message: 'Reçu introuvable.' });
    res.set({
      'Content-Type': rows[0].mime_type,
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store'
    });
    res.send(rows[0].data);
  } catch (error) {
    console.error('getReceipt error:', error);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// Trouve ou crée le client (par téléphone) et le véhicule (par immatriculation)
async function findOrCreateClient(conn, fullName, phone) {
  const [found] = await conn.query('SELECT id FROM clients WHERE phone = ? LIMIT 1', [phone]);
  if (found.length) return found[0].id;
  const [created] = await conn.query('INSERT INTO clients (full_name, phone) VALUES (?, ?)', [fullName, phone]);
  return created.insertId;
}

async function findOrCreateVehicle(conn, clientId, vehicleText, vin, plate) {
  const cleanV = vin ? String(vin).trim() : '';
  const cleanPlate = plate ? String(plate).trim() : '';
  if (!cleanV && !cleanPlate) return null;
  try {
    if (cleanV) {
      const [byVin] = await conn.query('SELECT id FROM vehicules WHERE vin_number = ? LIMIT 1', [cleanV]);
      if (byVin.length) return byVin[0].id;
    }
    if (cleanPlate) {
      const [byPlate] = await conn.query('SELECT id FROM vehicules WHERE license_plate = ? LIMIT 1', [cleanPlate]);
      if (byPlate.length) return byPlate[0].id;
    }
    const [make, ...rest] = String(vehicleText || '').trim().split(/\s+/);
    const [created] = await conn.query(
      'INSERT INTO vehicules (client_id, make, model, license_plate, vin_number) VALUES (?, ?, ?, ?, ?)',
      [clientId, make || 'Inconnu', rest.join(' ') || 'Inconnu', cleanPlate || null, cleanV || null]
    );
    return created.insertId;
  } catch (err) {
    console.warn('⚠️ Véhicule non créé pour la réservation en ligne:', err.message);
    return null;
  }
}

// PUT /api/admin/online-bookings/:id/accept   body: { totalAmount?, versement?, appointmentDate? }
// Paiement vérifié → crée le rendez-vous dans appointments (statut PENDING, ADVANCE_PAID)
exports.acceptBooking = async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'ID invalide.' });
  // Par défaut : prix et versement = montant payé en ligne (paiement intégral)
  const rawTotal = req.body?.totalAmount, rawVers = req.body?.versement;
  let totalAmount = rawTotal === undefined || rawTotal === '' ? null : Math.max(0, Number(rawTotal) || 0);
  let versement = rawVers === undefined || rawVers === '' ? null : Math.max(0, Number(rawVers) || 0);
  if (totalAmount !== null && versement !== null && totalAmount > 0 && versement > totalAmount) return res.status(400).json({ message: 'Le versement ne peut pas dépasser le prix total.' });
  // Optionnel : la réception peut déplacer le créneau au moment de la validation ("YYYY-MM-DD HH:MM")
  let newDate = null;
  if (req.body?.appointmentDate) {
    const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/.exec(String(req.body.appointmentDate).trim());
    if (!m) return res.status(400).json({ message: 'Date du rendez-vous invalide.' });
    newDate = `${m[1]} ${m[2]}:00`;
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM online_bookings WHERE id = ? FOR UPDATE', [id]);
    if (!rows.length) { await conn.rollback(); return res.status(404).json({ message: 'Demande introuvable.' }); }
    const bk = rows[0];
    if (bk.status !== 'PENDING_REVIEW') { await conn.rollback(); return res.status(409).json({ message: 'Demande déjà traitée.' }); }

    if (totalAmount === null) totalAmount = Number(bk.amount_due) || 0;
    if (versement === null) versement = Number(bk.amount_due) || 0;
    if (totalAmount > 0 && versement > totalAmount) { await conn.rollback(); return res.status(400).json({ message: 'Le versement ne peut pas dépasser le prix total.' }); }

    const clientId = await findOrCreateClient(conn, bk.full_name, bk.phone);
    const vehicleId = await findOrCreateVehicle(conn, clientId, bk.vehicle, bk.vin, bk.plate);

    const notes = [
      `Réservation en ligne ${bk.reference}`,
      `Véhicule : ${bk.vehicle}${bk.plate ? ' (' + bk.plate + ')' : ''}`,
      `Transaction BaridiMob : ${bk.transaction_ref}`,
      bk.discount_percent > 0 ? `Remise ${Number(bk.discount_percent)} % (${bk.discount_source === 'LOYALTY' ? 'client fidèle' : (bk.discount_label || 'promotion')}) — prix de base ${bk.base_price} DA` : '',
      bk.message ? `Remarque client : ${bk.message}` : ''
    ].filter(Boolean).join(' | ');

    const paymentStatus = totalAmount > 0 && versement >= totalAmount ? 'FULLY_PAID' : 'ADVANCE_PAID';
    const base = [clientId, bk.phone, vehicleId, bk.vin || null, newDate || bk.appointment_date, totalAmount, versement, paymentStatus, 'PENDING', bk.service_label];

    let result;
    try {
      [result] = await conn.query(
        `INSERT INTO appointments
         (client_id, tlf, vehicle_id, VIN, appointment_date, total_amount, versement, payment_status, status, service_type, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [...base, notes]
      );
    } catch (e) {
      if (e.code !== 'ER_BAD_FIELD_ERROR') throw e;
      [result] = await conn.query(
        `INSERT INTO appointments
         (client_id, tlf, vehicle_id, VIN, appointment_date, total_amount, versement, payment_status, status, service_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        base
      );
    }

    await conn.query(
      `UPDATE online_bookings SET status = 'ACCEPTED', appointment_id = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?`,
      [result.insertId, req.user?.id || null, id]
    );
    await conn.commit();
    res.json({ success: true, appointmentId: result.insertId, clientId, vehicleId });
  } catch (error) {
    await conn.rollback().catch(() => {});
    console.error('acceptBooking error:', error);
    res.status(500).json({ message: 'Erreur serveur.' });
  } finally {
    conn.release();
  }
};

// PUT /api/admin/online-bookings/:id/reject   body: { reason }
exports.rejectBooking = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'ID invalide.' });
    const reason = str(req.body?.reason, 255);
    if (reason.length < 3) return res.status(400).json({ message: 'Veuillez indiquer le motif du refus.' });
    const [r] = await db.query(
      `UPDATE online_bookings SET status = 'REJECTED', reject_reason = ?, reviewed_by = ?, reviewed_at = NOW()
       WHERE id = ? AND status = 'PENDING_REVIEW'`,
      [reason, req.user?.id || null, id]
    );
    if (!r.affectedRows) return res.status(409).json({ message: 'Demande introuvable ou déjà traitée.' });
    res.json({ success: true });
  } catch (error) {
    console.error('rejectBooking error:', error);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// Exporté pour les tests
exports._internal = { normalizePhone, sniffMime, decodeReceipt, algiersToday };
