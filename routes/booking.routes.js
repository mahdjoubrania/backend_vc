// =========================================================
// Réservations en ligne — gestion par la RÉCEPTION / ADMIN
// Monté sur /api/admin (comme rnd.routes). Les middlewares sont posés
// route par route (pas de router.use sans chemin) pour ne pas bloquer
// les autres routers montés sur /api/admin.
// =========================================================
const express = require('express');
const router = express.Router();
const bookingController = require('../booking/booking.controller');
const verifyToken = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/auth.middleware');

const staff = [verifyToken, requireRole('ADMIN', 'RECEPTION')];

router.get('/online-bookings', ...staff, bookingController.listBookings);
router.get('/online-bookings/pending-count', ...staff, bookingController.pendingCount);
router.get('/online-bookings/:id/receipt', ...staff, bookingController.getReceipt);
router.put('/online-bookings/:id/accept', ...staff, bookingController.acceptBooking);
router.put('/online-bookings/:id/reject', ...staff, bookingController.rejectBooking);

module.exports = router;
