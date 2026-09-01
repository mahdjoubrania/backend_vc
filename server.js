const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();

const setupSwagger = require('./config/swagger');

// Body Parser Settings (مهمة لاستقبال صور Drawing)
app.use(cors({
  origin: ['https://verifcars.netlify.app', 'http://127.0.0.1:5500'],
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use(express.static(path.join(__dirname, 'public')));

// Swagger UI
setupSwagger(app);

// Routes
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/admin', require('./routes/admin.routes'));
app.use('/api/admin', require('./routes/rnd.routes'));
app.use('/api/admin', require('./routes/client.routes')); 
app.use('/api/vehicules', require('./routes/vehicules.routes'));

// --- المسار المصلح لموديول الفحص والتحقق ---
// بدلاً من ./routes/kilometrage.routes نربطه بمجلد verification
const verificationRoutes = require('./verification/inspection.routes');
app.use('/api/inspection', verificationRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Swagger UI available at http://localhost:${PORT}/api-docs`);
});