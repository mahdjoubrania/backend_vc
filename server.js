require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();

// ⚠️ Le serveur ne doit jamais démarrer sans un secret JWT défini,
// sinon auth.middleware.js pourrait accepter un secret prévisible.
if (!process.env.JWT_SECRET) {
  console.error('❌ JWT_SECRET manquant dans le fichier .env — arrêt du serveur.');
  process.exit(1);
}

const setupSwagger = require('./config/swagger');

const IS_PROD = process.env.NODE_ENV === 'production';

// En production (VPS) : uniquement les origines de CORS_ORIGINS (écrites par install-vps.sh).
// En développement / Railway : anciennes origines + Live Server local.
const allowedOrigins = IS_PROD ? [] : [
  'https://verifcars.netlify.app',
  'https://cold-bonus-7196.verifcaratelier.workers.dev',
  'http://127.0.0.1:5500',
  'http://localhost:5500',      // site public en local (Live Server)
  'http://localhost:51173'
];
// Origines supplémentaires sans modifier le code : variable Railway CORS_ORIGINS
// (séparées par des virgules), ex. "https://verifcar-site.netlify.app,https://www.verifcar.dz"
String(process.env.CORS_ORIGINS || '').split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean)
  .forEach((o) => { if (!allowedOrigins.includes(o)) allowedOrigins.push(o); });

// Derrière Nginx (1 proxy) : nécessaire pour que le limiteur voie la vraie IP du client
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Authentification par en-tête Bearer : aucun cookie, donc pas besoin de "credentials"
app.use(cors({
  origin: allowedOrigins
}));
// Site public : monté AVANT le parser global pour garder sa propre limite de taille
app.use('/api/public', require('./routes/public.routes'));

// Tailles maximales : les rapports de carrosserie contiennent 5 dessins (images) → 25 Mo (comme Nginx) ;
// résumé IA : juste un numéro ; tout le reste : 1 Mo.
app.use('/api/inspection', express.json({ limit: '25mb' }));
app.use('/api/ai', express.json({ limit: '64kb' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '1mb', extended: true }));
// Express 5 : req.body est undefined sans corps JSON → objet vide (évite des erreurs 500)
app.use((req, res, next) => { if (req.body === undefined) req.body = {}; next(); });

app.use(express.static(path.join(__dirname, 'public')));

// Swagger UI : documentation de développement uniquement
if (!IS_PROD) setupSwagger(app);

// Routes
app.use('/api/ai', require('./routes/ai.js'));
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/admin', require('./routes/admin.routes'));
app.use('/api/admin', require('./routes/rnd.routes'));
app.use('/api/admin', require('./routes/booking.routes'));   // réservations en ligne (avant client.routes)
app.use('/api/admin', require('./routes/pricing.routes'));   // tarifs, promotions, fidélité (ADMIN)
app.use('/api/admin', require('./routes/reviews.routes'));   // avis Google (statistiques ADMIN)
app.use('/api/admin', require('./routes/client.routes')); 
app.use('/api/vehicules', require('./routes/vehicules.routes'));
app.use('/api/inspection', require('./routes/inspection.routes'));

// Écran TV de la salle d'attente : lecture seule, protégée par une clé dédiée (pas de compte du personnel)
app.use('/api/display', require('./routes/display.routes'));

// Route API inconnue → 404 JSON
app.use('/api', (req, res) => res.status(404).json({ success: false, message: 'Route introuvable.' }));

// Erreurs non gérées → réponse JSON propre, sans détails internes
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err && err.type === 'entity.too.large') return res.status(413).json({ success: false, message: 'Données trop volumineuses.' });
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ success: false, message: 'Requête invalide.' });
  console.error('❌ Erreur non gérée:', err);
  res.status(500).json({ success: false, message: 'Erreur serveur. Veuillez réessayer plus tard.' });
});

// Colonnes manquantes (rappels WhatsApp…) ajoutées automatiquement, sans bloquer le démarrage
require('./config/migrations').run();

// Avis Google : actualisation automatique (si GOOGLE_PLACES_API_KEY + GOOGLE_PLACE_ID sont configurés)
require('./reviews/google-places').start();

// Horaires du personnel (08:45-17:10) + clôture automatique des véhicules du jour
require('./config/work-hours').start();

const PORT = process.env.PORT || 8080;
// HOST=127.0.0.1 sur le VPS (accessible uniquement via Nginx) ; 0.0.0.0 par défaut (Railway, local)
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
    console.log(`Server running on ${HOST}:${PORT}`);
});