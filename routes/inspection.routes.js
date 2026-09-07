
const express = require('express');
const router = express.Router();
const inspectionCtrl = require('../verification/inspection.controller'); 
const verifyToken = require('../middleware/auth.middleware');

// مسارات الحفظ
router.post('/kilometrage', verifyToken, inspectionCtrl.saveKilometrage); 
router.post('/scanner', verifyToken, inspectionCtrl.saveScanner); 
router.post('/moteur', verifyToken, inspectionCtrl.saveMoteur); 
router.post('/suspension', verifyToken, inspectionCtrl.saveSuspension); 
router.post('/tole', verifyToken, inspectionCtrl.saveTole); 

// مسارات الجلب (GET)
router.get('/all', verifyToken, inspectionCtrl.getAllInspections); 
router.get('/tole/:id', verifyToken, inspectionCtrl.getToleReportById);
router.get('/tole-report/:id', verifyToken, inspectionCtrl.getToleReportById); 
router.get('/details/:inspection_id', verifyToken, inspectionCtrl.getInspectionDetails); 


module.exports = router;