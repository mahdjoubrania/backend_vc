const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const authController = require('../auth/auth.controller');


const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 10,
  message: { message: 'Trop de tentatives de connexion. Veuillez réessayer plus tard.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Authentification
router.post('/login', loginLimiter, authController.login);

module.exports = router;