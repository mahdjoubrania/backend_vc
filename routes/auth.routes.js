const express = require('express');
const router = express.Router();
const authController = require('../auth/auth.controller');

// Authentification
router.post('/login', authController.login);



module.exports = router;