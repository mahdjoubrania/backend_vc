// =========================================================
// Tarifs, promotions et fidélité — réservé à l'ADMIN
// Monté sur /api/admin. Middlewares posés route par route (jamais de router.use
// sans chemin) pour ne pas bloquer les autres routers montés sur /api/admin.
// =========================================================
const express = require('express');
const router = express.Router();
const c = require('../pricing/pricing.controller');
const verifyToken = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/auth.middleware');

const admin = [verifyToken, requireRole('ADMIN')];

router.get('/pricing', ...admin, c.getPricing);
router.put('/pricing/services/:id', ...admin, c.updateService);
router.post('/pricing/promotions', ...admin, c.createPromotion);
router.put('/pricing/promotions/:id', ...admin, c.updatePromotion);
router.delete('/pricing/promotions/:id', ...admin, c.deletePromotion);
router.put('/pricing/loyalty', ...admin, c.updateLoyalty);
router.get('/pricing/loyal-clients', ...admin, c.loyalClients);
router.put('/pricing/clients/:id/loyalty', ...admin, c.setClientLoyalty);

module.exports = router;
