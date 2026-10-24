// =========================================================
// Avis clients Google — statistiques pour l'ADMIN (monté sur /api/admin)
// Middlewares posés route par route (pas de router.use sans chemin).
// =========================================================
const express = require('express');
const router = express.Router();
const reviews = require('../reviews/reviews.controller');
const verifyToken = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/auth.middleware');

const admin = [verifyToken, requireRole('ADMIN')];

// Statistiques des avis Google (note, nombre d'avis, liens envoyés / ouverts)
router.get('/reviews/stats', ...admin, reviews.adminStats);

module.exports = router;
