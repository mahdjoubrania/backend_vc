const jwt = require('jsonwebtoken');

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'Token manquant'
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || 'fallback_secret_key_change_in_production'
    );

    req.user = decoded;

    next();
  } catch (error) {
    console.error('❌ JWT:', error.message);

    return res.status(401).json({
      success: false,
      error: 'Token invalide ou expiré'
    });
  }
};

module.exports = authenticateToken;