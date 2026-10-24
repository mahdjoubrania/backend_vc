// =========================================================
// VérifCar — Vérification d'authenticité des rapports (QR code)
//
//  - GET /api/inspection/verify-code/:id   (staff, module "reports")
//      → crée (une seule fois) le code de vérification du rapport et renvoie
//        { code, url } à imprimer en QR code sur la page de garde.
//        Uniquement pour une inspection TERMINÉE (COMPLETED).
//  - GET /api/public/verify/:code          (public, limité)
//      → résumé NON sensible du rapport : véhicule, VIN, date, kilométrage,
//        verdict par module. Jamais le nom ni le téléphone du client.
//
// Table report_verifications créée automatiquement au premier appel
// (aucune migration SQL à exécuter).
// =========================================================
const crypto = require('crypto');
const db = require('../config/db');

const ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';     // sans 0/O/1/I (lisible à la main)
const CODE_RE = /^[A-HJ-NP-Z2-9]{10}$/;
const SITE_URL = () => String(process.env.PUBLIC_SITE_URL || 'https://www.verifcar.dz').replace(/\/+$/, '');

function newCode() {
  const bytes = crypto.randomBytes(10);
  let s = '';
  for (const b of bytes) s += ABC[b % ABC.length];
  return s;
}

let tableReady = null;
function ensureTable() {
  if (!tableReady) {
    tableReady = db.query(
      `CREATE TABLE IF NOT EXISTS report_verifications (
         inspection_id  BIGINT UNSIGNED NOT NULL PRIMARY KEY,
         code           CHAR(10)        NOT NULL,
         created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
         view_count     INT             NOT NULL DEFAULT 0,
         last_viewed_at DATETIME        NULL,
         UNIQUE KEY uq_report_verifications_code (code)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    ).catch((e) => { tableReady = null; throw e; });
  }
  return tableReady;
}

// Même logique que le rapport PDF (report-loader.js) pour le verdict par module
const TIRES = ['avg', 'avd', 'arg', 'ard'];
const STRUCT = ['longerons', 'traverses', 'passage_roues', 'fond_coffre', 'chassis', 'optique', 'vitre'];
function moduleStatus(d) {
  const has = (k) => d[k] !== undefined && d[k] !== null;
  const km = String(d.km_conformite || '').toUpperCase();
  const out = {};
  if (d.has_scanner) out.scanner = (String(d.calculateur_status || '').toUpperCase() === 'DEFAUT' || (d.dtc_codes && String(d.dtc_codes).trim() !== '')) ? 'DEFECT' : 'OK';
  if (d.has_moteur) out.moteur = (d.fuite_huile || d.fuite_liquide_refroidissement || d.bruit_moteur || (d.fumee_echappement && String(d.fumee_echappement).toUpperCase() !== 'AUCUNE')) ? 'DEFECT' : 'OK';
  if (d.has_suspension) out.suspension = (TIRES.some((p) => d['usure_pneu_' + p] === 'Défaut' || d['jante_' + p] === 'Défaut') || !!d.corrosion_soubassement || !!d.traces_choc) ? 'DEFECT' : 'OK';
  if (d.has_tole) out.structure = STRUCT.some((e) => d[e + '_status'] === 'Défaut') ? 'DEFECT' : 'OK';
  if (has('km_conformite') || d.kilometrage_affiche) out.kilometrage = km === 'REAL' ? 'OK' : 'DEFECT';
  return out;
}

// GET /api/inspection/verify-code/:id   (id = n° d'inspection uniquement)
exports.staffCode = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'ID invalide.' });
    let [rows] = await db.query('SELECT id, status FROM inspections WHERE id = ? LIMIT 1', [id]);
    if (!rows.length) return res.status(404).json({ message: 'Inspection introuvable.' });
    const insp = rows[0];
    if (String(insp.status).toUpperCase() !== 'COMPLETED') {
      return res.json({ code: null, reason: 'NOT_COMPLETED' });   // pas de QR sur un rapport non terminé
    }
    await ensureTable();
    const [found] = await db.query('SELECT code FROM report_verifications WHERE inspection_id = ?', [insp.id]);
    let code = found.length ? found[0].code : null;
    for (let i = 0; !code && i < 5; i++) {
      const c = newCode();
      try {
        await db.query('INSERT INTO report_verifications (inspection_id, code) VALUES (?, ?)', [insp.id, c]);
        code = c;
      } catch (e) {
        if (e && e.code === 'ER_DUP_ENTRY') {
          // deux impressions simultanées : on relit le code déjà créé ; sinon collision → nouvel essai
          const [again] = await db.query('SELECT code FROM report_verifications WHERE inspection_id = ?', [insp.id]);
          if (again.length) code = again[0].code;
        } else throw e;
      }
    }
    if (!code) return res.status(500).json({ message: 'Erreur serveur.' });
    res.json({ code, url: `${SITE_URL()}/verify.html?c=${code}` });
  } catch (e) {
    console.error('staffCode error:', e);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// GET /api/public/verify/:code
exports.publicVerify = async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const code = String(req.params.code || '').toUpperCase().replace(/[\s-]/g, '');
    if (!CODE_RE.test(code)) return res.status(400).json({ success: false, code: 'INVALID' });
    await ensureTable();
    const [vr] = await db.query('SELECT inspection_id FROM report_verifications WHERE code = ? LIMIT 1', [code]);
    if (!vr.length) return res.status(404).json({ success: false, code: 'NOT_FOUND' });
    const inspectionId = vr[0].inspection_id;

    // Pas de elements_ext_json (dessins volumineux) : uniquement les champs du verdict
    const [rows] = await db.query(
      `SELECT i.id, i.status,
              DATE_FORMAT(COALESCE(a.completed_at, i.updated_at, i.created_at), '%Y-%m-%d') AS inspection_date,
              a.service_type,
              v.make, v.model, v.vin_number,
              km.kilometrage_affiche, km.conformite AS km_conformite,
              mot.id AS has_moteur, mot.fuite_huile, mot.fuite_liquide_refroidissement, mot.bruit_moteur, mot.fumee_echappement,
              susp.id AS has_suspension,
              susp.usure_pneu_avg, susp.usure_pneu_avd, susp.usure_pneu_arg, susp.usure_pneu_ard,
              susp.jante_avg, susp.jante_avd, susp.jante_arg, susp.jante_ard,
              susp.corrosion_soubassement, susp.traces_choc,
              t.id AS has_tole,
              t.longerons_status, t.traverses_status, t.passage_roues_status, t.fond_coffre_status,
              t.chassis_status, t.optique_status, t.vitre_status, t.conclusion_structure,
              sc.id AS has_scanner, sc.calculateur_status, sc.dtc_codes
       FROM inspections i
       LEFT JOIN appointments a ON a.id = i.appointment_id
       LEFT JOIN vehicules v ON v.id = a.vehicle_id
       LEFT JOIN inspection_kilometrage km ON km.inspection_id = i.id
       LEFT JOIN inspection_moteur mot ON mot.inspection_id = i.id
       LEFT JOIN inspection_suspension susp ON susp.inspection_id = i.id
       LEFT JOIN inspection_tole t ON t.inspection_id = i.id
       LEFT JOIN inspection_scanner sc ON sc.inspection_id = i.id
       WHERE i.id = ?
       LIMIT 1`,
      [inspectionId]
    );
    if (!rows.length) return res.status(404).json({ success: false, code: 'NOT_FOUND' });
    const d = rows[0];

    // Date de dernière modification par l'administration (transparence)
    let updatedAt = null;
    try {
      const [[log]] = await db.query("SELECT DATE_FORMAT(MAX(edited_at), '%Y-%m-%d') AS last FROM inspection_edit_log WHERE inspection_id = ?", [inspectionId]);
      updatedAt = log && log.last ? log.last : null;
    } catch (e) { /* table absente : ignoré */ }

    // compteur de consultations (n'empêche jamais la réponse)
    db.query("UPDATE report_verifications SET view_count = view_count + 1, last_viewed_at = CONVERT_TZ(NOW(), '+00:00', '+01:00') WHERE inspection_id = ?", [inspectionId]).catch(() => {});

    const modules = moduleStatus(d);
    const vals = Object.values(modules);
    res.json({
      success: true,
      code,
      reference: `REP-2026-${d.id}`,
      completed: String(d.status).toUpperCase() === 'COMPLETED',
      inspection_date: d.inspection_date,
      updated_at: updatedAt,
      vehicle: {
        make: d.make || null,
        model: d.model && d.model !== 'Inconnu' ? d.model : null,
        vin: d.vin_number || null
      },
      kilometrage: d.kilometrage_affiche ? Number(d.kilometrage_affiche) : null,
      km_conformite: d.km_conformite ? String(d.km_conformite).toUpperCase() : null,
      structure_conclusion: d.conclusion_structure || null,
      modules,
      verdict: vals.length ? (vals.includes('DEFECT') ? 'NON_CONFORME' : 'CONFORME') : null
    });
  } catch (e) {
    console.error('publicVerify error:', e);
    res.status(500).json({ success: false, code: 'SERVER' });
  }
};

// ---------------------------------------------------------------------
// Téléchargement du rapport complet par le client (page rapport.html)
// POST /api/public/report/:code   { phone, vin }
// Le code (QR) seul ne suffit pas : il faut aussi le téléphone du client
// enregistré sur le rendez-vous ET le numéro de châssis (VIN) du véhicule
// (si un VIN est enregistré). Après 5 erreurs, le code est bloqué 30 min.
// ---------------------------------------------------------------------
const vinKey = (v) => String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]/g, '');
const phoneKey = (v) => { const d = String(v == null ? '' : v).replace(/\D/g, ''); return d.length >= 8 ? d.slice(-9) : null; };
const failures = new Map();          // code -> { n, until }
const MAX_FAIL = 5, LOCK_MS = 30 * 60 * 1000;
function isLocked(code) {
  const f = failures.get(code);
  if (!f) return false;
  if (f.until && f.until > Date.now()) return true;
  if (f.until && f.until <= Date.now()) failures.delete(code);
  return false;
}
function addFailure(code) {
  const f = failures.get(code) || { n: 0, until: 0 };
  f.n += 1;
  if (f.n >= MAX_FAIL) { f.until = Date.now() + LOCK_MS; f.n = 0; }
  failures.set(code, f);
  if (failures.size > 5000) failures.delete(failures.keys().next().value);
}

exports.publicReport = async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const code = String(req.params.code || '').toUpperCase().replace(/[\s-]/g, '');
    if (!CODE_RE.test(code)) return res.status(400).json({ success: false, code: 'INVALID' });
    const phone = phoneKey(req.body && req.body.phone);
    if (!phone) return res.status(400).json({ success: false, code: 'PHONE_FORMAT' });
    const vin = vinKey(req.body && req.body.vin);
    if (vin.length < 6 || vin.length > 20) return res.status(400).json({ success: false, code: 'VIN_FORMAT' });
    if (isLocked(code)) return res.status(429).json({ success: false, code: 'LOCKED' });
    await ensureTable();
    const [vr] = await db.query('SELECT inspection_id FROM report_verifications WHERE code = ? LIMIT 1', [code]);
    if (!vr.length) return res.status(404).json({ success: false, code: 'NOT_FOUND' });
    const inspectionId = vr[0].inspection_id;
    const [[row]] = await db.query(
      `SELECT i.status, c.phone AS client_phone, a.tlf, a.VIN AS appt_vin, v.vin_number
       FROM inspections i
       LEFT JOIN appointments a ON a.id = i.appointment_id
       LEFT JOIN clients c ON c.id = a.client_id
       LEFT JOIN vehicules v ON v.id = a.vehicle_id
       WHERE i.id = ? LIMIT 1`, [inspectionId]);
    if (!row) return res.status(404).json({ success: false, code: 'NOT_FOUND' });
    const known = [phoneKey(row.client_phone), phoneKey(row.tlf)].filter(Boolean);
    const knownVins = [vinKey(row.vin_number), vinKey(row.appt_vin)].filter((x) => x.length >= 6);
    const phoneOk = known.includes(phone);
    const vinOk = !knownVins.length || knownVins.includes(vin);
    if (!phoneOk || !vinOk) {
      addFailure(code);
      // message unique : on ne dit pas lequel des deux est faux
      return res.status(403).json({ success: false, code: 'MISMATCH' });
    }
    failures.delete(code);
    if (String(row.status).toUpperCase() !== 'COMPLETED') return res.status(409).json({ success: false, code: 'NOT_READY' });

    const report = await require('./inspection.controller').buildToleReport(inspectionId);
    if (!report) return res.status(404).json({ success: false, code: 'NOT_FOUND' });
    delete report.client_phone;
    Object.keys(report).forEach((k) => { if (/_technician_id$/.test(k)) delete report[k]; });

    let ai = null;
    try {
      const [s] = await db.query(
        `SELECT carrosserie_summary, suspension_summary, moteur_summary, scanner_summary, conclusion_generale
         FROM inspection_ai_summaries WHERE inspection_id = ?`, [inspectionId]);
      ai = s.length ? s[0] : null;
    } catch (e) { /* table absente : résumés non affichés */ }

    db.query("UPDATE report_verifications SET view_count = view_count + 1, last_viewed_at = CONVERT_TZ(NOW(), '+00:00', '+01:00') WHERE inspection_id = ?", [inspectionId]).catch(() => {});
    res.json({ success: true, code, reference: `REP-2026-${inspectionId}`, data: report, ai_summary: ai });
  } catch (e) {
    console.error('publicReport error:', e);
    res.status(500).json({ success: false, code: 'SERVER' });
  }
};

exports._internal = { moduleStatus, newCode, CODE_RE, phoneKey, vinKey, failures };
