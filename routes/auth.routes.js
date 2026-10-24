const express = require('express');
const router = express.Router();
const rateLimit = require('../middleware/rate-limit');
const authController = require('../auth/auth.controller');
const verifyToken = require('../middleware/auth.middleware');

// حماية من هجمات Brute-Force: 10 محاولات فاشلة كحد أقصى كل 15 دقيقة لكل IP
// (الدخول الناجح لا يُحسب: كل موظفي الورشة يتصلون من نفس عنوان IP)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 دقيقة
  max: 10,
  message: { message: 'Trop de tentatives de connexion. Veuillez réessayer dans 15 minutes.' },
  skipSuccessfulRequests: true
});

// Authentification
router.post('/login', loginLimiter, authController.login);
router.get('/me', verifyToken, authController.getMe);

module.exports = router;