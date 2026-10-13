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

const allowedOrigins = [
  'https://verifcars.netlify.app',
  'https://cold-bonus-7196.verifcaratelier.workers.dev',
  'http://127.0.0.1:5500',
  'http://localhost:5500',      // site public en local (Live Server)
  'http://localhost:51173'
  // TODO: ajouter ici le domaine du site public (ex. 'https://verifcar.dz') après l'achat
];

// Railway / Netlify passent par un proxy : nécessaire pour que express-rate-limit voie la vraie IP
app.set('trust proxy', 1);

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));
// Site public : monté AVANT le parser global pour garder sa propre limite de taille
app.use('/api/public', require('./routes/public.routes'));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use(express.static(path.join(__dirname, 'public')));

// Swagger UI
setupSwagger(app);

// Routes
app.use('/api/ai', require('./routes/ai.js'));
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/admin', require('./routes/admin.routes'));
app.use('/api/admin', require('./routes/rnd.routes'));
app.use('/api/admin', require('./routes/booking.routes'));   // réservations en ligne (avant client.routes)
app.use('/api/admin', require('./routes/client.routes')); 
app.use('/api/vehicules', require('./routes/vehicules.routes'));
app.use('/api/inspection', require('./routes/inspection.routes'));

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});