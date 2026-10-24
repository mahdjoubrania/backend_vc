const jwt = require('jsonwebtoken');
const db = require('../config/db');
const workHours = require('../config/work-hours');

// ⚠️ Le serveur ne doit jamais démarrer sans un vrai secret JWT en production.
// (Voir server.js — on ajoutera une vérification au démarrage à l'étape 5.)
const SECRET_KEY = process.env.JWT_SECRET;

// Le rôle et l'état actif sont relus en base (cache 30 s) : un compte désactivé ou rétrogradé
// perd ses droits presque immédiatement, au lieu de garder son jeton valable 8 h.
const userCache = new Map();
const CACHE_MS = 30 * 1000;
async function loadUser(id) {
  const hit = userCache.get(id);
  if (hit && hit.at > Date.now() - CACHE_MS) return hit.user;
  const [rows] = await db.query('SELECT id, role, is_active FROM users WHERE id = ? LIMIT 1', [id]);
  const user = rows[0] || null;
  userCache.set(id, { at: Date.now(), user });
  if (userCache.size > 500) userCache.delete(userCache.keys().next().value);
  return user;
}
function forgetUser(id) { userCache.delete(Number(id)); userCache.delete(String(id)); }

async function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Utilisateur non authentifié (Jeton manquant)' });
  }

  let decodedToken;
  try {
    decodedToken = jwt.verify(authHeader.split(' ')[1], SECRET_KEY, { algorithms: ['HS256'] });
  } catch (error) {
    return res.status(401).json({ success: false, error: 'Session expirée ou jeton invalide' });
  }

  const id = Number(decodedToken.id || decodedToken.userId);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(401).json({ success: false, error: 'Session expirée ou jeton invalide' });
  }

  let user;
  try {
    user = await loadUser(id);
  } catch (err) {
    console.error('❌ Auth Middleware DB Error:', err.message);
    return res.status(503).json({ success: false, error: 'Service momentanément indisponible. Réessayez.' });
  }
  if (!user || !Number(user.is_active)) {
    return res.status(401).json({ success: false, error: 'Compte désactivé ou supprimé. Veuillez vous reconnecter.' });
  }

  // fin de la journée : les sessions du personnel (hors administrateur) sont fermées
  if (!workHours.staffAllowed(user.role)) {
    return res.status(401).json({ success: false, code: 'OUTSIDE_HOURS', error: workHours.CLOSED_MESSAGE, message: workHours.CLOSED_MESSAGE });
  }

  req.user = { id, role: String(user.role || '').toUpperCase() };
  next();
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
module.exports.forgetUser = forgetUser;
module.exports.requireRole = requireRole;
module.exports.requireModuleAccess = requireModuleAccess;