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

// ---------------------------------------------------------------------------
// Au réveil du conteneur Railway, le réseau privé (mysql.railway.internal) n'est
// pas toujours prêt pendant les premières secondes : MySQL coupe alors la
// connexion ("Connection lost: The server closed the connection").
// On réessaie UNIQUEMENT l'ouverture de la connexion (avant l'envoi de la requête),
// donc aucune requête n'est jamais exécutée deux fois.
// ---------------------------------------------------------------------------
const RETRY_CODES = new Set([
  'PROTOCOL_CONNECTION_LOST', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT',
  'EAI_AGAIN', 'ENOTFOUND', 'EHOSTUNREACH', 'PROTOCOL_SEQUENCE_TIMEOUT'
]);
const RETRY_DELAYS = [500, 1000, 2000, 3000];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const rawGetConnection = pool.getConnection.bind(pool);
async function getConnection() {
  for (let i = 0; ; i++) {
    try {
      return await rawGetConnection();
    } catch (err) {
      if (!RETRY_CODES.has(err && err.code) || i >= RETRY_DELAYS.length) throw err;
      console.warn(`⏳ MySQL : ${err.code} — nouvel essai ${i + 1}/${RETRY_DELAYS.length} dans ${RETRY_DELAYS[i]} ms`);
      await sleep(RETRY_DELAYS[i]);
    }
  }
}

async function run(method, args) {
  const conn = await getConnection();
  try {
    return await conn[method](...args);
  } finally {
    conn.release();
  }
}

pool.getConnection = getConnection;
pool.query = (...args) => run('query', args);
pool.execute = (...args) => run('execute', args);

// Vérification au démarrage (n'arrête jamais le serveur)
(async () => {
  try {
    const conn = await getConnection();
    await conn.ping();
    conn.release();
    console.log('✅ MySQL connecté');
  } catch (error) {
    console.error('❌ MySQL injoignable :', error.code || error.message,
      `(hôte ${process.env.DB_HOST || '?'}:${process.env.DB_PORT || '?'})`);
  }
})();

module.exports = pool;
