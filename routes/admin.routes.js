const express = require('express');
const router = express.Router();
const adminController = require('../admin/admin.controller');
const verifyToken = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/auth.middleware');


router.use('/users', verifyToken, requireRole('ADMIN'));

// Endpoints RESTful
router.get('/users', adminController.getAllUsers);               // GET: Liste
router.post('/users', adminController.createUser);              // POST: Ajouter
router.put('/users/:userId', adminController.updateUserRole);  // PUT: Modifier
router.delete('/users/:userId', adminController.deleteUser);  // DELETE: Desactiver

module.exports = router;