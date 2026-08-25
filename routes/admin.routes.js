const express = require('express');
const router = express.Router();
const adminController = require('../admin/admin.controller');

// Endpoints RESTful

router.get('/users', adminController.getAllUsers);               // GET: Liste
router.post('/users', adminController.createUser);              // POST: Ajouter
router.put('/users/:userId', adminController.updateUserRole);  // PUT: Modifier
router.delete('/users/:userId', adminController.deleteUser);  // DELETE: Desactiver

module.exports = router;