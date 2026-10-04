const db = require('../config/db');
// ===== مواصفات وتحقق تعديل التقرير (مضمَّنة هنا عمداً: ملف واحد بلا اعتماد على ملفات إضافية) =====
const { SPECS, validateSections, diffSection, truncateChangesForLog } = (() => {
// verification/report-edit.helpers.js
// مواصفات الحقول القابلة للتعديل من طرف الأدمن + التحقق + المقارنة.
// دوال نقية: لا اتصال بقاعدة البيانات هنا، ولا تُبنى أي أسماء أعمدة من مدخلات المستخدم
// (أسماء الجداول والأعمدة تأتي حصراً من هذه القائمة البيضاء).

const STATUS = ['Conforme', 'Défaut'];
const TEXT_MAX = 20000;

const f = {
  enum: (values) => ({ type: 'enum', values }),
  str: (max = 255) => ({ type: 'string', max }),
  text: () => ({ type: 'string', max: TEXT_MAX }),
  bool: () => ({ type: 'bool' }),
  int: (min, max) => ({ type: 'int', min, max })
};

const TIRE_POSITIONS = ['avg', 'avd', 'arg', 'ard'];
const STRUCT_ITEMS = ['longerons', 'traverses', 'passage_roues', 'fond_coffre', 'chassis', 'optique', 'vitre'];

const suspensionFields = {};
TIRE_POSITIONS.forEach((p) => {
  suspensionFields[`usure_pneu_${p}`] = f.enum(STATUS);
  suspensionFields[`obs_pneu_${p}`] = f.str(255);
  suspensionFields[`jante_${p}`] = f.enum(STATUS);
  suspensionFields[`jante_${p}_obs`] = f.str(255);
});
suspensionFields.corrosion_soubassement = f.bool();
suspensionFields.traces_choc = f.bool();
suspensionFields.notes = f.text();

const toleFields = {};
STRUCT_ITEMS.forEach((k) => {
  toleFields[`${k}_status`] = f.enum(STATUS);
  toleFields[`${k}_obs`] = f.str(255);
});
toleFields.conclusion_structure = f.enum([
  'Aucun accident détecté',
  'Accident léger',
  'Accident réparé',
  'Véhicule accidenté structurellement'
]);
toleFields.notes = f.text();
// ملاحظة: elements_ext_json (رسومات الصور) غير قابلة للتعديل هنا عمداً، ولا technician_id أيضاً.

const SPECS = {
  scanner: {
    table: 'inspection_scanner',
    fields: {
      calculateur_status: f.enum(['OK', 'DEFAUT']),
      voyants_allumes: f.str(255),
      dtc_codes: f.text(),
      notes: f.text()
    }
  },
  moteur: {
    table: 'inspection_moteur',
    fields: {
      niveau_huile: f.enum(['OK', 'BAS', 'ANORMAL']),
      fuite_huile: f.bool(),
      fuite_liquide_refroidissement: f.bool(),
      bruit_moteur: f.bool(),
      fumee_echappement: f.enum(['AUCUNE', 'BLANCHE', 'NOIRE', 'BLEUE']),
      notes: f.text()
    }
  },
  suspension: { table: 'inspection_suspension', fields: suspensionFields },
  tole: { table: 'inspection_tole', fields: toleFields },
  kilometrage: {
    table: 'inspection_kilometrage',
    fields: {
      kilometrage_affiche: f.int(0, 9999999),
      conformite: f.enum(['REAL', 'SUSPECT', 'UNCERTAIN']),
      notes: f.text()
    },
    requiredOnCreate: ['kilometrage_affiche']   // عمود NOT NULL بلا قيمة افتراضية
  },
  general: {
    table: 'inspection_general_observations',
    fields: {
      nombre_cles: f.int(0, 20),
      rapport_mecanique: f.text(),
      equipements_secour: f.str(255)
    }
  }
};

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// يعيد { value } أو { error }
function normalizeValue(spec, raw) {
  switch (spec.type) {
    case 'enum':
      return spec.values.includes(raw)
        ? { value: raw }
        : { error: `valeur non autorisée (attendu : ${spec.values.join(' / ')})` };

    case 'string': {
      if (raw === null || raw === undefined) return { value: null };
      if (typeof raw !== 'string' && typeof raw !== 'number') return { error: 'texte attendu' };
      const s = String(raw).trim();
      if (s === '') return { value: null };
      if (s.length > spec.max) return { error: `trop long (maximum ${spec.max} caractères)` };
      return { value: s };
    }

    case 'bool':
      if (raw === true || raw === 1 || raw === '1' || raw === 'true') return { value: 1 };
      if (raw === false || raw === 0 || raw === '0' || raw === 'false') return { value: 0 };
      return { error: 'valeur booléenne attendue' };

    case 'int': {
      if (raw === '' || raw === null || raw === undefined || typeof raw === 'boolean') return { error: 'nombre entier requis' };
      const n = Number(raw);
      if (!Number.isInteger(n)) return { error: 'nombre entier requis' };
      if (n < spec.min || n > spec.max) return { error: `doit être compris entre ${spec.min} et ${spec.max}` };
      return { value: n };
    }

    default:
      return { error: 'type de champ inconnu' };
  }
}

// يتحقق من حمولة { sectionKey: { field: value } } ويرفض أي قسم أو حقل غير معروف
function validateSections(sectionsInput) {
  const errors = [];
  const clean = {};

  if (!sectionsInput || typeof sectionsInput !== 'object' || Array.isArray(sectionsInput)) {
    return { errors: ['Format invalide : l\'objet "sections" est attendu.'], clean };
  }

  for (const [sectionKey, fields] of Object.entries(sectionsInput)) {
    if (!has(SPECS, sectionKey)) { errors.push(`Section inconnue : ${sectionKey}`); continue; }
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) { errors.push(`${sectionKey} : objet attendu`); continue; }

    const spec = SPECS[sectionKey];
    for (const [field, raw] of Object.entries(fields)) {
      if (!has(spec.fields, field)) { errors.push(`${sectionKey}.${field} : champ non modifiable`); continue; }
      const r = normalizeValue(spec.fields[field], raw);
      if (r.error) errors.push(`${sectionKey}.${field} : ${r.error}`);
      else {
        if (!clean[sectionKey]) clean[sectionKey] = {};
        clean[sectionKey][field] = r.value;
      }
    }
  }
  return { errors, clean };
}

function sameValue(fieldSpec, oldVal, newVal) {
  if (fieldSpec.type === 'bool' || fieldSpec.type === 'int') return Number(oldVal) === Number(newVal);
  return (oldVal ?? '') === (newVal ?? '');
}

// الفروقات الفعلية فقط: { field: [old, new] }
function diffSection(existingRow, newValues, specFields) {
  const diff = {};
  for (const [field, newVal] of Object.entries(newValues)) {
    const oldVal = existingRow[field];
    if (!sameValue(specFields[field], oldVal, newVal)) diff[field] = [oldVal ?? null, newVal];
  }
  return diff;
}

// تقصير القيم الطويلة قبل تخزينها بسجل التعديلات
function truncateChangesForLog(changes, max = 500) {
  const cut = (v) => (typeof v === 'string' && v.length > max ? v.slice(0, max) + '…' : v);
  const out = {};
  for (const [section, value] of Object.entries(changes)) {
    if (section === '_created') { out[section] = value; continue; }
    out[section] = {};
    for (const [field, pair] of Object.entries(value)) out[section][field] = [cut(pair[0]), cut(pair[1])];
  }
  return out;
}


  return { SPECS, validateSections, diffSection, truncateChangesForLog };
})();

exports.saveKilometrage = async (req, res) => {
  let {
    inspection_id,
    kilometrage_affiche,
    conformite,
    notes
  } = req.body;

  try {
    if (!req.user?.id) {
      return res.status(401).json({
        success: false,
        error: 'Utilisateur non authentifié'
      });
    }

    inspection_id = await ensureInspectionExists(
      inspection_id,
      req.user.id
    );

    const sql = `
      INSERT INTO inspection_kilometrage
        (inspection_id, technician_id, kilometrage_affiche, conformite, notes)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        technician_id = VALUES(technician_id),
        kilometrage_affiche = VALUES(kilometrage_affiche),
        conformite = VALUES(conformite),
        notes = VALUES(notes)
    `;

    await db.query(sql, [
      inspection_id,
      req.user.id,
      kilometrage_affiche,
      conformite,
      notes
    ]);

    res.json({
      success: true,
      message: 'تم حفظ بيانات الكيلومتراج بنجاح'
    });

  } catch (err) {
    console.error('❌ saveKilometrage:', err);

    res.status(500).json({
      success: false,
      error: 'Erreur serveur. Veuillez réessayer plus tard.'
    });
  }
};

exports.saveMoteur = async (req, res) => {
  const {
    inspection_id,
    niveau_huile,
    fuite_huile,
    fuite_liquide_refroidissement,
    bruit_moteur,
    fumee_echappement,
    notes
  } = req.body;

  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, error: 'Utilisateur non authentifié' });
    }

    const realInspectionId = await ensureInspectionExists(inspection_id, req.user.id);

    const sql = `
      INSERT INTO inspection_moteur
        (inspection_id, technician_id, niveau_huile, fuite_huile, fuite_liquide_refroidissement, bruit_moteur, fumee_echappement, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        technician_id = VALUES(technician_id),
        niveau_huile = VALUES(niveau_huile),
        fuite_huile = VALUES(fuite_huile),
        fuite_liquide_refroidissement = VALUES(fuite_liquide_refroidissement),
        bruit_moteur = VALUES(bruit_moteur),
        fumee_echappement = VALUES(fumee_echappement),
        notes = VALUES(notes)
    `;

    await db.query(sql, [
      realInspectionId,
      req.user.id,
      niveau_huile,
      fuite_huile ? 1 : 0,
      fuite_liquide_refroidissement ? 1 : 0,
      bruit_moteur ? 1 : 0,
      fumee_echappement,
      notes
    ]);

    res.json({ success: true, message: 'تم حفظ بيانات المحرك بنجاح' });
  } catch (err) {
    console.error('❌ saveMoteur:', err);
    res.status(500).json({ success: false, error: 'Erreur serveur. Veuillez réessayer plus tard.' });
  }
};

exports.saveScanner = async (req, res) => {
  const {
    inspection_id,
    calculateur_status,
    voyants_allumes,
    dtc_codes,
    notes
  } = req.body;

  try {
    if (!req.user?.id) {
      return res.status(401).json({
        success: false,
        error: 'Utilisateur non authentifié'
      });
    }

    const realInspectionId = await ensureInspectionExists(
      inspection_id,
      req.user.id
    );

    const sql = `
      INSERT INTO inspection_scanner
        (
          inspection_id,
          technician_id,
          calculateur_status,
          voyants_allumes,
          dtc_codes,
          notes
        )
      VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        technician_id = VALUES(technician_id),
        calculateur_status = VALUES(calculateur_status),
        voyants_allumes = VALUES(voyants_allumes),
        dtc_codes = VALUES(dtc_codes),
        notes = VALUES(notes)
    `;

    await db.query(sql, [
      realInspectionId,
      req.user.id,
      calculateur_status,
      voyants_allumes,
      dtc_codes,
      notes
    ]);

    res.json({
      success: true,
      message: 'تم حفظ بيانات الماسح بنجاح'
    });

  } catch (err) {
    console.error('❌ saveScanner:', err);

    res.status(500).json({
      success: false,
      error: 'Erreur serveur. Veuillez réessayer plus tard.'
    });
  }
};

exports.saveSuspension = async (req, res) => {
  const {
    inspection_id,
    usure_pneu_avg, obs_pneu_avg,
    usure_pneu_avd, obs_pneu_avd,
    usure_pneu_arg, obs_pneu_arg,
    usure_pneu_ard, obs_pneu_ard,
    jante_avg, jante_avg_obs,
    jante_avd, jante_avd_obs,
    jante_arg, jante_arg_obs,
    jante_ard, jante_ard_obs,
    corrosion_soubassement, traces_choc,
    notes
  } = req.body;

  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, error: 'Utilisateur non authentifié' });
    }

    const realInspectionId = await ensureInspectionExists(inspection_id, req.user.id);

    await db.query('DELETE FROM inspection_suspension WHERE inspection_id = ?', [realInspectionId]);

    const query = `
      INSERT INTO inspection_suspension (
        inspection_id, technician_id,
        usure_pneu_avg, obs_pneu_avg,
        usure_pneu_avd, obs_pneu_avd,
        usure_pneu_arg, obs_pneu_arg,
        usure_pneu_ard, obs_pneu_ard,
        jante_avg, jante_avg_obs,
        jante_avd, jante_avd_obs,
        jante_arg, jante_arg_obs,
        jante_ard, jante_ard_obs,
        corrosion_soubassement, traces_choc, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await db.query(query, [
      realInspectionId, req.user.id,
      usure_pneu_avg || 'Conforme', obs_pneu_avg || null,
      usure_pneu_avd || 'Conforme', obs_pneu_avd || null,
      usure_pneu_arg || 'Conforme', obs_pneu_arg || null,
      usure_pneu_ard || 'Conforme', obs_pneu_ard || null,
      jante_avg || 'Conforme', jante_avg_obs || null,
      jante_avd || 'Conforme', jante_avd_obs || null,
      jante_arg || 'Conforme', jante_arg_obs || null,
      jante_ard || 'Conforme', jante_ard_obs || null,
      corrosion_soubassement ? 1 : 0, traces_choc ? 1 : 0, notes || null
    ]);

    res.json({ success: true, message: 'Données de suspension enregistrées avec succès' });
  } catch (err) {
    console.error('❌ saveSuspension:', err);
    res.status(500).json({ success: false, error: 'Erreur serveur. Veuillez réessayer plus tard.' });
  }
};

exports.saveTole = async (req, res) => {
  const {
    inspection_id,
    elements_ext_json,
    longerons_status, longerons_obs,
    traverses_status, traverses_obs,
    passage_roues_status, passage_roues_obs,
    fond_coffre_status, fond_coffre_obs,
    chassis_status, chassis_obs,
    optique_status, optique_obs,
    vitre_status, vitre_obs,
    conclusion_structure, notes
  } = req.body;

  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, error: 'Utilisateur non authentifié' });
    }

    const realInspectionId = await ensureInspectionExists(inspection_id, req.user.id);

    await db.query('DELETE FROM inspection_tole WHERE inspection_id = ?', [realInspectionId]);

    const query = `
      INSERT INTO inspection_tole (
        inspection_id, technician_id, elements_ext_json,
        longerons_status, longerons_obs,
        traverses_status, traverses_obs,
        passage_roues_status, passage_roues_obs,
        fond_coffre_status, fond_coffre_obs,
        chassis_status, chassis_obs,
        optique_status, optique_obs,
        vitre_status, vitre_obs,
        conclusion_structure, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await db.query(query, [
      realInspectionId,
      req.user.id,
      JSON.stringify(elements_ext_json || {}),
      longerons_status || 'Conforme', longerons_obs || null,
      traverses_status || 'Conforme', traverses_obs || null,
      passage_roues_status || 'Conforme', passage_roues_obs || null,
      fond_coffre_status || 'Conforme', fond_coffre_obs || null,
      chassis_status || 'Conforme', chassis_obs || null,
      optique_status || 'Conforme', optique_obs || null,
      vitre_status || 'Conforme', vitre_obs || null,
      conclusion_structure || 'Aucun accident détecté',
      notes || null
    ]);

    res.json({ success: true, message: 'Données de carrosserie enregistrées avec succès' });
  } catch (err) {
    console.error('❌ saveTole:', err);
    res.status(500).json({ success: false, error: 'Erreur serveur. Veuillez réessayer plus tard.' });
  }
};

exports.getAllInspections = async (req, res) => {
  try {
    const query = `
      SELECT 
        i.id,
        i.status,
        i.created_at,
        c.full_name AS client_name,
        c.phone AS client_phone,
        v.make AS brand,
        v.model,
        v.license_plate AS plate,
        u.full_name AS technician_name
      FROM inspections i
      LEFT JOIN appointments a ON i.appointment_id = a.id
      LEFT JOIN clients c ON a.client_id = c.id
      LEFT JOIN vehicules v ON a.vehicle_id = v.id
      LEFT JOIN users u ON i.user_id = u.id
      ORDER BY i.created_at DESC
    `;

    const [rows] = await db.query(query);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('❌ getAllInspections:', err);
    res.status(500).json({ success: false, error: 'Erreur serveur. Veuillez réessayer plus tard.' });
  }
};

async function ensureInspectionExists(inspectionId, userId) {
  if (!inspectionId) throw new Error('inspection_id manquant');
  if (!userId) throw new Error('user_id manquant');

  // 1. هل ID المطروح ينتمي لجدول inspections؟
  const [existing] = await db.query(
    'SELECT id FROM inspections WHERE id = ?',
    [inspectionId]
  );
  if (existing.length > 0) return existing[0].id;

  // 2. هل هو appointment_id؟
  const [byAppt] = await db.query(
    'SELECT id FROM inspections WHERE appointment_id = ?',
    [inspectionId]
  );
  if (byAppt.length > 0) return byAppt[0].id;

  // 3. إنشاء السجل باستخدام العمود الصحيح user_id الموجود في Railway
  const [result] = await db.query(
    `INSERT INTO inspections (appointment_id, user_id, created_at)
     VALUES (?, ?, NOW())`,
    [inspectionId, userId]
  );

  return result.insertId;
}

exports.saveGeneral = async (req, res) => {
  const {
    inspection_id,
    nombre_cles,
    rapport_mecanique,
    equipements_secour
  } = req.body;

  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, error: 'Utilisateur non authentifié' });
    }

    const realInspectionId = await ensureInspectionExists(inspection_id, req.user.id);

    const sql = `
      INSERT INTO inspection_general_observations
        (inspection_id, technician_id, nombre_cles, rapport_mecanique, equipements_secour)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        technician_id = VALUES(technician_id),
        nombre_cles = VALUES(nombre_cles),
        rapport_mecanique = VALUES(rapport_mecanique),
        equipements_secour = VALUES(equipements_secour)
    `;

    await db.query(sql, [
      realInspectionId,
      req.user.id,
      nombre_cles || 1,
      rapport_mecanique || null,
      equipements_secour || null
    ]);

    res.json({
      success: true,
      message: 'تم حفظ الملاحظات العامة والتقرير الميكانيكي بنجاح'
    });

  } catch (err) {
    console.error('❌ saveGeneral:', err);
    res.status(500).json({ success: false, error: 'Erreur serveur. Veuillez réessayer plus tard.' });
  }
};

exports.getInspectionDetails = async (req, res) => {
  const { inspection_id } = req.params;

  try {
    const [inspections] = await db.query(
      `SELECT i.*, 
              c.full_name AS client_name, c.phone AS client_phone,
              v.make, v.model, v.license_plate, v.vin_number
       FROM inspections i
       LEFT JOIN appointments a ON i.appointment_id = a.id
       LEFT JOIN clients c ON a.client_id = c.id
       LEFT JOIN vehicules v ON a.vehicle_id = v.id
       WHERE i.id = ? OR i.appointment_id = ?`,
      [inspection_id, inspection_id]
    );

    if (!inspections || inspections.length === 0) {
      return res.status(404).json({ success: false, message: 'Inspection non trouvée' });
    }

    const inspection = inspections[0];
    const realInspectionId = inspection.id;

    // جلب بيانات جميع الوحدات بما فيها الجدول الجديد
    const [
      [kilometrage],
      [scanner],
      [moteur],
      [suspension],
      [tole],
      [general]
    ] = await Promise.all([
      db.query('SELECT * FROM inspection_kilometrage WHERE inspection_id = ?', [realInspectionId]),
      db.query('SELECT * FROM inspection_scanner WHERE inspection_id = ?', [realInspectionId]),
      db.query('SELECT * FROM inspection_moteur WHERE inspection_id = ?', [realInspectionId]),
      db.query('SELECT * FROM inspection_suspension WHERE inspection_id = ?', [realInspectionId]),
      db.query('SELECT * FROM inspection_tole WHERE inspection_id = ?', [realInspectionId]),
      db.query('SELECT * FROM inspection_general_observations WHERE inspection_id = ?', [realInspectionId])
    ]);

    res.json({
      success: true,
      data: {
        inspection,
        kilometrage: kilometrage[0] || null,
        scanner: scanner[0] || null,
        moteur: moteur[0] || null,
        suspension: suspension[0] || null,
        tole: tole[0] || null,
        general: general[0] || null
      }
    });

  } catch (err) {
    console.error('❌ getInspectionDetails Error:', err);
    res.status(500).json({ success: false, error: 'Erreur serveur. Veuillez réessayer plus tard.' });
  }
};

exports.getToleReportById = async (req, res) => {
  const { id } = req.params;

  try {
    const query = `
      SELECT 
        i.id, 
        i.created_at,
        c.full_name AS client_name, 
        c.phone AS client_phone,
        v.make AS brand, 
        v.model, 
        v.license_plate AS plate, 
        v.vin_number,
        km.kilometrage_affiche,
        km.conformite AS km_conformite,
        km.notes AS km_notes,
        km.technician_id AS kilometrage_technician_id,
        mot.niveau_huile, 
        mot.fuite_huile, 
        mot.fuite_liquide_refroidissement, 
        mot.bruit_moteur, 
        mot.fumee_echappement, 
        mot.notes AS moteur_notes,
        mot.technician_id AS moteur_technician_id,
        gen.nombre_cles,
        gen.rapport_mecanique,
        gen.equipements_secour,
        gen.technician_id AS general_technician_id,
        susp.usure_pneu_avg, susp.obs_pneu_avg,
        susp.usure_pneu_avd, susp.obs_pneu_avd,
        susp.usure_pneu_arg, susp.obs_pneu_arg,
        susp.usure_pneu_ard, susp.obs_pneu_ard,
        susp.jante_avg, susp.jante_avg_obs,
        susp.jante_avd, susp.jante_avd_obs,
        susp.jante_arg, susp.jante_arg_obs,
        susp.jante_ard, susp.jante_ard_obs,
        susp.corrosion_soubassement, susp.traces_choc,
        susp.notes AS suspension_notes,
        susp.technician_id AS suspension_technician_id,
        t.elements_ext_json,
        t.longerons_status, t.longerons_obs,
        t.traverses_status, t.traverses_obs,
        t.passage_roues_status, t.passage_roues_obs,
        t.fond_coffre_status, t.fond_coffre_obs,
        t.chassis_status, t.chassis_obs,
        t.optique_status, t.optique_obs,
        t.vitre_status, t.vitre_obs,
        t.conclusion_structure,
        t.notes AS tole_notes,
        t.technician_id AS tole_technician_id
      FROM inspections i
      LEFT JOIN appointments a ON i.appointment_id = a.id
      LEFT JOIN clients c ON a.client_id = c.id
      LEFT JOIN vehicules v ON a.vehicle_id = v.id
      LEFT JOIN inspection_kilometrage km ON i.id = km.inspection_id
      LEFT JOIN inspection_moteur mot ON i.id = mot.inspection_id
      LEFT JOIN inspection_general_observations gen ON i.id = gen.inspection_id
      LEFT JOIN inspection_suspension susp ON i.id = susp.inspection_id
      LEFT JOIN inspection_tole t ON i.id = t.inspection_id
      WHERE i.id = ? OR i.appointment_id = ?
      ORDER BY (i.id = ?) DESC
      LIMIT 1
    `;

    // مطابقة رقم الفحص تُفضَّل دائماً على مطابقة رقم الموعد (يمنع عرض فحص آخر عند تصادف الأرقام)
    const [rows] = await db.query(query, [id, id, id]);

    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Rapport non trouvé' });
    }

    const reportData = rows[0];

    let scannerData = { dtc_codes: null, calculateur_status: 'OK', voyants_allumes: null, scanner_notes: null, scanner_technician_id: null };
    try {
      const [scRows] = await db.query(
        'SELECT dtc_codes, calculateur_status, voyants_allumes, notes AS scanner_notes, technician_id AS scanner_technician_id FROM inspection_scanner WHERE inspection_id = ?',
        [reportData.id]
      );
      if (scRows.length > 0) {
        scannerData = scRows[0];
      }
    } catch (scErr) {
      console.warn('⚠️ Table inspection_scanner non prête:', scErr.message);
    }

    let finalReport = {
      ...reportData,
      ...scannerData,
      niveau_huile: reportData.niveau_huile || 'Non contrôlé'
    };

    // جلب أسماء التقنيين الذين نفّذوا كل وحدة (دفعة واحدة، بدون أي JOIN إضافي بالاستعلام الرئيسي)
    const technicianIdFields = [
      ['scanner_technician_id', 'scanner_technician_name'],
      ['moteur_technician_id', 'moteur_technician_name'],
      ['suspension_technician_id', 'suspension_technician_name'],
      ['tole_technician_id', 'tole_technician_name'],
      ['kilometrage_technician_id', 'kilometrage_technician_name'],
      ['general_technician_id', 'general_technician_name']
    ];
    const distinctIds = [...new Set(
      technicianIdFields.map(([idField]) => finalReport[idField]).filter(Boolean)
    )];

    if (distinctIds.length > 0) {
      const [techRows] = await db.query(
        `SELECT id, full_name FROM users WHERE id IN (${distinctIds.map(() => '?').join(',')})`,
        distinctIds
      );
      const nameById = {};
      techRows.forEach(t => { nameById[t.id] = t.full_name; });

      technicianIdFields.forEach(([idField, nameField]) => {
        finalReport[nameField] = finalReport[idField] ? (nameById[finalReport[idField]] || null) : null;
      });
    } else {
      technicianIdFields.forEach(([, nameField]) => { finalReport[nameField] = null; });
    }

    res.json({ success: true, data: finalReport });

  } catch (err) {
    console.error('❌ getToleReportById Error:', err);
    res.status(500).json({ success: false, error: 'Erreur serveur. Veuillez réessayer plus tard.' });
  }
};

exports.getToleReport = async (req, res) => {
  const { id } = req.params;

  try {
    // 1. Fetch inspection details with client & vehicle info
    const [inspections] = await db.query(`
      SELECT 
        i.*,
        a.client_name,
        a.client_phone,
        a.brand,
        a.model,
        a.plate,
        a.color
      FROM inspections i
      LEFT JOIN appointments a ON i.appointment_id = a.id
      WHERE i.id = ? OR i.appointment_id = ?
    `, [id, id]);

    if (!inspections || inspections.length === 0) {
      return res.status(404).json({ success: false, message: 'Rapport non trouvé' });
    }

    const inspection = inspections[0];

    // 2. Fetch exterior body data
    const [toleRows] = await db.query(
      `SELECT * FROM inspection_tole WHERE inspection_id = ?`,
      [inspection.id]
    );
    const toleData = toleRows[0] || {};

    // 3. Fetch engine, scanner, and general observations data
    const [moteurRows] = await db.query(
      `SELECT * FROM inspection_moteur WHERE inspection_id = ?`,
      [inspection.id]
    );
    const [scannerRows] = await db.query(
      `SELECT * FROM inspection_scanner WHERE inspection_id = ?`,
      [inspection.id]
    );
    const [generalRows] = await db.query(
      `SELECT * FROM inspection_general_observations WHERE inspection_id = ?`,
      [inspection.id]
    );

    // 4. Merge all modules into fullReport
    const fullReport = {
      ...inspection,
      ...toleData,
      niveau_huile: moteurRows[0]?.niveau_huile || null,
      dtc_codes: scannerRows[0]?.dtc_codes || null,
      nombre_cles: generalRows[0]?.nombre_cles || null,
      rapport_mecanique: generalRows[0]?.rapport_mecanique || null,
      equipements_secour: generalRows[0]?.equipements_secour || null
    };

    res.json({ success: true, data: fullReport });

  } catch (error) {
    console.error('❌ Erreur getToleReport:', error);
    res.status(500).json({ success: false, error: 'Erreur serveur. Veuillez réessayer plus tard.' });
  }
};

// إنهاء الفحص يدوياً: يحدّث inspections.status وappointments.status معاً
exports.completeInspection = async (req, res) => {
  const { inspection_id } = req.params;

  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, error: 'Utilisateur non authentifié' });
    }

    // البحث عن الفحص سواء كان المعرّف inspection_id أو appointment_id
    const [rows] = await db.query(
      'SELECT id, appointment_id FROM inspections WHERE id = ? OR appointment_id = ?',
      [inspection_id, inspection_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Inspection introuvable. Veuillez enregistrer au moins un module avant de terminer.' });
    }

    const { id: realInspectionId, appointment_id } = rows[0];

    await db.query(
      `UPDATE inspections SET status = 'COMPLETED' WHERE id = ?`,
      [realInspectionId]
    );

    await db.query(
      `UPDATE appointments SET status = 'COMPLETED', completed_at = CONVERT_TZ(NOW(), '+00:00', '+01:00') WHERE id = ?`,
      [appointment_id]
    );

    res.json({ success: true, message: 'تم إنهاء الفحص بنجاح' });
  } catch (err) {
    console.error('❌ completeInspection:', err);
    res.status(500).json({ success: false, error: 'Erreur serveur. Veuillez réessayer plus tard.' });
  }
};


/* =====================================================================
   تعديل التقرير من طرف الأدمن فقط (محمية بـ requireRole('ADMIN') بالمسارات)
   - لا تلمس technician_id (نسبة العمل للتقني الأصلي تبقى كما هي)
   - كل تعديل يُسجَّل بجدول inspection_edit_log (من/متى/قبل/بعد)
   - تمسح ملخص الذكاء الاصطناعي المخزَّن ليُعاد توليده من البيانات الجديدة
   - معرّف الفحص صريح فقط (inspections.id) — بدون الالتباس مع رقم الموعد
   ===================================================================== */

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function parseInspectionId(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// قراءة بيانات التقرير لشاشة التعديل (الحقول القابلة للتعديل فقط، بدون الصور)
exports.adminGetReportForEdit = async (req, res) => {
  const id = parseInspectionId(req.params.id);
  if (!id) return res.status(400).json({ success: false, error: 'Identifiant de rapport invalide.' });

  try {
    const [headRows] = await db.query(
      `SELECT i.id, i.status, i.created_at,
              c.full_name AS client_name, c.phone AS client_phone,
              v.make AS brand, v.model, v.license_plate AS plate, v.vin_number
       FROM inspections i
       LEFT JOIN appointments a ON i.appointment_id = a.id
       LEFT JOIN clients c ON a.client_id = c.id
       LEFT JOIN vehicules v ON a.vehicle_id = v.id
       WHERE i.id = ?`,
      [id]
    );
    if (headRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Rapport introuvable.' });
    }

    const sections = {};
    const technicianIds = new Set();

    for (const [key, spec] of Object.entries(SPECS)) {
      const cols = Object.keys(spec.fields).map((c) => `\`${c}\``).join(', ');
      const [rows] = await db.query(
        `SELECT ${cols}, technician_id FROM \`${spec.table}\` WHERE inspection_id = ? LIMIT 1`,
        [id]
      );
      if (rows.length > 0) {
        const { technician_id, ...values } = rows[0];
        sections[key] = { exists: true, technicianId: technician_id || null, technicianName: null, values };
        if (technician_id) technicianIds.add(technician_id);
      } else {
        sections[key] = { exists: false, technicianId: null, technicianName: null, values: null };
      }
    }

    if (technicianIds.size > 0) {
      const ids = [...technicianIds];
      const [users] = await db.query(
        `SELECT id, full_name FROM users WHERE id IN (${ids.map(() => '?').join(',')})`,
        ids
      );
      const nameById = {};
      users.forEach((u) => { nameById[u.id] = u.full_name; });
      Object.values(sections).forEach((sec) => {
        if (sec.technicianId) sec.technicianName = nameById[sec.technicianId] || null;
      });
    }

    res.json({ success: true, data: { header: headRows[0], sections } });
  } catch (err) {
    console.error('❌ adminGetReportForEdit:', err);
    res.status(500).json({ success: false, error: 'Erreur serveur. Veuillez réessayer plus tard.' });
  }
};

// حفظ التعديلات: { sections: { moteur: { notes: '...' }, kilometrage: { kilometrage_affiche: 49000 } } }
exports.adminUpdateReport = async (req, res) => {
  const id = parseInspectionId(req.params.id);
  if (!id) return res.status(400).json({ success: false, error: 'Identifiant de rapport invalide.' });

  const { errors, clean } = validateSections(req.body && req.body.sections);
  if (errors.length > 0) {
    return res.status(400).json({ success: false, error: 'Données invalides.', details: errors });
  }
  if (Object.keys(clean).length === 0) {
    return res.json({ success: true, changed: false, message: 'Aucune modification à enregistrer.' });
  }

  let conn;
  try {
    conn = await db.getConnection();
    await conn.beginTransaction();

    // قفل صف الفحص: يمنع تعديلين متزامنين لنفس التقرير
    const [insp] = await conn.query('SELECT id FROM inspections WHERE id = ? FOR UPDATE', [id]);
    if (insp.length === 0) throw new HttpError(404, 'Rapport introuvable.');

    const changes = {};
    const created = [];

    for (const [sectionKey, newValues] of Object.entries(clean)) {
      const spec = SPECS[sectionKey];
      const cols = Object.keys(newValues);
      const quoted = cols.map((c) => `\`${c}\``);

      const [existing] = await conn.query(
        `SELECT ${quoted.join(', ')} FROM \`${spec.table}\` WHERE inspection_id = ? LIMIT 1`,
        [id]
      );

      if (existing.length > 0) {
        const diff = diffSection(existing[0], newValues, spec.fields);
        const changedCols = Object.keys(diff);
        if (changedCols.length === 0) continue;

        await conn.query(
          `UPDATE \`${spec.table}\` SET ${changedCols.map((c) => `\`${c}\` = ?`).join(', ')} WHERE inspection_id = ?`,
          [...changedCols.map((c) => newValues[c]), id]
        );
        changes[sectionKey] = diff;
      } else {
        // قسم لم يُنجَز من قبل: ننشئه بدون نسبته لأي تقني (technician_id يبقى NULL)
        for (const required of spec.requiredOnCreate || []) {
          if (newValues[required] === undefined || newValues[required] === null) {
            throw new HttpError(400, `Cette section n'existe pas encore : le champ « ${required} » est obligatoire pour la créer.`);
          }
        }
        await conn.query(
          `INSERT INTO \`${spec.table}\` (inspection_id, ${quoted.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`,
          [id, ...cols.map((c) => newValues[c])]
        );
        created.push(sectionKey);
        const diff = {};
        cols.forEach((c) => { diff[c] = [null, newValues[c]]; });
        changes[sectionKey] = diff;
      }
    }

    if (Object.keys(changes).length === 0) {
      await conn.rollback();
      return res.json({ success: true, changed: false, message: 'Aucune modification détectée.' });
    }

    // الملخص المخزَّن لم يعد صالحاً: يُعاد توليده عند فتح التقرير
    await conn.query('DELETE FROM inspection_ai_summaries WHERE inspection_id = ?', [id]);

    const logPayload = truncateChangesForLog(changes);
    if (created.length > 0) logPayload._created = created;
    await conn.query(
      'INSERT INTO inspection_edit_log (inspection_id, admin_id, sections, changes) VALUES (?, ?, ?, ?)',
      [id, req.user.id, Object.keys(changes).join(','), JSON.stringify(logPayload)]
    );

    await conn.commit();
    res.json({
      success: true,
      changed: true,
      sections: Object.keys(changes),
      message: 'Rapport mis à jour avec succès.'
    });
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (_) { /* ignore */ } }

    if (err instanceof HttpError) {
      return res.status(err.status).json({ success: false, error: err.message });
    }
    console.error('❌ adminUpdateReport:', err);
    if (err && err.code === 'ER_NO_SUCH_TABLE') {
      return res.status(500).json({
        success: false,
        error: "Configuration incomplète : la table de l'historique des modifications est absente. Exécutez le script SQL fourni."
      });
    }
    res.status(500).json({ success: false, error: 'Erreur serveur. Veuillez réessayer plus tard.' });
  } finally {
    if (conn) conn.release();
  }
};

// سجل التعديلات (آخر 50)
exports.adminGetReportHistory = async (req, res) => {
  const id = parseInspectionId(req.params.id);
  if (!id) return res.status(400).json({ success: false, error: 'Identifiant de rapport invalide.' });

  try {
    const [rows] = await db.query(
      `SELECT l.id, l.sections, l.changes, l.edited_at, u.full_name AS admin_name
       FROM inspection_edit_log l
       LEFT JOIN users u ON u.id = l.admin_id
       WHERE l.inspection_id = ?
       ORDER BY l.id DESC
       LIMIT 50`,
      [id]
    );
    const data = rows.map((r) => {
      let changes = r.changes;
      if (typeof changes === 'string') { try { changes = JSON.parse(changes); } catch (_) { changes = null; } }
      return { id: r.id, editedAt: r.edited_at, adminName: r.admin_name, sections: r.sections, changes };
    });
    res.json({ success: true, data });
  } catch (err) {
    // قبل تشغيل سكربت SQL: الصفحة تعمل والسجل فارغ
    if (err && err.code === 'ER_NO_SUCH_TABLE') return res.json({ success: true, data: [], notice: 'history_table_missing' });
    console.error('❌ adminGetReportHistory:', err);
    res.status(500).json({ success: false, error: 'Erreur serveur. Veuillez réessayer plus tard.' });
  }
};