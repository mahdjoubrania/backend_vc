
const express = require('express');
const router = express.Router();

const clientController = require('../client/client.controller');


router.get('/clients', clientController.getAllClients);
router.post('/clients', clientController.createClient);
router.get('/clients/search', clientController.searchClient);
router.put('/clients/:clientId', clientController.updateClient);
router.delete('/clients/:clientId', clientController.deleteClient);

module.exports = router;