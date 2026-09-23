const jwt = require('jsonwebtoken');
const db = require('../config/db');

// ⚠️ Le serveur ne doit jamais démarrer sans un vrai secret JWT en production.
// (Voir server.js — on ajoutera une vérification au démarrage à l'étape 5.)
const SECRET_KEY = process.env.JWT_SECRET;

function verifyToken(req, res, next) {
  try {
    // 1. استخراج التوكن من الهيدر Authorization
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Utilisateur non authentifié (Jeton manquant)'
      });
    }

    const token = authHeader.split(' ')[1];

    // 2. فك تشفير التوكن والتحقق من صحته
    const decodedToken = jwt.verify(token, SECRET_KEY);

    // 3. ربط بيانات المستخدم بالطلب req.user
    req.user = {
      id: decodedToken.id || decodedToken.userId,
      role: (decodedToken.role || '').toUpperCase()
    };

    next(); // الانتقال إلى Controller
  } catch (error) {
    console.error('❌ Auth Middleware Error:', error.message);
    return res.status(401).json({
      success: false,
      error: 'Session expirée ou jeton invalide'
    });
  }
}

// جديد: التحقق من صلاحية الدور (Role-Based Access Control)
// الاستخدام: router.get('/users', verifyToken, requireRole('ADMIN'), controller.getAllUsers);
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

// جديد: التحقق من صلاحية الوصول لوحدة فحص معينة (Scanner, Moteur, ...) أو التقارير
// خاص بدور التقني فقط — الأدوار الثانية (ADMIN/RECEPTION) غير مقيّدة بهذا النظام إطلاقاً
// الاستخدام: router.post('/scanner', technicianOnly, requireModuleAccess('scanner'), controller.saveScanner);
function requireModuleAccess(moduleKey) {
  return async (req, res, next) => {
    try {
      const role = (req.user?.role || '').toUpperCase();

      if (!['TECHNICIAN', 'TECHNICIEN'].includes(role)) {
        return next();
      }

      const [rows] = await db.query('SELECT allowed_modules FROM users WHERE id = ?', [req.user.id]);
      const allowedModules = rows[0]?.allowed_modules;

      // NULL يعني وصول كامل (الوضع الافتراضي لكل تقني ما حُدّدت له صلاحيات بعد)
      if (!allowedModules) {
        return next();
      }

      const list = Array.isArray(allowedModules) ? allowedModules : JSON.parse(allowedModules);

      if (!list.includes(moduleKey)) {
        return res.status(403).json({
          success: false,
          error: `Accès refusé : vous n'avez pas la permission d'accéder à ce module.`
        });
      }

      next();
    } catch (err) {
      console.error('❌ requireModuleAccess Error:', err.message);
      res.status(500).json({ success: false, error: 'Erreur serveur.' });
    }
  };
}

module.exports = verifyToken;
module.exports.requireRole = requireRole;
module.exports.requireModuleAccess = requireModuleAccess;