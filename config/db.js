const mysql = require('mysql2/promise');
const path = require('path');


require('dotenv').config({ path: path.join(__dirname, '.env') });

const pool = mysql.createPool({
  host: process.env.DB_HOST ,
  user: process.env.DB_USER ,
  password: process.env.DB_PASSWORD ,
  database: process.env.DB_NAME ,
  port: Number(process.env.DB_PORT) ,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log('✅ MySQL (vc_db)');
    connection.release();
  } catch (error) {
    console.error('❌:', error.message);
  }
}

testConnection();

module.exports = pool;