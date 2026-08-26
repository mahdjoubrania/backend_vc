const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

exports.login = async (req, res) => {
  const { phone, password } = req.body;

  if (!phone || !password) {
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

    if (users.length === 0) {
      return res.status(401).json({
        message: 'Numéro de téléphone ou mot de passe incorrect.'
      });
    }

    const user = users[0];

    if (!user.isActive) {
      return res.status(403).json({
        message: 'Ce compte est désactivé.'
      });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.status(401).json({
        message: 'Numéro de téléphone ou mot de passe incorrect.'
      });
    }

    delete user.password_hash;


    const token = jwt.sign(
  {
    id: user.id,
    phone: user.phone,
    role: user.role
  },
  process.env.JWT_SECRET || 'fallback_secret_key_change_in_production',
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
      message: error.message
    });
  }
};