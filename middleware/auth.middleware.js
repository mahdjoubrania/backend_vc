const jwt = require('jsonwebtoken');

const SECRET_KEY = process.env.JWT_SECRET;

function verifyToken(req, res, next) {
  try {
    // 1. Authorization
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Utilisateur non authentifié (Jeton manquant)'
      });
    }

    const token = authHeader.split(' ')[1];

    // 2. 
    const decodedToken = jwt.verify(token, SECRET_KEY);

    // 3. req.user
    req.user = {
      id: decodedToken.id || decodedToken.userId,
      role: (decodedToken.role || '').toUpperCase()
    };

    next(); //Controller
  } catch (error) {
    console.error('❌ Auth Middleware Error:', error.message);
    return res.status(401).json({
      success: false,
      error: 'Session expirée ou jeton invalide'
    });
  }
}

//(Role-Based Access Control)
//  router.get('/users', verifyToken, requireRole('ADMIN'), controller.getAllUsers);
function requireRole(...allowedRoles) {
  const normalizedRoles = allowedRoles.map(r => r.toUpperCase());

  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({
        success: false,
        error: 'Utilisateur non authentifié'
      });
    }

    if (!normalizedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'Accès refusé : rôle insuffisant pour cette action.'
      });
    }

    next();
  };
}

module.exports = verifyToken;
module.exports.requireRole = requireRole;