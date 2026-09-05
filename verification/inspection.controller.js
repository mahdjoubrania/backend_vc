const db = require('../config/db');

// ============================================================
// Helper: التأكد من وجود Inspection
// ============================================================
async function ensureInspectionExists(inspectionId, userId) {
  if (!inspectionId) {
    throw new Error('inspection_id manquant');
  }

  if (!userId) {
    throw new Error('user_id manquant');
  }

  // 1. هل inspection_id هو ID حقيقي للفحص؟
  const [existing] = await db.query(
    'SELECT id FROM inspections WHERE id = ?',
    [inspectionId]
  );

  if (existing.length > 0) {
    return existing[0].id;
  }

  // 2. هل inspectionId هو appointment_id؟
  const [byAppt] = await db.query(
    'SELECT id FROM inspections WHERE appointment_id = ?',
    [inspectionId]
  );

  if (byAppt.length > 0) {
    return byAppt[0].id;
  }

  // 3. إنشاء Inspection جديد
  const [result] = await db.query(
    `INSERT INTO inspections
      (appointment_id, user_id, created_at)
     VALUES (?, ?, NOW())`,
    [inspectionId, userId]
  );

  return result.insertId;
}


// ============================================================
// 1. جلب كافة تفاصيل الفحص
// ============================================================
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


// ============================================================
// 2. حفظ / تحديث الكيلومتراج
// ============================================================
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


// ============================================================
// 3. حفظ / تحديث المحرك
// ============================================================
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
      INSERT INTO inspection_moteur
        (
          inspection_id,
          niveau_huile,
          fuite_huile,
          fuite_liquide_refroidissement,
          bruit_moteur,
          fumee_echappement,
          notes
        )
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
      fuite_huile,
      fuite_liquide_refroidissement,
      bruit_moteur,
      fumee_echappement,
      notes
    ]);

    res.json({
      success: true,
      message: 'تم حفظ بيانات المحرك بنجاح'
    });

  } catch (err) {
    console.error('❌ saveMoteur:', err);

    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};


// ============================================================
// 4. حفظ / تحديث السكانير
// ============================================================
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

// ============================================================
// 5. حفظ / تحديث نظام التعليق
// ============================================================
exports.saveSuspension = async (req, res) => {

  const {
    inspection_id,
    amortisseurs_avant,
    amortisseurs_arriere,
    pneus_usure,
    rotules_cremaillere,
    corrosion_soubassement,
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
      INSERT INTO inspection_suspension
        (
          inspection_id,
          amortisseurs_avant,
          amortisseurs_arriere,
          pneus_usure,
          rotules_cremaillere,
          corrosion_soubassement,
          notes
        )
      VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
  amortisseurs_avant = VALUES(amortisseurs_avant),
  amortisseurs_arriere = VALUES(amortisseurs_arriere),
  pneus_usure = VALUES(pneus_usure),
  rotules_cremaillere = VALUES(rotules_cremaillere), 
  corrosion_soubassement = VALUES(corrosion_soubassement),
  notes = VALUES(notes)
    `;

    await db.query(sql, [
      realInspectionId,
      amortisseurs_avant,
      amortisseurs_arriere,
      pneus_usure,
      rotules_cremaillerie,
      corrosion_soubassement,
      notes
    ]);

    res.json({
      success: true,
      message: 'تم حفظ بيانات نظام التعليق بنجاح'
    });

  } catch (err) {
    console.error('❌ saveSuspension:', err);

    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};


// ============================================================
// 6. حفظ / تحديث الهيكل والرسم والعلامات
// ============================================================
exports.saveTole = async (req, res) => {
  const {
    inspection_id,
    drawing_data,
    elements,
    visual_marks
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

    // 1. رسم السيارة
    if (drawing_data) {
      await db.query(`
        INSERT INTO inspection_car_drawing
          (inspection_id, drawing_data)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE
          drawing_data = VALUES(drawing_data)
      `, [
        realInspectionId,
        drawing_data
      ]);
    }

    // 2. عناصر الهيكل
    if (elements && Array.isArray(elements)) {

      await db.query(
        'DELETE FROM inspection_tole_elements WHERE inspection_id = ?',
        [realInspectionId]
      );

      for (const el of elements) {
        await db.query(
          `
          INSERT INTO inspection_tole_elements
            (
              inspection_id,
              element_name,
              peinture,
              a_froid,
              choque
            )
          VALUES (?, ?, ?, ?, ?)
          `,
          [
            realInspectionId,
            el.name,
            el.peinture ? 1 : 0,
            el.a_froid ? 1 : 0,
            el.choque ? 1 : 0
          ]
        );
      }
    }

    // 3. العلامات المرئية
    if (visual_marks && Array.isArray(visual_marks)) {

      await db.query(
        'DELETE FROM inspection_visual_marks WHERE inspection_id = ?',
        [realInspectionId]
      );

      for (const mark of visual_marks) {
        await db.query(
          `
          INSERT INTO inspection_visual_marks
            (
              inspection_id,
              mark_type,
              color_code,
              pos_x,
              pos_y,
              notes
            )
          VALUES (?, ?, ?, ?, ?, ?)
          `,
          [
            realInspectionId,
            mark.mark_type,
            mark.color_code,
            mark.pos_x,
            mark.pos_y,
            mark.notes || null
          ]
        );
      }
    }

    res.json({
      success: true,
      message: 'تم حفظ بيانات الهيكل والمخطط بنجاح'
    });

  } catch (err) {
    console.error('❌ saveTole:', err);

    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};