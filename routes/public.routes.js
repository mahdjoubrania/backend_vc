// =========================================================
// Routes PUBLIQUES (sans connexion) — utilisées par le site vitrine
// Monté dans server.js AVANT express.json global, pour garder une limite
// de taille dédiée (reçu de 5 Mo en base64 ≈ 7 Mo).
// =========================================================
const express = require('express');
const rateLimit = require('express-rate-limit');
const bookingController = require('../booking/booking.controller');
const pricingController = require('../pricing/pricing.controller');

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

// Catalogue public (prix + promotions en cours) et devis (avec fidélité si le téléphone est connu)
const quoteLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, message: { success: false, code: 'RATE_LIMIT' } });
router.get('/services', pricingController.publicServices);
router.post('/quote', quoteLimiter, express.json({ limit: '2kb' }), pricingController.publicQuote);

// Suivi d'une demande (référence + téléphone) — 20 essais / 15 min / IP contre la devinette
const trackLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, message: { success: false, code: 'RATE_LIMIT' } });
router.post('/track', trackLimiter, express.json({ limit: '2kb' }), bookingController.trackBooking);

// Vérification d'un rapport (QR code imprimé sur le rapport) — 60 / 15 min / IP
const reportVerify = require('../verification/report-verify');
const verifyLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, message: { success: false, code: 'RATE_LIMIT' } });
router.get('/verify/:code', verifyLimiter, reportVerify.publicVerify);

// Avis clients : liste publique (approuvés), invitation, envoi (10 / heure / IP)
const reviews = require('../reviews/reviews.controller');
const reviewLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { success: false, code: 'RATE_LIMIT' } });
router.get('/reviews', reviews.publicList);
router.get('/reviews/invite/:token', verifyLimiter, reviews.publicInvite);
router.post('/reviews', reviewLimiter, express.json({ limit: '4kb' }), reviews.publicSubmit);

// Corps trop gros / JSON invalide → réponse propre (sans détails internes)
router.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') return res.status(413).json({ success: false, code: 'RECEIPT_TOO_LARGE' });
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ success: false, code: 'BAD_REQUEST' });
  next(err);
});

module.exports = router;
