const express = require('express');
const router = express.Router();
const adminController = require('../RND/rnd.controller');
// Endpoint Statistiques RDV
router.get('/rdv-analytics', adminController.getRdvAnalytics);
router.get('/appointments', adminController.getAppointments);
router.post('/appointments', adminController.createAppointment);
router.put('/appointments/:id/status', adminController.updateAppointmentStatus);
router.get('/dashboard-summary', adminController.getDashboardSummary);
router.put('/appointments/:id/payment-status', adminController.updatePaymentStatus);
router.get('/cancelled-appointments', adminController.getCancelledAppointments);
module.exports = router;