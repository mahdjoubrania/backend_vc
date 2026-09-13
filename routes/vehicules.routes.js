const express = require('express');
const router = express.Router();
const vehiculesController = require('../vehicules/vehicules.controller');
const verifyToken = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/auth.middleware');

// Gestion des véhicules : réservée à l'ADMIN et à la RECEPTION.
router.use(verifyToken, requireRole('ADMIN', 'RECEPTION'));

router.post('/vehicules', vehiculesController.createVehicle);
router.get('/clients/:clientId/vehicles', vehiculesController.getClientVehicles);
router.put('/vehicles/:vehicleId', vehiculesController.updateVehicle);
router.delete('/vehicles/:vehicleId', vehiculesController.deleteVehicle);
router.put('/vehicles/:vehicleId/transfer', vehiculesController.transferVehicleOwner);

module.exports = router;