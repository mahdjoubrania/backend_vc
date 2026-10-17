// =========================================================
// Avis clients — modération par l'ADMIN (monté sur /api/admin)
// Middlewares posés route par route (pas de router.use sans chemin).
// =========================================================
const express = require('express');
const router = express.Router();
const reviews = require('../reviews/reviews.controller');
const verifyToken = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/auth.middleware');

const admin = [verifyToken, requireRole('ADMIN')];

router.get('/reviews', ...admin, reviews.adminList);
router.put('/reviews/:id', ...admin, express.json({ limit: '2kb' }), reviews.adminModerate);

module.exports = router;
