const mysql = require('mysql2/promise');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: '+01:00',
  dateStrings: true,
  // Robustesse Railway : garder les connexions vivantes et recycler celles qui sont inactives
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  maxIdle: 5,
  idleTimeout: 60000,
  connectTimeout: 20000
});

// Au démarrage, le réseau privé Railway (ou MySQL qui se réveille) peut ne pas être prêt :
// on réessaie quelques fois au lieu d'afficher une seule erreur.
async function testConnection(attempt = 1, max = 6) {
  try {
    const connection = await pool.getConnection();
    await connection.ping();
    console.log(`✅ MySQL connecté (tentative ${attempt})`);
    connection.release();
  } catch (error) {
    if (attempt < max) {
      const wait = attempt * 2000;
      console.warn(`⏳ MySQL pas encore prêt (${error.code || error.message}) — nouvel essai dans ${wait / 1000}s`);
      setTimeout(() => testConnection(attempt + 1, max), wait);
    } else {
      console.error('❌ MySQL injoignable après plusieurs essais :', error.code || error.message);
    }
  }
}

testConnection();

module.exports = pool;
