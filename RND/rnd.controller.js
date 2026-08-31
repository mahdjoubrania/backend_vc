const db = require('../config/db');

// 1. إحصائيات وتتبعات المواعد (Analytics)
exports.getRdvAnalytics = async (req, res) => {
  try {
    const { period = '15days', startDate, endDate } = req.query;

    const [statusCounts] = await db.query(`
      SELECT 
        SUM(CASE WHEN status IN ('NO_SHOW', 'ABSENT') THEN 1 ELSE 0 END) as noShow,
        SUM(CASE WHEN status IN ('CANCELLED', 'CANCELED', 'ANNULE') THEN 1 ELSE 0 END) as canceled,
        SUM(CASE WHEN status = 'IN_PROGRESS' THEN 1 ELSE 0 END) as incomplete,
        SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed
      FROM appointments
    `);

    let whereClause = '';
    let queryParams = [];

    if (period === 'month') {
      whereClause = 'WHERE appointment_date >= DATE_SUB(CURDATE(), INTERVAL 1 MONTH)';
    } else if (period === '15days') {
      whereClause = 'WHERE appointment_date >= DATE_SUB(CURDATE(), INTERVAL 15 DAY)';
    } else if (period === 'custom' && startDate && endDate) {
      whereClause = 'WHERE DATE(appointment_date) BETWEEN ? AND ?';
      queryParams = [startDate, endDate];
    } else if (period === 'year') {
      whereClause = 'WHERE YEAR(appointment_date) = YEAR(CURDATE())';
    }

    const [dailyTrend] = await db.query(`
      SELECT 
        DATE_FORMAT(appointment_date, '%Y-%m-%d') as date,
        COALESCE(SUM(CASE WHEN status IN ('NO_SHOW', 'ABSENT') THEN 1 ELSE 0 END), 0) as no_show_count,
        COALESCE(SUM(CASE WHEN status IN ('CANCELLED', 'CANCELED', 'ANNULE') THEN 1 ELSE 0 END), 0) as canceled_count
      FROM appointments
      ${whereClause}
      GROUP BY DATE_FORMAT(appointment_date, '%Y-%m-%d')
      ORDER BY date ASC
    `, queryParams);

    const result = statusCounts[0] || { noShow: 0, canceled: 0, incomplete: 0, completed: 0 };

    res.json({
      noShow: result.noShow || 0,
      canceled: result.canceled || 0,
      incomplete: result.incomplete || 0,
      completed: result.completed || 0,
      dailyTrend: dailyTrend || []
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

    const [inspectionTypes] = await db.query(`
      SELECT 
        COALESCE(service_type, 'Non Spécifié') as label,
        COUNT(*) as count
      FROM appointments
      GROUP BY service_type
    `);

    res.json({
      users: userCounts[0] || { totalUsers: 0, receptionCount: 0, techCount: 0, adminCount: 0 },
      revenue: revenueData || [],
      inspectionTypes: inspectionTypes || []
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
        COALESCE(a.versement, 0) AS versement
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
        COALESCE(a.versement, 0) AS versement
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
      typedeverification 
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

    let vehicleId = null;
    if (vin) {
      const [existingVehicle] = await db.query('SELECT id FROM vehicules WHERE vin_number = ?', [vin]);
      if (existingVehicle.length > 0) {
        vehicleId = existingVehicle[0].id;
      } else {
        const [newVehicle] = await db.query(
          'INSERT INTO vehicules (client_id, make, model, license_plate, vin_number) VALUES (?, ?, ?, ?, ?)',
          [clientId, make || 'Inconnu', model || 'Inconnu', licensePlate || null, vin]
        );
        vehicleId = newVehicle.insertId;
      }
    }

    const [result] = await db.query(
      `INSERT INTO appointments 
       (client_id, tlf, vehicle_id, VIN, appointment_date, total_amount, versement, payment_status, status, service_type) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        clientId, 
        phone, 
        vehicleId, 
        vin || null, 
        appointmentDate, 
        totalAmount || 0, 
        versement || 0, 
        paymentStatus || 'PENDING_VERSEMENT', 
        status || 'PENDING',
        typedeverification || ''
      ]
    );

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
    await db.query(`UPDATE appointments SET payment_status = ? WHERE id = ?`, [payment_status, id]);
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

    // 1. جلب IDs العميل والسيارة الخاصة بهذا الموعد
    const [rdv] = await db.query('SELECT client_id, vehicle_id FROM appointments WHERE id = ?', [id]);
    if (rdv.length === 0) {
      return res.status(404).json({ message: 'Rendez-vous non trouvé' });
    }

    const { client_id, vehicle_id } = rdv[0];

    // 2. تحديث جدول المواعيد (تم حذف العمود notes من الاستعلام)
    await db.query(
      `UPDATE appointments SET 
        tlf = ?, 
        VIN = ?, 
        service_type = ?, 
        appointment_date = ?, 
        total_amount = ?, 
        versement = ?, 
        payment_status = COALESCE(?, payment_status)
       WHERE id = ?`,
      [
        phone || null, 
        vin || null, 
        serviceType || 'Inspection', 
        appointmentDate || null, 
        totalAmount || 0, 
        versement || 0, 
        paymentStatus || 'PENDING_VERSEMENT', 
        id
      ]
    );

    // 3. تحديث جدول العملاء clients
    if (client_id) {
      await db.query(
        `UPDATE clients SET full_name = ?, phone = ? WHERE id = ?`,
        [clientName || 'Client', phone || '', client_id]
      );
    }

    // 4. تحديث جدول السيارات vehicules
    if (vehicle_id) {
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
    const [rows] = await db.query(`
      SELECT 
        a.id,
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
      ORDER BY a.appointment_date DESC
    `);

    res.json(rows);
  } catch (error) {
    console.error('Error fetching cancelled appointments:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération des RDV annulés' });
  }
};