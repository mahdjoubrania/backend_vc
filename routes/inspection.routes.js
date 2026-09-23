const express = require('express');
const router = express.Router();
const inspectionCtrl = require('../verification/inspection.controller');
const verifyToken = require('../middleware/auth.middleware');
const { requireRole, requireModuleAccess } = require('../middleware/auth.middleware');

router.use(verifyToken);

const technicianOnly = requireRole('TECHNICIAN', 'TECHNICIEN', 'ADMIN');
router.post('/kilometrage', technicianOnly, requireModuleAccess('kilometrage'), inspectionCtrl.saveKilometrage);
router.post('/scanner', technicianOnly, requireModuleAccess('scanner'), inspectionCtrl.saveScanner);
router.post('/moteur', technicianOnly, requireModuleAccess('moteur'), inspectionCtrl.saveMoteur);
router.post('/suspension', technicianOnly, requireModuleAccess('suspension'), inspectionCtrl.saveSuspension);
router.post('/tole', technicianOnly, requireModuleAccess('tole'), inspectionCtrl.saveTole);
router.post('/general', technicianOnly, requireModuleAccess('general'), inspectionCtrl.saveGeneral);
router.put('/complete/:inspection_id', technicianOnly, inspectionCtrl.completeInspection);

router.get('/all', requireModuleAccess('reports'), inspectionCtrl.getAllInspections);
router.get('/tole/:id', requireModuleAccess('reports'), inspectionCtrl.getToleReportById);
router.get('/tole-report/:id', requireModuleAccess('reports'), inspectionCtrl.getToleReportById);
router.get('/details/:inspection_id', inspectionCtrl.getInspectionDetails);

module.exports = router;