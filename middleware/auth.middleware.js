const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
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
    // قم بتغيير 'YOUR_JWT_SECRET' إلى مفتاح السر الخاص بك من ملف .env
    const secretKey = process.env.JWT_SECRET || 'YOUR_JWT_SECRET';
    const decodedToken = jwt.verify(token, secretKey);

    // 3. ربط بيانات المستخدم بالطلب req.user
    req.user = {
      id: decodedToken.id || decodedToken.userId,
      role: decodedToken.role
    };

    next(); // الانتقال إلى Controller
  } catch (error) {
    console.error('❌ Auth Middleware Error:', error.message);
    return res.status(401).json({
      success: false,
      error: 'Session expirée ou jeton invalide'
    });
  }
};