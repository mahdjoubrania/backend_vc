const db = require('../config/db');

exports.getInspectionDetails = async (req, res) => {
  const { inspection_id } = req.params;

  try {
    const [kilometrage] = await db.query(
      'SELECT * FROM inspection_kilometrage WHERE inspection_id = ?',
      [inspection_id]
    );

    const [scanner] = await db.query(
      'SELECT * FROM inspection_scanner WHERE inspection_id = ?',
      [inspection_id]
    );

    const [moteur] = await db.query(
      'SELECT * FROM inspection_moteur WHERE inspection_id = ?',
      [inspection_id]
    );

    const [suspension] = await db.query(
      'SELECT * FROM inspection_suspension WHERE inspection_id = ?',
      [inspection_id]
    );

    const [tole_elements] = await db.query(
      'SELECT * FROM inspection_tole_elements WHERE inspection_id = ?',
      [inspection_id]
    );

    const [visual_marks] = await db.query(
      'SELECT * FROM inspection_visual_marks WHERE inspection_id = ?',
      [inspection_id]
    );

    const [car_drawing] = await db.query(
      'SELECT * FROM inspection_car_drawing WHERE inspection_id = ?',
      [inspection_id]
    );

    res.json({
      success: true,
      data: {
        kilometrage: kilometrage[0] || null,
        scanner: scanner[0] || null,
        moteur: moteur[0] || null,
        suspension: suspension[0] || null,
        tole_elements: tole_elements || [],
        visual_marks: visual_marks || [],
        drawing: car_drawing[0]
          ? car_drawing[0].drawing_data
          : null
      }
    });

  } catch (err) {
    console.error('❌ getInspectionDetails:', err);

    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};

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
        (inspection_id, kilometrage_affiche, conformite, notes)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        kilometrage_affiche = VALUES(kilometrage_affiche),
        conformite = VALUES(conformite),
        notes = VALUES(notes)
    `;

    await db.query(sql, [
      inspection_id,
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
      error: err.message
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
        (inspection_id, niveau_huile, fuite_huile, fuite_liquide_refroidissement, bruit_moteur, fumee_echappement, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        niveau_huile = VALUES(niveau_huile),
        fuite_huile = VALUES(fuite_huile),
        fuite_liquide_refroidissement = VALUES(fuite_liquide_refroidissement),
        bruit_moteur = VALUES(bruit_moteur),
        fumee_echappement = VALUES(fumee_echappement),
        notes = VALUES(notes)
    `;

    await db.query(sql, [
      realInspectionId,
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
    res.status(500).json({ success: false, error: err.message });
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
          calculateur_status,
          voyants_allumes,
          dtc_codes,
          notes
        )
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        calculateur_status = VALUES(calculateur_status),
        voyants_allumes = VALUES(voyants_allumes),
        dtc_codes = VALUES(dtc_codes),
        notes = VALUES(notes)
    `;

    await db.query(sql, [
      realInspectionId,
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
      error: err.message
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
    jante_avg, jante_avd, jante_arg, jante_ard,
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
        inspection_id,
        usure_pneu_avg, obs_pneu_avg,
        usure_pneu_avd, obs_pneu_avd,
        usure_pneu_arg, obs_pneu_arg,
        usure_pneu_ard, obs_pneu_ard,
        jante_avg, jante_avd, jante_arg, jante_ard,
        corrosion_soubassement, traces_choc, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await db.query(query, [
      realInspectionId,
      usure_pneu_avg || 'Conforme', obs_pneu_avg || null,
      usure_pneu_avd || 'Conforme', obs_pneu_avd || null,
      usure_pneu_arg || 'Conforme', obs_pneu_arg || null,
      usure_pneu_ard || 'Conforme', obs_pneu_ard || null,
      jante_avg || 'Conforme', jante_avd || 'Conforme', jante_arg || 'Conforme', jante_ard || 'Conforme',
      corrosion_soubassement ? 1 : 0, traces_choc ? 1 : 0, notes || null
    ]);

    res.json({ success: true, message: 'Données de suspension enregistrées avec succès' });
  } catch (err) {
    console.error('❌ saveSuspension:', err);
    res.status(500).json({ success: false, error: err.message });
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
        inspection_id, elements_ext_json,
        longerons_status, longerons_obs,
        traverses_status, traverses_obs,
        passage_roues_status, passage_roues_obs,
        fond_coffre_status, fond_coffre_obs,
        chassis_status, chassis_obs,
        optique_status, optique_obs,
        vitre_status, vitre_obs,
        conclusion_structure, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await db.query(query, [
      realInspectionId,
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
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getAllInspections = async (req, res) => {
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
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getToleReport = async (req, res) => {
  const { id } = req.params;

  try {
    // 1. جلب بيانات الفحص مع الموعد والزبون
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

    // 2. جلب بيانات الهيكل الخارجي (inspection_tole)
    const [toleRows] = await db.query(
      `SELECT * FROM inspection_tole WHERE inspection_id = ?`,
      [inspection.id]
    );
    const toleData = toleRows[0] || {};

    // 3. جلب بيانات المحرك والماسح الضوئي لإكمال التقرير
    const [moteurRows] = await db.query(
      `SELECT * FROM inspection_moteur WHERE inspection_id = ?`,
      [inspection.id]
    );
    const [scannerRows] = await db.query(
      `SELECT * FROM inspection_scanner WHERE inspection_id = ?`,
      [inspection.id]
    );

    // 4. تجميع كافة البيانات في كائن واحد
    const fullReport = {
      ...inspection,
      ...toleData,
      niveau_huile: moteurRows[0]?.niveau_huile || null,
      dtc_codes: scannerRows[0]?.dtc_codes || null
    };

    res.json({ success: true, data: fullReport });

  } catch (error) {
    console.error('❌ Erreur getToleReport:', error);
    res.status(500).json({ success: false, error: error.message });
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

exports.getToleReportById = async (req, res) => {
  const { id } = req.params;

  try {
    const query = `
      SELECT 
        i.id,
        i.id AS inspection_id,
        i.created_at,
        c.full_name AS client_name,
        c.phone AS client_phone,
        v.make AS brand,
        v.model,
        v.license_plate AS plate,
        km.kilometrage_affiche,
        km.conformite AS km_conformite,
        sc.dtc_codes,
        sc.calculateur_status,
        sc.voyants_allumes,
        t.elements_ext_json,
        t.longerons_status, t.longerons_obs,
        t.traverses_status, t.traverses_obs,
        t.passage_roues_status, t.passage_roues_obs,
        t.fond_coffre_status, t.fond_coffre_obs,
        t.chassis_status, t.chassis_obs,
        t.optique_status, t.optique_obs,
        t.vitre_status, t.vitre_obs,
        t.conclusion_structure,
        mot.niveau_huile
      FROM inspections i
      LEFT JOIN appointments a ON i.appointment_id = a.id
      LEFT JOIN clients c ON a.client_id = c.id
      LEFT JOIN vehicules v ON a.vehicle_id = v.id
      LEFT JOIN inspection_tole t ON i.id = t.inspection_id
      LEFT JOIN inspection_kilometrage km ON i.id = km.inspection_id
      LEFT JOIN inspection_scanner sc ON i.id = sc.inspection_id
      LEFT JOIN inspection_moteur mot ON i.id = mot.inspection_id
      WHERE i.id = ? OR i.appointment_id = ?
    `;

    const [rows] = await db.query(query, [id, id]);

    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Rapport non trouvé' });
    }

    const reportData = rows[0];
    if (!reportData.niveau_huile) {
      reportData.niveau_huile = 'Non contrôlé';
    }

    res.json({ success: true, data: reportData });
  } catch (err) {
    console.error('❌ getToleReportById:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getToleReport = exports.getToleReportById;