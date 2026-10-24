
const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const workHours = require('../config/work-hours');

// hachage factice : bcrypt est exécuté même pour un numéro inconnu
const DUMMY_HASH = bcrypt.hashSync('verifcar-dummy-password', 10);

exports.login = async (req, res) => {
  const { phone, password } = req.body || {};

  if (!phone || !password || typeof phone !== 'string' || typeof password !== 'string') {
    return res.status(400).json({
      message: 'Veuillez fournir le numéro de téléphone et le mot de passe.'
    });
  }

  try {
    const [users] = await db.query(
      `SELECT id,
              full_name AS fullName,
              phone,
              role,
              password_hash,
              is_active AS isActive
       FROM users
       WHERE phone = ?`,
      [phone]
    );

    // Même temps de réponse et même message que le numéro existe ou non (pas d'énumération des comptes)
    const user = users[0];
    const isMatch = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);

    if (!user || !isMatch) {
      return res.status(401).json({
        message: 'Numéro de téléphone ou mot de passe incorrect.'
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        message: 'Ce compte est désactivé.'
      });
    }

    // en dehors des horaires de l'atelier : seul l'administrateur peut se connecter
    if (!workHours.staffAllowed(user.role)) {
      return res.status(403).json({ code: 'OUTSIDE_HOURS', message: workHours.CLOSED_MESSAGE });
    }

    delete user.password_hash;


    const token = jwt.sign(
  {
    id: user.id,
    phone: user.phone,
    role: user.role
  },
  process.env.JWT_SECRET,
  {
    expiresIn: '8h'
  }
);

    res.json({
      message: 'Connexion réussie.',
      token,
      user
    });

  } catch (error) {
    console.error('Login error:', error);

    res.status(500).json({
      message: 'Erreur serveur. Veuillez réessayer plus tard.'
    });
  }
};
exports.getMe = async (req, res) => {
  try {
    const [users] = await db.query(
      `SELECT id,
              full_name AS fullName,
              phone,
              role,
              allowed_modules AS allowedModules
       FROM users
       WHERE id = ?`,
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({ success: false, message: 'Utilisateur introuvable.' });
    }

    res.json({ success: true, data: users[0] });
  } catch (error) {
    console.error('getMe error:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur. Veuillez réessayer plus tard.' });
  }
};