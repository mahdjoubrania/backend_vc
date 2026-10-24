// =========================================================
// VérifCar — Avis Google (fiche Google Maps de l'atelier)
//
// Source : Google Places API (New) — Place Details
//   GET https://places.googleapis.com/v1/places/{GOOGLE_PLACE_ID}
//   champs : note, nombre d'avis, 5 avis les plus pertinents (limite imposée par Google)
//
// Variables .env :
//   GOOGLE_PLACES_API_KEY   clé Google Cloud (API "Places API (New)" activée)
//   GOOGLE_PLACE_ID         identifiant de la fiche (ChIJ...)
//   GOOGLE_REVIEW_URL       (facultatif) lien « Demander des avis » de Google Business Profile
//
// Règles Google respectées :
//  - les textes des avis ne sont PAS enregistrés en base : seulement en mémoire (6 h max)
//  - seuls la note et le nombre d'avis sont historisés (1 ligne par jour) pour les statistiques
//  - affichage avec le nom de l'auteur, le lien vers son profil et la mention « Google »
// =========================================================
const db = require('../config/db');

const ENDPOINT = () => String(process.env.GOOGLE_PLACES_ENDPOINT || 'https://places.googleapis.com/v1/places/').replace(/\/?$/, '/');
const TTL_MS = 6 * 60 * 60 * 1000;          // 4 appels / jour maximum → largement dans le quota gratuit
const RETRY_MS = 15 * 60 * 1000;            // après une erreur : nouvel essai dans 15 min
const FIELDS = 'id,displayName,rating,userRatingCount,googleMapsUri,reviews';

let cache = null;          // { data, at }
let lastError = null;      // { message, at }
let inflight = null;
let nextTry = 0;

const configured = () => !!(process.env.GOOGLE_PLACES_API_KEY && process.env.GOOGLE_PLACE_ID);
const placeId = () => String(process.env.GOOGLE_PLACE_ID || '').trim();

function writeReviewUrl() {
  const custom = String(process.env.GOOGLE_REVIEW_URL || '').trim();
  if (/^https:\/\//.test(custom)) return custom;
  return placeId() ? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId())}` : null;
}

function mapsUrl(data) {
  if (data && data.maps_url) return data.maps_url;
  return placeId() ? `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId())}` : null;
}

let tableReady = null;
function ensureTable() {
  if (!tableReady) {
    tableReady = db.query(
      `CREATE TABLE IF NOT EXISTS google_place_snapshots (
         taken_on      DATE          NOT NULL PRIMARY KEY,
         rating        DECIMAL(2,1)  NULL,
         review_count  INT           NULL,
         updated_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    ).catch((e) => { tableReady = null; throw e; });
  }
  return tableReady;
}

function algiersDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Algiers' }).format(new Date());
}

function normalize(j) {
  const reviews = Array.isArray(j.reviews) ? j.reviews : [];
  return {
    name: (j.displayName && j.displayName.text) || 'VérifCar',
    rating: typeof j.rating === 'number' ? Math.round(j.rating * 10) / 10 : null,
    count: Number.isInteger(j.userRatingCount) ? j.userRatingCount : 0,
    maps_url: typeof j.googleMapsUri === 'string' ? j.googleMapsUri : null,
    reviews: reviews.slice(0, 5).map((r) => {
      const a = r.authorAttribution || {};
      const txt = (r.originalText && r.originalText.text) || (r.text && r.text.text) || '';
      return {
        author: String(a.displayName || 'Client Google').slice(0, 80),
        author_url: /^https:\/\//.test(a.uri || '') ? a.uri : null,
        photo: /^https:\/\/[a-z0-9.-]*(googleusercontent|ggpht|google)\.com\//i.test(a.photoUri || '') ? a.photoUri : null,
        rating: Math.max(1, Math.min(5, Math.round(Number(r.rating) || 0))) || null,
        text: String(txt).slice(0, 1200),
        lang: (r.originalText && r.originalText.languageCode) || (r.text && r.text.languageCode) || null,
        time_desc: r.relativePublishTimeDescription || null,
        publish_time: r.publishTime || null,
        review_url: typeof r.googleMapsUri === 'string' ? r.googleMapsUri : null
      };
    })
  };
}

async function saveSnapshot(data) {
  if (data.rating == null && !data.count) return;
  try {
    await ensureTable();
    await db.query(
      `INSERT INTO google_place_snapshots (taken_on, rating, review_count) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE rating = VALUES(rating), review_count = VALUES(review_count)`,
      [algiersDate(), data.rating, data.count]
    );
  } catch (e) {
    console.error('[google] historique non enregistré :', e.message);
  }
}

async function fetchPlace() {
  const url = `${ENDPOINT()}${encodeURIComponent(placeId())}?languageCode=fr`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(url, {
      headers: { 'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY, 'X-Goog-FieldMask': FIELDS },
      signal: ctrl.signal
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (j.error && (j.error.status || j.error.message)) || `HTTP ${r.status}`;
      throw new Error(String(msg).slice(0, 200));
    }
    return normalize(j);
  } finally {
    clearTimeout(t);
  }
}

// Données à jour (cache 6 h). Ne lance jamais d'exception : renvoie le dernier état connu.
async function get({ force = false } = {}) {
  if (!configured()) return { configured: false };
  const fresh = cache && Date.now() - cache.at < TTL_MS;
  if (!force && (fresh || (cache && Date.now() < nextTry) || (!cache && Date.now() < nextTry))) {
    return cache ? { configured: true, ...cache.data, fetched_at: new Date(cache.at).toISOString() } : { configured: true, unavailable: true };
  }
  if (!inflight) {
    inflight = (async () => {
      try {
        const data = await fetchPlace();
        cache = { data, at: Date.now() };
        lastError = null;
        await saveSnapshot(data);
      } catch (e) {
        lastError = { message: e.name === 'AbortError' ? 'délai dépassé' : e.message, at: Date.now() };
        nextTry = Date.now() + RETRY_MS;
        console.error('[google] avis non récupérés :', lastError.message);
      } finally {
        inflight = null;
      }
    })();
  }
  await inflight;
  return cache ? { configured: true, ...cache.data, fetched_at: new Date(cache.at).toISOString() } : { configured: true, unavailable: true };
}

// Rafraîchissement automatique (historique quotidien même sans visite du site)
let timer = null;
function start() {
  if (timer || !configured()) return;
  setTimeout(() => get().catch(() => {}), 5000);
  timer = setInterval(() => get().catch(() => {}), TTL_MS);
  if (timer.unref) timer.unref();
}

async function history(days = 180) {
  try {
    await ensureTable();
    const [rows] = await db.query(
      `SELECT DATE_FORMAT(taken_on, '%Y-%m-%d') AS date, rating, review_count AS count
       FROM google_place_snapshots
       WHERE taken_on >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       ORDER BY taken_on ASC`,
      [days]
    );
    return rows.map((r) => ({ date: r.date, rating: r.rating == null ? null : Number(r.rating), count: r.count }));
  } catch (e) {
    console.error('[google] historique illisible :', e.message);
    return [];
  }
}

module.exports = {
  configured, get, start, history, writeReviewUrl, mapsUrl,
  lastError: () => (lastError ? { message: lastError.message, at: new Date(lastError.at).toISOString() } : null),
  _normalize: normalize
};
