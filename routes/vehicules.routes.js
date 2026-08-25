const express = require('express');
const router = express.Router();
const vehiculesController = require('../vehicules/vehicules.controller');


router.post('/vehicules', vehiculesController.createVehicle);
router.get('/clients/:clientId/vehicles', vehiculesController.getClientVehicles);
router.put('/vehicles/:vehicleId', vehiculesController.updateVehicle);
router.delete('/vehicles/:vehicleId', vehiculesController.deleteVehicle);
router.put('/vehicles/:vehicleId/transfer', vehiculesController.transferVehicleOwner);

module.exports = router;