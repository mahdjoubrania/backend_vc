const express = require('express');
const router = express.Router();
const adminController = require('../RND/rnd.controller');
const verifyToken = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/auth.middleware');

// Toutes les routes de ce fichier nécessitent au minimum d'être authentifié.
router.use(verifyToken);

// --- Statistiques / Analytics : réservées à l'ADMIN ---
router.get('/rdv-analytics', requireRole('ADMIN'), adminController.getRdvAnalytics);
router.get('/dashboard-summary', requireRole('ADMIN'), adminController.getDashboardSummary);

// --- Rendez-vous (Appointments) : ADMIN + RECEPTION ---
router.get('/appointments', requireRole('ADMIN', 'RECEPTION'), adminController.getAppointments);
router.get('/appointments/today', requireRole('ADMIN', 'RECEPTION', 'TECHNICIAN', 'TECHNICIEN'), adminController.getTodayAppointments);
router.post('/appointments', requireRole('ADMIN', 'RECEPTION'), adminController.createAppointment);
router.put('/appointments/:id', requireRole('ADMIN', 'RECEPTION'), adminController.updateAppointment);
router.put('/appointments/:id/status', requireRole('ADMIN', 'RECEPTION'), adminController.updateAppointmentStatus);
router.put('/appointments/:id/payment-status', requireRole('ADMIN', 'RECEPTION'), adminController.updatePaymentStatus);
router.get('/cancelled-appointments', requireRole('ADMIN', 'RECEPTION'), adminController.getCancelledAppointments);

module.exports = router;