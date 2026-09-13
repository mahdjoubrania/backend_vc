const express = require('express');
const router = express.Router();

const clientController = require('../client/client.controller');
const verifyToken = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/auth.middleware');

// Gestion des clients : réservée à l'ADMIN et à la RECEPTION.
router.use(verifyToken, requireRole('ADMIN', 'RECEPTION'));

router.get('/clients', clientController.getAllClients);
router.post('/clients', clientController.createClient);
router.get('/clients/search', clientController.searchClient);
router.put('/clients/:clientId', clientController.updateClient);
router.delete('/clients/:clientId', clientController.deleteClient);

module.exports = router;