const express = require('express');
const router = express.Router();
const inspectionCtrl = require('../verification/inspection.controller');
const verifyToken = require('../middleware/auth.middleware');
const { requireRole, requireModuleAccess } = require('../middleware/auth.middleware');

router.use(verifyToken);

// مسارات الحفظ: خاصة بالتقني (+ ADMIN) + صلاحية الوحدة المحددة لكل تقني
const technicianOnly = requireRole('TECHNICIAN', 'TECHNICIEN', 'ADMIN');
router.post('/kilometrage', technicianOnly, requireModuleAccess('kilometrage'), inspectionCtrl.saveKilometrage);
router.post('/scanner', technicianOnly, requireModuleAccess('scanner'), inspectionCtrl.saveScanner);
router.post('/moteur', technicianOnly, requireModuleAccess('moteur'), inspectionCtrl.saveMoteur);
router.post('/suspension', technicianOnly, requireModuleAccess('suspension'), inspectionCtrl.saveSuspension);
router.post('/tole', technicianOnly, requireModuleAccess('tole'), inspectionCtrl.saveTole);
router.post('/general', technicianOnly, requireModuleAccess('general'), inspectionCtrl.saveGeneral);
router.put('/complete/:inspection_id', technicianOnly, inspectionCtrl.completeInspection);

// GET routes: متاحة لأي مستخدم مسجّل دخول
// /all و/tole-report و/tole مخصصين لعرض التقارير -> محكومين بصلاحية "reports"
// /details يُستخدم داخلياً بواجهة الفحص نفسها (تحميل بيانات محفوظة سابقاً) -> غير مقيّد بـ reports
router.get('/all', requireModuleAccess('reports'), inspectionCtrl.getAllInspections);
router.get('/tole/:id', requireModuleAccess('reports'), inspectionCtrl.getToleReportById);
router.get('/tole-report/:id', requireModuleAccess('reports'), inspectionCtrl.getToleReportById);
router.get('/details/:inspection_id', inspectionCtrl.getInspectionDetails);

// ===== تعديل التقرير: للأدمن فقط (يُفرض بالسيرفر، ليس بالواجهة) =====
const adminOnly = requireRole('ADMIN');
router.get('/admin/:id', adminOnly, inspectionCtrl.adminGetReportForEdit);
router.put('/admin/:id', adminOnly, inspectionCtrl.adminUpdateReport);
router.get('/admin/:id/history', adminOnly, inspectionCtrl.adminGetReportHistory);

module.exports = router;