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
  'http://localhost:51173'
];

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));
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
app.use('/api/admin', require('./routes/client.routes')); 
app.use('/api/vehicules', require('./routes/vehicules.routes'));
app.use('/api/inspection', require('./routes/inspection.routes'));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Swagger UI available at http://localhost:${PORT}/api-docs`);
});