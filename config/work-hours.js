// =====================================================================
// Horaires de l'atelier (heure d'Alger, UTC+1 toute l'année)
//
// 1. Accès du personnel : en dehors de WORK_HOURS, les comptes Réception et
//    Technicien ne peuvent plus se connecter et les sessions ouvertes sont fermées.
//    L'administrateur garde toujours l'accès. Les comptes ne sont PAS désactivés
//    en base : un compte désactivé à la main reste désactivé le lendemain.
// 2. Clôture de fin de journée : à l'heure de fermeture, les véhicules du jour
//    entrés à l'atelier (Prêt pour l'atelier / En atelier / En cours) passent à « Terminé ».
//    Les rendez-vous « En attente » (client jamais venu), annulés ou absents ne changent pas.
//
// .env (facultatif) :
//   WORK_HOURS=08:45-17:10        horaires d'accès (défaut)
//   WORK_HOURS_MODE=on|off        contrôle d'accès (défaut on)
//   AUTO_CLOSE_DAY=on|off         clôture automatique de fin de journée (défaut on)
// =====================================================================
const db = require('./db');

const TZ_OFFSET_MIN = 60;          // Algérie : UTC+1, pas d'heure d'été

function parseHours(raw) {
  const m = String(raw || '').trim().match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
  if (!m) return { start: 8 * 60 + 45, end: 17 * 60 + 10, label: '08:45 - 17:10' };
  const start = Number(m[1]) * 60 + Number(m[2]);
  const end = Number(m[3]) * 60 + Number(m[4]);
  const p = (n) => String(n).padStart(2, '0');
  return { start, end, label: `${p(m[1])}:${m[2]} - ${p(m[3])}:${m[4]}` };
}
const HOURS = parseHours(process.env.WORK_HOURS);
const ACCESS_ON = String(process.env.WORK_HOURS_MODE || 'on').toLowerCase() !== 'off';
const AUTOCLOSE_ON = String(process.env.AUTO_CLOSE_DAY || 'on').toLowerCase() !== 'off';

function localNow(now = Date.now()) {
  const d = new Date(now + TZ_OFFSET_MIN * 60 * 1000);   // champs UTC = heure d'Alger
  return { date: d.toISOString().slice(0, 10), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}
function isOpen(now) {
  const { minutes } = localNow(now);
  return HOURS.start <= HOURS.end
    ? minutes >= HOURS.start && minutes < HOURS.end
    : minutes >= HOURS.start || minutes < HOURS.end;     // plage passant minuit (non utilisé à l'atelier)
}
function staffAllowed(role, now) {
  if (!ACCESS_ON) return true;
  if (String(role || '').toUpperCase() === 'ADMIN') return true;
  return isOpen(now);
}
const CLOSED_MESSAGE = `Accès fermé : l'application est disponible de ${HOURS.label.replace(' - ', ' à ')}.`;

// ---------- clôture de fin de journée ----------
const OPEN_STATUSES = ['READY_FOR_WORKSHOP', 'IN_WORKSHOP', 'IN_PROGRESS'];
let lastClosed = null;
let timer = null;

// clôture : véhicules entrés à l'atelier jusqu'à `cutoff` (rattrapage limité aux 7 derniers jours)
async function closeDay(cutoff) {
  const [r] = await db.query(
    `UPDATE appointments
        SET status = 'COMPLETED',
            completed_at = COALESCE(completed_at, CONVERT_TZ(NOW(), '+00:00', '+01:00'))
      WHERE status IN (${OPEN_STATUSES.map(() => '?').join(', ')})
        AND appointment_date >= DATE_SUB(?, INTERVAL 7 DAY)
        AND appointment_date <= ?`,
    [...OPEN_STATUSES, cutoff.slice(0, 10), cutoff]
  );
  return r.affectedRows || 0;
}

async function tick() {
  const { date, minutes } = localNow();
  let key, cutoff;
  if (minutes >= HOURS.end) {
    // après la fermeture : la journée d'aujourd'hui
    key = date;
    cutoff = `${date} ${String(Math.floor(HOURS.end / 60)).padStart(2, '0')}:${String(HOURS.end % 60).padStart(2, '0')}:59`;
  } else {
    // avant la fermeture (ex. redémarrage le matin) : seulement les jours précédents oubliés
    const y = localNow(Date.now() - 24 * 3600 * 1000).date;
    key = y;
    cutoff = `${y} 23:59:59`;
  }
  if (lastClosed === key) return;
  try {
    const n = await closeDay(cutoff);
    lastClosed = key;
    if (n) console.log(`[fin de journée] jusqu'au ${cutoff} : ${n} rendez-vous passé(s) à « Terminé »`);
  } catch (err) {
    console.error('[fin de journée] échec :', err.message);   // nouvel essai à la minute suivante
  }
}

function start() {
  console.log(`[horaires] accès personnel ${ACCESS_ON ? HOURS.label : 'sans restriction'} — clôture auto ${AUTOCLOSE_ON ? 'active' : 'désactivée'}`);
  if (!AUTOCLOSE_ON || timer) return;
  timer = setInterval(tick, 60 * 1000);
  if (timer.unref) timer.unref();
  setTimeout(tick, 15 * 1000);      // rattrapage au démarrage (après les migrations)
}

module.exports = { staffAllowed, isOpen, localNow, closeDay, start, HOURS, CLOSED_MESSAGE, _parseHours: parseHours };
