const db = require('../config/db');
const bcrypt = require('bcryptjs');

const ALLOWED_ROLES = ['ADMIN', 'RECEPTION', 'TECHNICIAN'];
const VALID_MODULE_KEYS = ['scanner', 'moteur', 'suspension', 'tole', 'kilometrage', 'general', 'reports'];
const MIN_PASSWORD = 8;
const { forgetUser } = require('../middleware/auth.middleware');

// Empêche de se retrouver sans aucun administrateur actif
async function wouldRemoveLastAdmin(userId, { role, isActive }) {
  const [rows] = await db.query('SELECT role, is_active FROM users WHERE id = ?', [userId]);
  if (!rows.length) return false;
  const cur = rows[0];
  if (String(cur.role).toUpperCase() !== 'ADMIN' || !Number(cur.is_active)) return false;
  const losesAdmin = (role !== undefined && role !== null && String(role).toUpperCase() !== 'ADMIN') ||
                     (isActive !== undefined && isActive !== null && !isActive);
  if (!losesAdmin) return false;
  const [n] = await db.query("SELECT COUNT(*) AS n FROM users WHERE role = 'ADMIN' AND is_active = 1 AND id <> ?", [userId]);
  return n[0].n === 0;
}

// 1. Récupérer tous les utilisateurs
exports.getAllUsers = async (req, res) => {
  try {
    const [users] = await db.query(
      'SELECT id, full_name AS fullName, phone, role, is_active AS isActive, allowed_modules AS allowedModules, created_at FROM users ORDER BY id DESC'
    );
    res.json(users);
  } catch (error) {
    console.error('Error in getAllUsers:', error);
    res.status(500).json({ message: 'Erreur serveur. Veuillez réessayer plus tard.' });
  }
};

// 2. Créer un nouvel utilisateur
exports.createUser = async (req, res) => {
  const { fullName, phone, role, password } = req.body || {};

  if (!fullName || !phone || !password || !role || typeof role !== 'string') {
    return res.status(400).json({ 
      message: 'Tous les champs sont obligatoires (fullName, phone, role, password).' 
    });
  }
  if (String(password).length < MIN_PASSWORD) {
    return res.status(400).json({ message: `Le mot de passe doit contenir au moins ${MIN_PASSWORD} caractères.` });
  }

  if (!ALLOWED_ROLES.includes(role.toUpperCase())) {
    return res.status(400).json({
      message: `Rôle invalide. Valeurs autorisées : ${ALLOWED_ROLES.join(', ')}.`
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
      'INSERT INTO users (full_name, phone, role, password_hash, is_active) VALUES (?, ?, ?, ?, 1)',
      [String(fullName).trim().slice(0, 150), String(phone).trim().slice(0, 20), role.toUpperCase(), hashedPassword]
    );

    res.status(201).json({
      message: 'Utilisateur créé avec succès.',
      userId: result.insertId
    });
  } catch (error) {
    console.error('Error in createUser:', error);
    res.status(500).json({ message: 'Erreur serveur. Veuillez réessayer plus tard.' });
  }
};

// 3. Modifier les informations d'un utilisateur
exports.updateUserRole = async (req, res) => {
  const { userId } = req.params;
  const { fullName, phone, role, password, isActive, allowedModules } = req.body || {};

  try {
    if (await wouldRemoveLastAdmin(userId, { role, isActive })) {
      return res.status(409).json({ message: 'Impossible : il doit rester au moins un administrateur actif.' });
    }
    if (password && String(password).trim() !== '' && String(password).length < MIN_PASSWORD) {
      return res.status(400).json({ message: `Le mot de passe doit contenir au moins ${MIN_PASSWORD} caractères.` });
    }
    let query = 'UPDATE users SET ';
    const queryParams = [];

    if (fullName !== undefined && fullName !== null) {
      query += 'full_name = ?, ';
      queryParams.push(fullName);
    }
    if (phone !== undefined && phone !== null) {
      query += 'phone = ?, ';
      queryParams.push(phone);
    }
    if (role !== undefined && role !== null) {
      if (typeof role !== 'string' || !ALLOWED_ROLES.includes(role.toUpperCase())) {
        return res.status(400).json({
          message: `Rôle invalide. Valeurs autorisées : ${ALLOWED_ROLES.join(', ')}.`
        });
      }
      query += 'role = ?, ';
      queryParams.push(role.toUpperCase());
    }
    if (isActive !== undefined && isActive !== null) {
      query += 'is_active = ?, ';
      queryParams.push(isActive ? 1 : 0);
    }
    if (password && String(password).trim() !== '') {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
      query += 'password_hash = ?, ';
      queryParams.push(hashedPassword);
    }
    if (allowedModules !== undefined) {
      let finalAllowedModules = null;
      if (allowedModules !== null) {
        if (!Array.isArray(allowedModules) || allowedModules.some(m => !VALID_MODULE_KEYS.includes(m))) {
          return res.status(400).json({ message: 'Modules de permission invalides fournis.' });
        }
        finalAllowedModules = allowedModules;
      }
      query += 'allowed_modules = ?, ';
      queryParams.push(finalAllowedModules === null ? null : JSON.stringify(finalAllowedModules));
    }

    // إزالة الفاصلة الأخيرة إذا تم تعديل أي حقل
    if (queryParams.length === 0) {
      return res.status(400).json({ message: 'Aucune donnée fournie pour la mise à jour.' });
    }

    query = query.slice(0, -2) + ' WHERE id = ?';
    queryParams.push(userId);

    const [result] = await db.query(query, queryParams);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Utilisateur introuvable.' });
    }
    forgetUser(userId);   // nouveau rôle / désactivation appliqués immédiatement

    res.json({ message: 'Modifications enregistrées avec succès.' });
  } catch (error) {
    if (error && error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ message: 'Ce numéro de téléphone est déjà utilisé.' });
    }
    console.error('Error in updateUserRole:', error);
    res.status(500).json({ message: 'Erreur serveur. Veuillez réessayer plus tard.' });
  }
};

// 4. Désactiver un compte utilisateur
exports.deleteUser = async (req, res) => {
  const { userId } = req.params;

  try {
    if (await wouldRemoveLastAdmin(userId, { isActive: false })) {
      return res.status(409).json({ message: 'Impossible : il doit rester au moins un administrateur actif.' });
    }
    const [result] = await db.query('UPDATE users SET is_active = 0 WHERE id = ?', [userId]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Utilisateur introuvable.' });
    }
    forgetUser(userId);

    res.json({ message: 'Compte utilisateur désactivé avec succès.' });
  } catch (error) {
    console.error('Error in deleteUser:', error);
    res.status(500).json({ message: 'Erreur serveur. Veuillez réessayer plus tard.' });
  }
};