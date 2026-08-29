const express = require('express');
const router = express.Router();
const adminController = require('../RND/rnd.controller');

// مسارات التحليلات والإحصائيات
router.get('/rdv-analytics', adminController.getRdvAnalytics);
router.get('/dashboard-summary', adminController.getDashboardSummary);

// مسارات المواعيد (Appointments)
router.get('/appointments', adminController.getAppointments);
router.get('/appointments/today', adminController.getTodayAppointments);
router.post('/appointments', adminController.createAppointment);
router.put('/appointments/:id', adminController.updateAppointment);
router.put('/appointments/:id/status', adminController.updateAppointmentStatus);
router.put('/appointments/:id/payment-status', adminController.updatePaymentStatus);
router.get('/cancelled-appointments', adminController.getCancelledAppointments);

module.exports = router;