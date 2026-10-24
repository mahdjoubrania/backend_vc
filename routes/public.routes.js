// =========================================================
// Routes PUBLIQUES (sans connexion) — utilisées par le site vitrine
// Monté dans server.js AVANT express.json global, pour garder une limite
// de taille dédiée (reçu de 5 Mo en base64 ≈ 7 Mo).
// =========================================================
const express = require('express');
const rateLimit = require('../middleware/rate-limit');
const bookingController = require('../booking/booking.controller');
const pricingController = require('../pricing/pricing.controller');

const router = express.Router();

// Max 8 réservations ENREGISTRÉES par heure et par IP (anti-spam).
// Les tentatives refusées (erreur de saisie) ne comptent pas : plusieurs clients partagent
// souvent la même IP chez les opérateurs mobiles.
const bookingLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 8,
  skipFailedRequests: true,
  message: { success: false, code: 'RATE_LIMIT' }
});
// garde-fou contre les essais automatiques en boucle (réussis ou non)
const bookingBurst = rateLimit({ windowMs: 60 * 60 * 1000, max: 40, message: { success: false, code: 'RATE_LIMIT' } });

router.post(
  '/bookings',
  bookingBurst,
  bookingLimiter,
  express.json({ limit: '8mb' }),
  bookingController.createPublicBooking
);

// Catalogue public (prix + promotions en cours) et devis (avec fidélité si le téléphone est connu)
const quoteLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 40, message: { success: false, code: 'RATE_LIMIT' } });
router.get('/services', pricingController.publicServices);
router.post('/quote', quoteLimiter, express.json({ limit: '2kb' }), pricingController.publicQuote);

// Suivi d'une demande (référence + téléphone) — 20 essais / 15 min / IP contre la devinette
const trackLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { success: false, code: 'RATE_LIMIT' } });
router.post('/track', trackLimiter, express.json({ limit: '2kb' }), bookingController.trackBooking);

// Vérification d'un rapport (QR code imprimé sur le rapport) — 60 / 15 min / IP
const reportVerify = require('../verification/report-verify');
const verifyLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, message: { success: false, code: 'RATE_LIMIT' } });
router.get('/verify/:code', verifyLimiter, reportVerify.publicVerify);
// Rapport complet pour le client (code QR + téléphone) — 20 / 15 min / IP
const reportLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { success: false, code: 'RATE_LIMIT' } });
router.post('/report/:code', reportLimiter, express.json({ limit: '2kb' }), reportVerify.publicReport);

// Avis Google : note + 5 derniers avis (cache serveur 6 h) ; clic sur le lien « laisser un avis » (statistiques)
const reviews = require('../reviews/reviews.controller');
const clickLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: { success: false, code: 'RATE_LIMIT' } });
router.get('/google-reviews', reviews.publicGoogle);
router.post('/review-click', clickLimiter, express.json({ limit: '1kb' }), reviews.publicClick);

// Corps trop gros / JSON invalide → réponse propre (sans détails internes)
router.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') return res.status(413).json({ success: false, code: 'RECEIPT_TOO_LARGE' });
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ success: false, code: 'BAD_REQUEST' });
  next(err);
});

module.exports = router;
