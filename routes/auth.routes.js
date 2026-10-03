const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const authController = require('../auth/auth.controller');
const verifyToken = require('../middleware/auth.middleware');

// حماية من هجمات Brute-Force: 10 محاولات كحد أقصى كل 15 دقيقة لكل IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 دقيقة
  max: 10,
  message: { message: 'Trop de tentatives de connexion. Veuillez réessayer plus tard.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Authentification
router.post('/login', loginLimiter, authController.login);
router.get('/me', verifyToken, authController.getMe);

module.exports = router;