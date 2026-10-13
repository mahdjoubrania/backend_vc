// =========================================================
// Routes PUBLIQUES (sans connexion) — utilisées par le site vitrine
// Monté dans server.js AVANT express.json global, pour garder une limite
// de taille dédiée (reçu de 5 Mo en base64 ≈ 7 Mo).
// =========================================================
const express = require('express');
const rateLimit = require('express-rate-limit');
const bookingController = require('../booking/booking.controller');

const router = express.Router();

// Max 5 réservations par heure et par IP (anti-spam)
const bookingLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, code: 'RATE_LIMIT' }
});

router.post(
  '/bookings',
  bookingLimiter,
  express.json({ limit: '8mb' }),
  bookingController.createPublicBooking
);

// Corps trop gros / JSON invalide → réponse propre (sans détails internes)
router.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') return res.status(413).json({ success: false, code: 'RECEIPT_TOO_LARGE' });
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ success: false, code: 'BAD_REQUEST' });
  next(err);
});

module.exports = router;
