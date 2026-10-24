// =========================================================
// Migrations légères exécutées au démarrage (idempotentes).
// Ajoutent uniquement des colonnes manquantes : aucune donnée n'est modifiée ni supprimée.
// Un échec est journalisé mais n'empêche jamais le serveur de démarrer.
// =========================================================
const db = require('./db');

const COLUMNS = [
  // Rappels WhatsApp (RND/reminders.js)
  ['appointments', 'reminder_status', 'VARCHAR(16) NULL'],
  ['appointments', 'reminder_sent_at', 'DATETIME NULL'],
  ['appointments', 'reminder_error', 'VARCHAR(255) NULL'],
  ['appointments', 'reminder_message_id', 'VARCHAR(100) NULL'],
  // Notifications des réservations en ligne (booking/booking.notify.js)
  ['online_bookings', 'notify_status', 'VARCHAR(16) NULL'],
  ['online_bookings', 'notify_error', 'VARCHAR(255) NULL'],
  ['online_bookings', 'notified_at', 'DATETIME NULL'],
  // Codes promo (pricing/promo-codes.js)
  ['online_bookings', 'promo_code', 'VARCHAR(30) NULL'],
  ['appointments', 'promo_code', 'VARCHAR(30) NULL'],
  // Mode de paiement choisi sur le site : BARIDIMOB ou CCP
  ['online_bookings', 'payment_method', 'VARCHAR(12) NULL']
];

async function run() {
  try {
    const [rows] = await db.query(
      `SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('appointments', 'online_bookings')`
    );
    const have = new Set(rows.map((r) => `${r.t}.${r.c}`));
    const tables = new Set(rows.map((r) => r.t));
    for (const [table, col, def] of COLUMNS) {
      if (!tables.has(table) || have.has(`${table}.${col}`)) continue;
      // noms issus de la liste ci-dessus uniquement (jamais d'une entrée utilisateur)
      await db.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${col}\` ${def}`);
      console.log(`[migrations] colonne ajoutée : ${table}.${col}`);
    }
  } catch (e) {
    console.error('[migrations] ignorées :', e.message);
  }
}

module.exports = { run };
