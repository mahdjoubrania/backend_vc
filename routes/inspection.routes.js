const express = require('express');
const router = express.Router();

const inspectionCtrl = require('../verification/inspection.controller');
const authenticateToken = require('../middleware/auth.middleware');

router.post('/kilometrage', authenticateToken, inspectionCtrl.saveKilometrage);
router.post('/scanner', authenticateToken, inspectionCtrl.saveScanner);
router.post('/moteur', authenticateToken, inspectionCtrl.saveMoteur);
router.post('/suspension', authenticateToken, inspectionCtrl.saveSuspension);
router.post('/tole', authenticateToken, inspectionCtrl.saveTole);

router.get('/details/:inspection_id', authenticateToken, inspectionCtrl.getInspectionDetails);

module.exports = router;