const express = require('express');
const router = express.Router();
const inspectionCtrl = require('../verification/inspection.controller');
const verifyToken = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/auth.middleware');

router.use(verifyToken);

// مسارات الحفظ: خاصة بالتقني (+ ADMIN)
const technicianOnly = requireRole('TECHNICIAN', 'TECHNICIEN', 'ADMIN');
router.post('/kilometrage', technicianOnly, inspectionCtrl.saveKilometrage);
router.post('/scanner', technicianOnly, inspectionCtrl.saveScanner);
router.post('/moteur', technicianOnly, inspectionCtrl.saveMoteur);
router.post('/suspension', technicianOnly, inspectionCtrl.saveSuspension);
router.post('/tole', technicianOnly, inspectionCtrl.saveTole);
router.post('/general', technicianOnly, inspectionCtrl.saveGeneral);
router.put('/complete/:inspection_id', technicianOnly, inspectionCtrl.completeInspection);

// GET routes: متاحة لأي مستخدم مسجّل دخول
router.get('/all', inspectionCtrl.getAllInspections);
router.get('/tole/:id', inspectionCtrl.getToleReportById);
router.get('/tole-report/:id', inspectionCtrl.getToleReportById);
router.get('/details/:inspection_id', inspectionCtrl.getInspectionDetails);

module.exports = router;