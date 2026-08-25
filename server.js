const express = require('express');
const cors = require('cors');
const path = require('path'); // 
const app = express();

const setupSwagger = require('./config/swagger');

app.use(cors());
app.use(express.json());


app.use(express.static(path.join(__dirname, 'public')));

// Swagger UI
setupSwagger(app);

// Routes
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/admin', require('./routes/admin.routes'));
app.use('/api/admin', require('./routes/rnd.routes'));
app.use('/api/admin', require('./routes/client.routes')); 
app.use('/api/auth', require('./routes/vehicules.routes'));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Swagger UI available at http://localhost:${PORT}/api-docs`);
});