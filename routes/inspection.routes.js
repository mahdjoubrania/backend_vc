const express = require('express');
const router = express.Router();
const inspectionCtrl = require('./inspection.controller');

// مسارات الفحص والتحقق
router.post('/kilometrage', inspectionCtrl.saveKilometrage);
router.post('/scanner', inspectionCtrl.saveScanner);
router.post('/moteur', inspectionCtrl.saveMoteur);
router.post('/suspension', inspectionCtrl.saveSuspension);
router.post('/tole', inspectionCtrl.saveTole);
router.get('/details/:inspection_id', inspectionCtrl.getInspectionDetails);

module.exports = router;