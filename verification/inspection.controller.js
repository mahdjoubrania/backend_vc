const db = require('../config/db');
// 1. جلب كافة تفاصيل الفحص
exports.getInspectionDetails = async (req, res) => {
  const { inspection_id } = req.params;
  
  try {
    const [kilometrage] = await db.query('SELECT * FROM inspection_kilometrage WHERE inspection_id = ?', [inspection_id]);
    const [scanner] = await db.query('SELECT * FROM inspection_scanner WHERE inspection_id = ?', [inspection_id]);
    const [moteur] = await db.query('SELECT * FROM inspection_moteur WHERE inspection_id = ?', [inspection_id]);
    const [suspension] = await db.query('SELECT * FROM inspection_suspension WHERE inspection_id = ?', [inspection_id]);
    const [tole_elements] = await db.query('SELECT * FROM inspection_tole_elements WHERE inspection_id = ?', [inspection_id]);
    const [car_drawing] = await db.query('SELECT * FROM inspection_car_drawing WHERE inspection_id = ?', [inspection_id]);

    res.json({
      success: true,
      data: {
        kilometrage: kilometrage[0] || null,
        scanner: scanner[0] || null,
        moteur: moteur[0] || null,
        suspension: suspension[0] || null,
        tole_elements: tole_elements || [],
        drawing: car_drawing[0] ? car_drawing[0].drawing_data : null
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// 2. حفظ / تحديث الكيلومتراج
exports.saveKilometrage = async (req, res) => {
  const { inspection_id, kilometrage_affiche, conforme, notes } = req.body;
  const sql = `
    INSERT INTO inspection_kilometrage (inspection_id, kilometrage_affiche, conforme, notes)
    VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE 
      kilometrage_affiche = VALUES(kilometrage_affiche),
      conforme = VALUES(conforme),
      notes = VALUES(notes);
  `;
  try {
    await db.query(sql, [inspection_id, kilometrage_affiche, conforme, notes]);
    res.json({ success: true, message: 'تم حفظ بيانات الكيلومتراج بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// 3. حفظ / تحديث المحرك
exports.saveMoteur = async (req, res) => {
  const { inspection_id, niveau_huile, fuite_huile, fuite_liquide_refroidissement, bruit_moteur, fumee_echappement, notes } = req.body;
  const sql = `
    INSERT INTO inspection_moteur (inspection_id, niveau_huile, fuite_huile, fuite_liquide_refroidissement, bruit_moteur, fumee_echappement, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE 
      niveau_huile = VALUES(niveau_huile),
      fuite_huile = VALUES(fuite_huile),
      fuite_liquide_refroidissement = VALUES(fuite_liquide_refroidissement),
      bruit_moteur = VALUES(bruit_moteur),
      fumee_echappement = VALUES(fumee_echappement),
      notes = VALUES(notes);
  `;
  try {
    await db.query(sql, [inspection_id, niveau_huile, fuite_huile, fuite_liquide_refroidissement, bruit_moteur, fumee_echappement, notes]);
    res.json({ success: true, message: 'تم حفظ بيانات المحرك بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// 4. حفظ / تحديث السكانير
exports.saveScanner = async (req, res) => {
  const { inspection_id, calculateur_status, voyants_allumes, dtc_codes, notes } = req.body;
  const sql = `
    INSERT INTO inspection_scanner (inspection_id, calculateur_status, voyants_allumes, dtc_codes, notes)
    VALUES (?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE 
      calculateur_status = VALUES(calculateur_status),
      voyants_allumes = VALUES(voyants_allumes),
      dtc_codes = VALUES(dtc_codes),
      notes = VALUES(notes);
  `;
  try {
    await db.query(sql, [inspection_id, calculateur_status, voyants_allumes, dtc_codes, notes]);
    res.json({ success: true, message: 'تم حفظ بيانات الماسح بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// 5. حفظ / تحديث نظام التعليق
exports.saveSuspension = async (req, res) => {
  const { inspection_id, amortisseurs_avant, amortisseurs_arriere, pneus_usure, rotules_cremaillere, corrosion_soubassement, notes } = req.body;
  const sql = `
    INSERT INTO inspection_suspension (inspection_id, amortisseurs_avant, amortisseurs_arriere, pneus_usure, rotules_cremaillere, corrosion_soubassement, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE 
      amortisseurs_avant = VALUES(amortisseurs_avant),
      amortisseurs_arriere = VALUES(amortisseurs_arriere),
      pneus_usure = VALUES(pneus_usure),
      rotules_cremaillere = VALUES(rotules_cremaillere),
      corrosion_soubassement = VALUES(corrosion_soubassement),
      notes = VALUES(notes);
  `;
  try {
    await db.query(sql, [inspection_id, amortisseurs_avant, amortisseurs_arriere, pneus_usure, rotules_cremaillere, corrosion_soubassement, notes]);
    res.json({ success: true, message: 'تم حفظ بيانات نظام التعليق بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// 6. حفظ / تحديث الهيكل والرسم
exports.saveTole = async (req, res) => {
  const { inspection_id, drawing_data, elements } = req.body;
  try {
    if (drawing_data) {
      await db.query(`
        INSERT INTO inspection_car_drawing (inspection_id, drawing_data)
        VALUES (?, ?) ON DUPLICATE KEY UPDATE drawing_data = VALUES(drawing_data);
      `, [inspection_id, drawing_data]);
    }

    if (elements && elements.length > 0) {
      await db.query('DELETE FROM inspection_tole_elements WHERE inspection_id = ?', [inspection_id]);
      for (const el of elements) {
        await db.query(
          'INSERT INTO inspection_tole_elements (inspection_id, element_name, peinture, a_froid, choque) VALUES (?, ?, ?, ?, ?)',
          [inspection_id, el.name, el.peinture ? 1 : 0, el.a_froid ? 1 : 0, el.choque ? 1 : 0]
        );
      }
    }

    res.json({ success: true, message: 'تم حفظ الهيكل والرسم بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};