const db = require('../config/db');
const bcrypt = require('bcryptjs');

// 1. Récupérer tous les utilisateurs
exports.getAllUsers = async (req, res) => {
  try {
    const [users] = await db.query(
      'SELECT id, full_name AS fullName, phone, role, is_active AS isActive, created_at FROM users ORDER BY id DESC'
    );
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 2. Créer un nouvel utilisateur
exports.createUser = async (req, res) => {
  const { fullName, phone, role, password } = req.body;

  if (!fullName || !phone || !password || !role) {
    return res.status(400).json({ 
      message: 'Tous les champs sont obligatoires (fullName, phone, role, password).' 
    });
  }

  try {
    const [existing] = await db.query('SELECT id FROM users WHERE phone = ?', [phone]);
    if (existing.length > 0) {
      return res.status(400).json({ message: 'Ce numéro de téléphone est déjà utilisé.' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const [result] = await db.query(
      'INSERT INTO users (full_name, phone, role, password_hash) VALUES (?, ?, ?, ?)',
      [fullName, phone, role, hashedPassword]
    );

    res.status(201).json({
      message: 'Utilisateur créé avec succès.',
      userId: result.insertId
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 3. Modifier les informations d'un utilisateur
exports.updateUserRole = async (req, res) => {
  const { userId } = req.params;
  const { fullName, phone, role, password, isActive } = req.body;

  try {
    let hashedPassword = null;
    if (password) {
      const salt = await bcrypt.genSalt(10);
      hashedPassword = await bcrypt.hash(password, salt);
    }

    const [result] = await db.query(
      `UPDATE users SET 
        full_name = COALESCE(?, full_name),
        phone = COALESCE(?, phone),
        role = COALESCE(?, role),
        password_hash = COALESCE(?, password_hash),
        is_active = COALESCE(?, is_active)
      WHERE id = ?`,
      [fullName || null, phone || null, role || null, hashedPassword, isActive !== undefined ? isActive : null, userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Utilisateur introuvable.' });
    }

    res.json({ message: 'Modifications enregistrées avec succès.' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 4. Désactiver un compte utilisateur
exports.deleteUser = async (req, res) => {
  const { userId } = req.params;

  try {
    const [result] = await db.query('UPDATE users SET is_active = 0 WHERE id = ?', [userId]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Utilisateur introuvable.' });
    }

    res.json({ message: 'Compte utilisateur désactivé avec succès.' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Tableau de bord Summary
exports.getDashboardSummary = async (req, res) => {
  try {
    // 1. حساب المستخدمين وحالاتهم بحسب الأدوار
    const [userCounts] = await db.query(`
      SELECT 
        COUNT(*) as totalUsers,
        SUM(CASE WHEN role = 'RECEPTION' THEN 1 ELSE 0 END) as receptionCount,
        SUM(CASE WHEN role = 'TECHNICIAN' THEN 1 ELSE 0 END) as techCount,
        SUM(CASE WHEN role = 'ADMIN' THEN 1 ELSE 0 END) as adminCount
      FROM users 
      WHERE is_active = TRUE OR is_active IS NULL
    `);

    // 2. إحصائيات الإيرادات
    const [revenueData] = await db.query(`
      SELECT 
        DATE_FORMAT(appointment_date, '%Y-%m-%d') as date,
        MONTH(appointment_date) as month,
        SUM(total_amount) as total_prix,
        SUM(versement) as total_versement
      FROM appointments
      GROUP BY DATE(appointment_date), MONTH(appointment_date)
      ORDER BY date ASC
    `);

    // 3. أنواع الفحوصات
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