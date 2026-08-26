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