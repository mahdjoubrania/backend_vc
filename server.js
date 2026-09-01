const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();

const setupSwagger = require('./config/swagger');

app.use(cors({
  origin: ['https://verifcars.netlify.app', 'http://127.0.0.1:5500'],
  credentials: true
}));
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '50mb' })); // 

// Swagger UI
setupSwagger(app);

// Routes
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/admin', require('./routes/admin.routes'));
app.use('/api/admin', require('./routes/rnd.routes'));
app.use('/api/admin', require('./routes/client.routes')); 
app.use('/api/vehicules', require('./routes/vehicules.routes'));
const verificationRoutes = require('./routes/kilometrage.routes'); 
app.use('/api/verification', verificationRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Swagger UI available at http://localhost:${PORT}/api-docs`);
}); 