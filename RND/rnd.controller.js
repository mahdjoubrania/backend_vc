const db = require('../config/db');

// 1. إحصائيات وتتبعات المواعد (Analytics)
exports.getRdvAnalytics = async (req, res) => {
  try {
    const { period = '15days', startDate, endDate } = req.query;

    // كل حالات الإلغاء/الغياب تُعامل كحالة "Annulé" واحدة (الغياب يُسجَّل كسبب نصي داخل الإلغاء)
    const CANCEL_STATUSES = `'CANCELLED', 'CANCELED', 'ANNULE', 'NO_SHOW', 'ABSENT'`;

    // نطاق التاريخ الحالي (شرط بدون كلمة WHERE، نركّبه بكل استعلام حسب حاجته)
    let dateCondition = '1=1';
    let prevDateCondition = '1=1';
    let queryParams = [];
    let prevQueryParams = [];

    if (period === 'month') {
      dateCondition = 'appointment_date >= DATE_SUB(CURDATE(), INTERVAL 1 MONTH)';
      prevDateCondition = 'appointment_date >= DATE_SUB(CURDATE(), INTERVAL 2 MONTH) AND appointment_date < DATE_SUB(CURDATE(), INTERVAL 1 MONTH)';
    } else if (period === '15days') {
      dateCondition = 'appointment_date >= DATE_SUB(CURDATE(), INTERVAL 15 DAY)';
      prevDateCondition = 'appointment_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND appointment_date < DATE_SUB(CURDATE(), INTERVAL 15 DAY)';
    } else if (period === 'custom' && startDate && endDate) {
      dateCondition = 'DATE(appointment_date) BETWEEN ? AND ?';
      queryParams = [startDate, endDate];

      const diffDays = Math.max(1, Math.round((new Date(endDate) - new Date(startDate)) / 86400000) + 1);
      const prevEnd = new Date(startDate);
      prevEnd.setDate(prevEnd.getDate() - 1);
      const prevStart = new Date(prevEnd);
      prevStart.setDate(prevStart.getDate() - diffDays + 1);
      const toISO = (d) => d.toISOString().split('T')[0];

      prevDateCondition = 'DATE(appointment_date) BETWEEN ? AND ?';
      prevQueryParams = [toISO(prevStart), toISO(prevEnd)];
    } else if (period === 'year') {
      dateCondition = 'YEAR(appointment_date) = YEAR(CURDATE())';
      prevDateCondition = 'YEAR(appointment_date) = YEAR(CURDATE()) - 1';
    }

    // 1. البطاقات العلوية + الإجمالي (للنسب المئوية)
    const [statusCounts] = await db.query(`
      SELECT 
        SUM(CASE WHEN status IN (${CANCEL_STATUSES}) THEN 1 ELSE 0 END) as canceled,
        SUM(CASE WHEN status IN ('IN_PROGRESS', 'IN_WORKSHOP') THEN 1 ELSE 0 END) as incomplete,
        SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
        COUNT(*) as total
      FROM appointments
      WHERE ${dateCondition}
    `, queryParams);

    // 2. نفس البطاقات لكن للفترة السابقة (لحساب سهم المقارنة ↑/↓)
    const [prevStatusCounts] = await db.query(`
      SELECT 
        SUM(CASE WHEN status IN (${CANCEL_STATUSES}) THEN 1 ELSE 0 END) as canceled,
        SUM(CASE WHEN status IN ('IN_PROGRESS', 'IN_WORKSHOP') THEN 1 ELSE 0 END) as incomplete
      FROM appointments
      WHERE ${prevDateCondition}
    `, prevQueryParams);

    // 3. تطور يومي (للرسم الخطي)
    const [dailyTrend] = await db.query(`
      SELECT 
        DATE_FORMAT(appointment_date, '%Y-%m-%d') as date,
        COALESCE(SUM(CASE WHEN status IN (${CANCEL_STATUSES}) THEN 1 ELSE 0 END), 0) as canceled_count
      FROM appointments
      WHERE ${dateCondition}
      GROUP BY DATE_FORMAT(appointment_date, '%Y-%m-%d')
      ORDER BY date ASC
    `, queryParams);

    // 4. أكثر أسباب الإلغاء تكراراً (أعلى 5)
    const [cancelReasons] = await db.query(`
      SELECT cancel_reason AS reason, COUNT(*) AS count
      FROM appointments
      WHERE ${dateCondition}
        AND status IN (${CANCEL_STATUSES})
        AND cancel_reason IS NOT NULL AND cancel_reason != ''
      GROUP BY cancel_reason
      ORDER BY count DESC
      LIMIT 5
    `, queryParams);

    // 5. التوزيع حسب يوم الأسبوع
    const [dowRaw] = await db.query(`
      SELECT 
        DAYOFWEEK(appointment_date) AS dow,
        SUM(CASE WHEN status IN (${CANCEL_STATUSES}) THEN 1 ELSE 0 END) AS canceledCount
      FROM appointments
      WHERE ${dateCondition}
      GROUP BY DAYOFWEEK(appointment_date)
    `, queryParams);

    const dayNames = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']; // DAYOFWEEK: 1=Dimanche..7=Samedi
    const dayOfWeekDistribution = dayNames.map((name, idx) => {
      const row = dowRaw.find(r => r.dow === idx + 1);
      return {
        day: name,
        canceled: row ? Number(row.canceledCount) || 0 : 0
      };
    });

    const result = statusCounts[0] || { canceled: 0, incomplete: 0, completed: 0, total: 0 };
    const prevResult = prevStatusCounts[0] || { canceled: 0, incomplete: 0 };

    // نسبة التغيّر مقارنة بالفترة السابقة (null لو ما فيه بيانات سابقة للمقارنة)
    const pctChange = (current, previous) => {
      if (!previous || previous === 0) return current > 0 ? 100 : null;
      return Math.round(((current - previous) / previous) * 100);
    };

    res.json({
      canceled: result.canceled || 0,
      incomplete: result.incomplete || 0,
      completed: result.completed || 0,
      total: result.total || 0,
      dailyTrend: dailyTrend || [],
      cancelReasons: cancelReasons || [],
      dayOfWeekDistribution,
      trends: {
        canceled: pctChange(result.canceled || 0, prevResult.canceled || 0),
        incomplete: pctChange(result.incomplete || 0, prevResult.incomplete || 0)
      }
    });
  } catch (error) {
    console.error('RDV Analytics Error:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération des données analytiques.' });
  }
};

// 2. ملخص لوحة التحكم (Dashboard Summary)
exports.getDashboardSummary = async (req, res) => {
  try {
    const [userCounts] = await db.query(`
      SELECT 
        COUNT(*) as totalUsers,
        SUM(CASE WHEN role = 'RECEPTION' THEN 1 ELSE 0 END) as receptionCount,
        SUM(CASE WHEN role = 'TECHNICIAN' THEN 1 ELSE 0 END) as techCount,
        SUM(CASE WHEN role = 'ADMIN' THEN 1 ELSE 0 END) as adminCount
      FROM users 
      WHERE is_active = TRUE OR is_active IS NULL
    `);

    // نبض اليوم: مواعيد اليوم / داخل الورشة الآن / اكتملت اليوم / إيراد اليوم (محصّل فعلياً)
    const todayCondition = `DATE(appointment_date) = DATE(CONVERT_TZ(NOW(), '+00:00', '+01:00'))`;

    const [[todayAppointmentsRow]] = await db.query(
      `SELECT COUNT(*) AS count FROM appointments WHERE ${todayCondition}`
    );
    const [[inWorkshopRow]] = await db.query(
      `SELECT COUNT(*) AS count FROM appointments WHERE status IN ('IN_WORKSHOP', 'IN_PROGRESS')`
    );
    const [[completedTodayRow]] = await db.query(
      `SELECT COUNT(*) AS count FROM appointments
       WHERE status = 'COMPLETED' AND DATE(completed_at) = DATE(CONVERT_TZ(NOW(), '+00:00', '+01:00'))`
    );
    const [[revenueTodayRow]] = await db.query(
      `SELECT COALESCE(SUM(versement), 0) AS total FROM appointments WHERE ${todayCondition}`
    );

    // إجمالي المبلغ المتبقي (غير محصّل) عبر كل المواعيد النشطة — مواعيد ملغاة/غائبة لا تُحسب
    const [[outstandingRow]] = await db.query(
      `SELECT COALESCE(SUM(total_amount - versement), 0) AS total
       FROM appointments
       WHERE status NOT IN ('CANCELLED', 'CANCELED', 'ANNULE', 'NO_SHOW', 'ABSENT')`
    );

    const todayStats = {
      todayAppointments: todayAppointmentsRow.count || 0,
      inWorkshopNow: inWorkshopRow.count || 0,
      completedToday: completedTodayRow.count || 0,
      revenueToday: revenueTodayRow.total || 0,
      outstandingTotal: outstandingRow.total || 0
    };

    const [revenueData] = await db.query(`
      SELECT 
        DATE_FORMAT(appointment_date, '%Y-%m-%d') as date,
        MONTH(appointment_date) as month,
        COALESCE(SUM(total_amount), 0) as total_prix,
        COALESCE(SUM(versement), 0) as total_versement
      FROM appointments
      WHERE appointment_date IS NOT NULL
      GROUP BY DATE_FORMAT(appointment_date, '%Y-%m-%d'), MONTH(appointment_date)
      ORDER BY date ASC
    `);

    const [rawTypes] = await db.query(`
      SELECT 
        COALESCE(service_type, 'Non Spécifié') as label,
        COUNT(*) as count
      FROM appointments
      GROUP BY service_type
    `);

    // service_type حقل نص حر قد يحتوي عدة أنواع مفصولة بفاصلة (مثال: "SCANNER, Inspection")
    // نفكك كل قيمة مركّبة ونجمع العدد تحت كل نوع فردي بدل عرضه كفئة منفصلة مكسورة
    const typeCounts = {};
    rawTypes.forEach(row => {
      const parts = String(row.label).split(',').map(s => s.trim()).filter(Boolean);
      const uniqueParts = parts.length > 0 ? parts : ['Non Spécifié'];
      uniqueParts.forEach(part => {
        typeCounts[part] = (typeCounts[part] || 0) + row.count;
      });
    });
    const inspectionTypes = Object.entries(typeCounts).map(([label, count]) => ({ label, count }));

    // أداء التقنيين: عدد الوحدات المنفَّذة فعلياً لكل تقني، عبر الجداول الستة مجتمعة
    const [moduleCounts] = await db.query(`
      SELECT technician_id, COUNT(*) AS count FROM (
        SELECT technician_id FROM inspection_scanner WHERE technician_id IS NOT NULL
        UNION ALL
        SELECT technician_id FROM inspection_moteur WHERE technician_id IS NOT NULL
        UNION ALL
        SELECT technician_id FROM inspection_suspension WHERE technician_id IS NOT NULL
        UNION ALL
        SELECT technician_id FROM inspection_tole WHERE technician_id IS NOT NULL
        UNION ALL
        SELECT technician_id FROM inspection_kilometrage WHERE technician_id IS NOT NULL
        UNION ALL
        SELECT technician_id FROM inspection_general_observations WHERE technician_id IS NOT NULL
      ) AS all_modules
      GROUP BY technician_id
      ORDER BY count DESC
    `);

    let technicianPerformance = [];
    if (moduleCounts.length > 0) {
      const technicianIds = moduleCounts.map(r => r.technician_id);
      const [techRows] = await db.query(
        `SELECT id, full_name FROM users WHERE id IN (${technicianIds.map(() => '?').join(',')})`,
        technicianIds
      );
      const nameById = {};
      techRows.forEach(t => { nameById[t.id] = t.full_name; });

      technicianPerformance = moduleCounts.map(r => ({
        technicianId: r.technician_id,
        technicianName: nameById[r.technician_id] || `Technicien #${r.technician_id}`,
        modulesCompleted: r.count
      }));
    }

    // تنبيهات تشغيلية: 1) مواعيد بالورشة تجاوزت الساعة فعلياً (من started_at الحقيقي)
    const [overdueWorkshop] = await db.query(`
      SELECT 
        a.id, 
        c.full_name AS client_name,
        COALESCE(NULLIF(TRIM(CONCAT(COALESCE(v.make,''), ' ', COALESCE(v.model,''))), ''), 'Véhicule') AS vehicle_name,
        a.started_at,
        TIMESTAMPDIFF(MINUTE, a.started_at, CONVERT_TZ(NOW(), '+00:00', '+01:00')) AS minutesElapsed
      FROM appointments a
      LEFT JOIN clients c ON a.client_id = c.id
      LEFT JOIN vehicules v ON a.vehicle_id = v.id
      WHERE a.status IN ('IN_WORKSHOP', 'IN_PROGRESS')
        AND a.started_at IS NOT NULL
        AND TIMESTAMPDIFF(MINUTE, a.started_at, CONVERT_TZ(NOW(), '+00:00', '+01:00')) > 60
      ORDER BY minutesElapsed DESC
      LIMIT 10
    `);

    // تنبيهات تشغيلية: 2) فحوصات مكتملة لكن فيها رصيد غير محصّل
    const [unpaidCompleted] = await db.query(`
      SELECT 
        a.id, 
        c.full_name AS client_name,
        COALESCE(NULLIF(TRIM(CONCAT(COALESCE(v.make,''), ' ', COALESCE(v.model,''))), ''), 'Véhicule') AS vehicle_name,
        a.total_amount, a.versement,
        (a.total_amount - a.versement) AS remaining
      FROM appointments a
      LEFT JOIN clients c ON a.client_id = c.id
      LEFT JOIN vehicules v ON a.vehicle_id = v.id
      WHERE a.status = 'COMPLETED'
        AND (a.total_amount - a.versement) > 0
      ORDER BY remaining DESC
      LIMIT 10
    `);

    const alerts = { overdueWorkshop, unpaidCompleted };

    res.json({
      users: userCounts[0] || { totalUsers: 0, receptionCount: 0, techCount: 0, adminCount: 0 },
      todayStats,
      revenue: revenueData || [],
      inspectionTypes: inspectionTypes || [],
      technicianPerformance,
      alerts
    });
  } catch (error) {
    console.error('Dashboard Error:', error);
    res.status(500).json({ message: 'Erreur serveur lors de la récupération des données.' });
  }
};

// 3. جلب مواعيد اليوم فقط (اليوم الحالي حسب التوقيت المحلي)
exports.getTodayAppointments = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        a.id,
        c.full_name AS client_name,
        a.tlf AS phone,
        COALESCE(NULLIF(TRIM(CONCAT(COALESCE(v.make,''), ' ', COALESCE(v.model,''))), ''), 'Non Spécifié') AS vehicle_name,
        COALESCE(v.license_plate, a.VIN, 'Non Spécifié') AS license_plate,
        a.VIN,
        COALESCE(a.service_type, 'Inspection') AS service_type,
        a.appointment_date,
        a.status,
        a.cancel_reason,
        a.started_at,
        a.completed_at,
        COALESCE(a.payment_status, 'PENDING_VERSEMENT') AS payment_status,
        COALESCE(a.total_amount, 0) AS total_amount,
        COALESCE(a.versement, 0) AS versement,
        a.notes
      FROM appointments a
      LEFT JOIN clients c ON a.client_id = c.id
      LEFT JOIN vehicules v ON a.vehicle_id = v.id
      WHERE DATE(a.appointment_date) = DATE(CONVERT_TZ(NOW(), '+00:00', '+01:00'))
      ORDER BY a.appointment_date ASC
    `);

    res.json(rows);
  } catch (error) {
    console.error('Error fetching today appointments:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération des RDV du jour' });
  }
};

// 4. جلب كافة المواعيد (تاريخ تنازلي)
exports.getAppointments = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        a.id,
        c.full_name AS client_name,
        a.tlf AS phone,
        COALESCE(NULLIF(TRIM(CONCAT(COALESCE(v.make,''), ' ', COALESCE(v.model,''))), ''), 'Non Spécifié') AS vehicle_name,
        COALESCE(v.license_plate, a.VIN, 'Non Spécifié') AS license_plate,
        a.VIN,
        COALESCE(a.service_type, 'Inspection') AS service_type,
        a.appointment_date,
        a.status,
        a.cancel_reason,
        a.started_at,
        a.completed_at,
        COALESCE(a.payment_status, 'PENDING_VERSEMENT') AS payment_status,
        COALESCE(a.total_amount, 0) AS total_amount,
        COALESCE(a.versement, 0) AS versement,
        a.notes
      FROM appointments a
      LEFT JOIN clients c ON a.client_id = c.id
      LEFT JOIN vehicules v ON a.vehicle_id = v.id
      ORDER BY a.appointment_date DESC
    `);

    res.json(rows);
  } catch (error) {
    console.error('Error fetching appointments:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération des RDV' });
  }
};

// 5. إنشاء موعد جديد
// يعيد رقم المركبة (موجودة أو منشأة حديثاً) أو null إن تعذّر.
// كان الإنشاء يتم فقط عند وجود VIN، فتضيع الماركة والترقيم لو تُرك VIN فارغاً (وهو اختياري بالنموذج).
// فشل إنشاء المركبة لا يوقف حفظ الموعد نفسه.
async function findOrCreateVehicle(clientId, { vin, licensePlate, make, model }) {
  const cleanVin = vin ? String(vin).trim() : '';
  const cleanPlate = licensePlate ? String(licensePlate).trim() : '';
  if (!cleanVin && !cleanPlate) return null;

  try {
    if (cleanVin) {
      const [byVin] = await db.query('SELECT id FROM vehicules WHERE vin_number = ? LIMIT 1', [cleanVin]);
      if (byVin.length > 0) return byVin[0].id;
    }
    if (cleanPlate) {
      const [byPlate] = await db.query('SELECT id FROM vehicules WHERE license_plate = ? LIMIT 1', [cleanPlate]);
      if (byPlate.length > 0) return byPlate[0].id;
    }
    const [created] = await db.query(
      'INSERT INTO vehicules (client_id, make, model, license_plate, vin_number) VALUES (?, ?, ?, ?, ?)',
      [clientId, make || 'Inconnu', model || 'Inconnu', cleanPlate || null, cleanVin || null]
    );
    return created.insertId;
  } catch (err) {
    console.warn('⚠️ Création/recherche du véhicule impossible, rendez-vous enregistré sans véhicule:', err.message);
    return null;
  }
}

exports.createAppointment = async (req, res) => {
  try {
    const { 
      clientName, 
      phone, 
      vin, 
      make, 
      model, 
      licensePlate,
      appointmentDate, 
      totalAmount, 
      versement, 
      paymentStatus, 
      status,
      typedeverification,
      notes
    } = req.body;

    if (!phone) {
      return res.status(400).json({ message: 'Le numéro de téléphone est obligatoire.' });
    }

    let clientId;
    const [existingClient] = await db.query('SELECT id FROM clients WHERE phone = ?', [phone]);

    if (existingClient.length > 0) {
      clientId = existingClient[0].id;
    } else {
      const [newClient] = await db.query(
        'INSERT INTO clients (full_name, phone) VALUES (?, ?)',
        [clientName || 'Nouveau Client', phone]
      );
      clientId = newClient.insertId;
    }

    const vehicleId = await findOrCreateVehicle(clientId, { vin, licensePlate, make, model });

    const baseParams = [
      clientId,
      phone,
      vehicleId,
      vin || null,
      appointmentDate,
      totalAmount || 0,
      versement || 0,
      paymentStatus || 'PENDING_VERSEMENT',
      status || 'PENDING',
      typedeverification || 'Inspection'
    ];
    const cleanNotes = (notes ? String(notes).trim() : '') || null;

    // كانت الملاحظات المكتوبة بنموذج الإنشاء تضيع بصمت (لا تُدرج بالـ INSERT)
    let result;
    try {
      [result] = await db.query(
        `INSERT INTO appointments 
         (client_id, tlf, vehicle_id, VIN, appointment_date, total_amount, versement, payment_status, status, service_type, notes) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [...baseParams, cleanNotes]
      );
    } catch (insertErr) {
      if (insertErr.code !== 'ER_BAD_FIELD_ERROR') throw insertErr;
      console.warn('⚠️ Colonne appointments.notes absente — création sans remarques.');
      [result] = await db.query(
        `INSERT INTO appointments 
         (client_id, tlf, vehicle_id, VIN, appointment_date, total_amount, versement, payment_status, status, service_type) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        baseParams
      );
    }

    res.status(201).json({ 
      message: 'Rendez-vous créé avec succès', 
      appointmentId: result.insertId,
      clientId: clientId,
      vehicleId: vehicleId
    });

  } catch (error) {
    console.error('Error creating appointment:', error);
    res.status(500).json({ message: 'Erreur lors de la création du RDV: ' + error.message });
  }
};

// 6. تحديث حالة الموعد والكرونو وسبب الإلغاء
exports.updateAppointmentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, cancel_reason } = req.body;

    const VALID_STATUSES = ['PENDING', 'READY_FOR_WORKSHOP', 'IN_WORKSHOP', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'ABSENT'];
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ message: 'Statut invalide.' });
    }

    let query = `UPDATE appointments SET status = ?`;
    let queryParams = [status];

    if (['IN_PROGRESS', 'IN_WORKSHOP'].includes(status)) {
      query += `, started_at = COALESCE(started_at, CONVERT_TZ(NOW(), '+00:00', '+01:00'))`;
    } else if (status === 'COMPLETED') {
      query += `, completed_at = CONVERT_TZ(NOW(), '+00:00', '+01:00')`;
    }

    if (cancel_reason) {
      query += `, cancel_reason = ?`;
      queryParams.push(cancel_reason);
    }

    query += ` WHERE id = ?`;
    queryParams.push(id);

    await db.query(query, queryParams);
    res.json({ message: 'Statut mis à jour avec succès' });
  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({ message: 'Erreur lors de la mise à jour' });
  }
};

// 7. تحديث حالة الدفع
exports.updatePaymentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { payment_status } = req.body;

    if (!['PENDING_VERSEMENT', 'ADVANCE_PAID', 'FULLY_PAID'].includes(payment_status)) {
      return res.status(400).json({ message: 'Statut de paiement invalide.' });
    }

    if (payment_status === 'FULLY_PAID') {
      // "Payé" يجب أن ينعكس على المبلغ المدفوع، وإلا يبقى الأدمن يرى مبلغاً متبقياً (الإيراد/المتبقي محسوبان من versement)
      await db.query(
        `UPDATE appointments SET payment_status = ?, versement = total_amount WHERE id = ?`,
        [payment_status, id]
      );
    } else {
      await db.query(`UPDATE appointments SET payment_status = ? WHERE id = ?`, [payment_status, id]);
    }
    res.json({ message: 'Statut de paiement mis à jour' });
  } catch (error) {
    res.status(500).json({ message: 'Erreur lors de la mise à jour du paiement' });
  }
};

// 8. تعديل بيانات الموعد بالكامل مع السيارة والعميل
exports.updateAppointment = async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      clientName, 
      phone, 
      make, 
      model, 
      licensePlate, 
      vin, 
      serviceType, 
      appointmentDate, 
      totalAmount, 
      versement, 
      paymentStatus, 
      notes 
    } = req.body;

    // تنظيف صيغة التاريخ المستلمة وتثبيتها بتنسيق SQL YYYY-MM-DD HH:MM:SS
    let cleanDate = null;
    if (appointmentDate) {
      cleanDate = appointmentDate.replace('T', ' ').replace('Z', '').split('.')[0];
    }

    // 1. جلب بيانات الموعد
    const [rdv] = await db.query('SELECT client_id, vehicle_id, appointment_date FROM appointments WHERE id = ?', [id]);
    if (rdv.length === 0) {
      return res.status(404).json({ message: 'Rendez-vous non trouvé' });
    }

    const { client_id, vehicle_id, appointment_date: existingDate } = rdv[0];
    
    // في حال لم ترسل تاريخًا جديدًا، يتم الاحتفاظ بالتاريخ القديم
    const finalDate = cleanDate || existingDate;

    // 2. تحديث جدول المواعيد
    await db.query(
      `UPDATE appointments SET 
        tlf = ?, 
        VIN = ?, 
        service_type = ?, 
        appointment_date = ?, 
        total_amount = ?, 
        versement = ?, 
        payment_status = COALESCE(?, payment_status), 
        notes = COALESCE(?, notes) 
       WHERE id = ?`,
      [
        phone || null, 
        vin || null, 
        serviceType || 'Inspection', 
        finalDate, 
        totalAmount || 0, 
        versement || 0, 
        paymentStatus || 'PENDING_VERSEMENT', 
        (notes === undefined || notes === null) ? null : String(notes), 
        id
      ]
    );

    // 3. تحديث جدول العملاء
    if (client_id) {
      await db.query(
        `UPDATE clients SET full_name = ?, phone = ? WHERE id = ?`,
        [clientName || 'Client', phone || '', client_id]
      );
    }

    // 4. تحديث جدول السيارات
    // موعد أُنشئ بلا مركبة: ننشئها الآن (كان تعديل بيانات السيارة يُتجاهل بصمت مع رسالة نجاح)
    let effectiveVehicleId = vehicle_id;
    if (!effectiveVehicleId) {
      effectiveVehicleId = await findOrCreateVehicle(client_id, { vin, licensePlate, make, model });
      if (effectiveVehicleId) {
        await db.query('UPDATE appointments SET vehicle_id = ? WHERE id = ?', [effectiveVehicleId, id]);
      }
    } else {
      await db.query(
        `UPDATE vehicules SET make = ?, model = ?, license_plate = ?, vin_number = ? WHERE id = ?`,
        [make || 'Inconnu', model || 'Inconnu', licensePlate || '', vin || null, vehicle_id]
      );
    }

    res.json({ message: 'Rendez-vous mis à jour avec succès' });
  } catch (error) {
    console.error('Update appointment error:', error);
    res.status(500).json({ message: 'Erreur lors de la modification: ' + error.message });
  }
};
// 9. جلب المواعيد الملغاة والغائبة
exports.getCancelledAppointments = async (req, res) => {
  try {
    const { period, startDate, endDate } = req.query;

    // نفس منطق الفلترة المستخدم بـ getRdvAnalytics — لو ما تحدد period، نرجّع كل التاريخ (سلوك قديم محفوظ)
    let dateClause = '';
    let queryParams = [];

    if (period === 'month') {
      dateClause = 'AND a.appointment_date >= DATE_SUB(CURDATE(), INTERVAL 1 MONTH)';
    } else if (period === '15days') {
      dateClause = 'AND a.appointment_date >= DATE_SUB(CURDATE(), INTERVAL 15 DAY)';
    } else if (period === 'custom' && startDate && endDate) {
      dateClause = 'AND DATE(a.appointment_date) BETWEEN ? AND ?';
      queryParams = [startDate, endDate];
    } else if (period === 'year') {
      dateClause = 'AND YEAR(a.appointment_date) = YEAR(CURDATE())';
    }

    const [rows] = await db.query(`
      SELECT 
        a.id,
        a.client_id,
        c.full_name AS client_name,
        a.tlf AS phone,
        CONCAT(COALESCE(v.make,''), ' ', COALESCE(v.model,'')) AS vehicle_name,
        a.VIN,
        COALESCE(a.service_type, 'Inspection') AS service_type,
        a.appointment_date,
        a.status,
        a.cancel_reason
      FROM appointments a
      LEFT JOIN clients c ON a.client_id = c.id
      LEFT JOIN vehicules v ON a.vehicle_id = v.id
      WHERE a.status IN ('CANCELLED', 'CANCELED', 'NO_SHOW', 'ANNULE', 'ABSENT')
      ${dateClause}
      ORDER BY a.appointment_date DESC
    `, queryParams);

    // عملاء متكررو الإلغاء/الغياب: نحسب على كل التاريخ (مو بس الفترة المعروضة)، لأنها صفة عن العميل نفسه
    const clientIds = [...new Set(rows.map(r => r.client_id).filter(Boolean))];
    if (clientIds.length > 0) {
      const [repeatCounts] = await db.query(
        `SELECT client_id, COUNT(*) AS total_cancel_count
         FROM appointments
         WHERE client_id IN (${clientIds.map(() => '?').join(',')})
           AND status IN ('CANCELLED', 'CANCELED', 'NO_SHOW', 'ANNULE', 'ABSENT')
         GROUP BY client_id`,
        clientIds
      );
      const countByClient = {};
      repeatCounts.forEach(r => { countByClient[r.client_id] = r.total_cancel_count; });
      rows.forEach(r => { r.client_cancel_count = countByClient[r.client_id] || 1; });
    }

    res.json(rows);
  } catch (error) {
    console.error('Error fetching cancelled appointments:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération des RDV annulés' });
  }
};