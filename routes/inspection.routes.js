
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
router.get('/all', inspectionCtrl.getAllInspections); // قائمة جميع التقارير
router.get('/tole/:id', inspectionCtrl.getToleReportById); // تقرير الهيكل 4 صفحات
router.get('/details/:inspection_id', verifyToken, inspectionCtrl.getInspectionDetails); 

module.exports = router;