// =========================================================
// VérifCar — Notification WhatsApp du client quand la réception
// ACCEPTE ou REFUSE une réservation en ligne.
//
// Réutilise la configuration WhatsApp Cloud API des rappels (RND/reminders.js) :
//   WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN, WHATSAPP_TEMPLATE_LANG, WHATSAPP_API_VERSION
// Variables propres à ce module :
//   WHATSAPP_BOOKING_MODE      off (défaut) | dry-run | live
//   WHATSAPP_TPL_BOOKING_OK    modèle "réservation confirmée"  (défaut : reservation_confirmee)
//   WHATSAPP_TPL_BOOKING_KO    modèle "réservation refusée"    (défaut : reservation_refusee)
//   PUBLIC_SITE_URL            adresse du site public (lien de suivi dans le message manuel)
//
// Quel que soit le mode, on renvoie aussi un lien wa.me avec un message tout prêt :
// la réception peut l'envoyer elle-même en un clic si l'envoi automatique est
// désactivé ou a échoué.
// Ne lève JAMAIS d'exception : une notification ratée ne doit pas annuler la validation.
// =========================================================
const reminders = require('../RND/reminders');

const FETCH_TIMEOUT_MS = 12000;

function readBookingConfig(env) {
  const base = reminders.readConfig(env);
  const mode = String(env.WHATSAPP_BOOKING_MODE || 'off').toLowerCase();
  return {
    ...base,
    mode: ['live', 'dry-run'].includes(mode) ? mode : 'off',
    tplOk: env.WHATSAPP_TPL_BOOKING_OK || 'reservation_confirmee',
    tplKo: env.WHATSAPP_TPL_BOOKING_KO || 'reservation_refusee',
    siteUrl: String(env.PUBLIC_SITE_URL || 'https://www.verifcar.dz').replace(/\/+$/, '')
  };
}

// "2026-10-20 10:00:00" → { date: "20/10/2026", time: "10:00" }
function splitDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(v || ''));
  if (!m) return { date: '-', time: '--:--' };
  return { date: `${m[3]}/${m[2]}/${m[1]}`, time: `${m[4]}:${m[5]}` };
}

const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';

// Paramètres des modèles Meta (FR puis AR, comme le rappel)
//  reservation_confirmee : 1 nom, 2 réf, 3 date, 4 heure, 5 nom, 6 réf, 7 date, 8 heure
//  reservation_refusee   : 1 nom, 2 réf, 3 motif, 4 nom, 5 réf, 6 motif
function templateParams(kind, bk) {
  const c = reminders.cleanParam;
  const name = c(firstName(bk.full_name), 'client');
  const ref = c(bk.reference, '-');
  if (kind === 'ACCEPTED') {
    const { date, time } = splitDate(bk.final_date || bk.appointment_date);
    return [name, ref, date, time, name, ref, date, time];
  }
  const reason = c(bk.reject_reason, '-');
  return [name, ref, reason, name, ref, reason];
}

// Texte du message manuel (lien wa.me), dans la langue choisie par le client sur le site
function manualText(kind, bk, cfg) {
  const lang = ['fr', 'ar', 'en'].includes(bk.lang) ? bk.lang : 'fr';
  const name = firstName(bk.full_name);
  const { date, time } = splitDate(bk.final_date || bk.appointment_date);
  const track = `${cfg.siteUrl}/track.html?ref=${encodeURIComponent(bk.reference)}`;
  const T = {
    ACCEPTED: {
      fr: `Bonjour ${name}, votre réservation VérifCar ${bk.reference} est confirmée ✅\nRendez-vous : ${date} à ${time}\nMerci d'apporter la carte grise et les clés du véhicule.\nSuivi : ${track}`,
      ar: `مرحباً ${name}، تم تأكيد حجزك في VérifCar رقم ${bk.reference} ✅\nالموعد: ${date} على الساعة ${time}\nيرجى إحضار البطاقة الرمادية ومفاتيح السيارة.\nتتبّع الحجز: ${track}`,
      en: `Hello ${name}, your VérifCar booking ${bk.reference} is confirmed ✅\nAppointment: ${date} at ${time}\nPlease bring the registration card and the car keys.\nTrack: ${track}`
    },
    REJECTED: {
      fr: `Bonjour ${name}, votre demande VérifCar ${bk.reference} n'a pas pu être acceptée.\nMotif : ${bk.reject_reason || '-'}\nSi votre paiement a été reçu, il vous sera remboursé. N'hésitez pas à nous contacter.\nSuivi : ${track}`,
      ar: `مرحباً ${name}، تعذّر قبول طلبك في VérifCar رقم ${bk.reference}.\nالسبب: ${bk.reject_reason || '-'}\nإذا وصلنا دفعك فسيتم استرجاعه. لا تتردد في التواصل معنا.\nتتبّع الطلب: ${track}`,
      en: `Hello ${name}, your VérifCar request ${bk.reference} could not be accepted.\nReason: ${bk.reject_reason || '-'}\nIf your payment was received, it will be refunded. Feel free to contact us.\nTrack: ${track}`
    }
  };
  return T[kind][lang];
}

function waLink(kind, bk, cfg) {
  const to = reminders.normalizePhone(bk.phone);
  if (!to) return null;
  return `https://wa.me/${to}?text=${encodeURIComponent(manualText(kind, bk, cfg))}`;
}

function create({ db, fetchFn, env = process.env, log = console }) {
  let columnsOk = null;

  async function save(id, status, error) {
    if (columnsOk === false) return;
    try {
      await db.query(
        'UPDATE online_bookings SET notify_status = ?, notify_error = ?, notified_at = CONVERT_TZ(NOW(), \'+00:00\', \'+01:00\') WHERE id = ?',
        [status, error ? String(error).slice(0, 255) : null, id]
      );
      columnsOk = true;
    } catch (e) {
      if (e && (e.code === 'ER_BAD_FIELD_ERROR' || e.errno === 1054)) {
        columnsOk = false;
        log.warn('[booking-notify] colonnes notify_* absentes : exécutez sql/phase_tracking.sql');
      } else log.error('[booking-notify] save error:', e && e.message);
    }
  }

  async function send(cfg, to, template, params) {
    if (!cfg.phoneNumberId || !cfg.token) return { ok: false, message: 'WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN non configurés' };
    const payload = reminders.buildPayload({ templateName: template, templateLang: cfg.templateLang }, to, params);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetchFn(`https://graph.facebook.com/${cfg.apiVersion}/${cfg.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ctrl.signal
      });
      let body = null;
      try { body = await res.json(); } catch (e) { /* réponse non JSON */ }
      if (res.ok && body && body.messages && body.messages[0]) return { ok: true };
      return { ok: false, message: reminders.classifyError(res.status, body).message };
    } catch (e) {
      return { ok: false, message: reminders.classifyError(0, null, e).message };
    } finally {
      clearTimeout(timer);
    }
  }

  // kind : 'ACCEPTED' | 'REJECTED' ; bk : ligne online_bookings (+ final_date éventuelle)
  async function notify(kind, bk) {
    const cfg = readBookingConfig(env);
    const out = { status: 'OFF', wa_link: null };
    try {
      out.wa_link = waLink(kind, bk, cfg);
      const to = reminders.normalizePhone(bk.phone);
      if (!to) { out.status = 'INVALID_PHONE'; await save(bk.id, out.status, 'Numéro invalide'); return out; }
      if (cfg.mode === 'off') return out;
      const template = kind === 'ACCEPTED' ? cfg.tplOk : cfg.tplKo;
      const params = templateParams(kind, bk);
      if (cfg.mode === 'dry-run') {
        log.log(`[booking-notify][DRY-RUN] ${kind} ${bk.reference} to=${to} template=${template} params=${JSON.stringify(params)}`);
        out.status = 'DRY_RUN';
        return out;
      }
      const r = await send(cfg, to, template, params);
      out.status = r.ok ? 'SENT' : 'FAILED';
      if (!r.ok) { out.message = r.message; log.error(`[booking-notify] ${kind} ${bk.reference} échec: ${r.message}`); }
      else log.log(`[booking-notify] ${kind} ${bk.reference} envoyé à ${to}`);
      await save(bk.id, out.status, r.ok ? null : r.message);
      return out;
    } catch (e) {
      log.error('[booking-notify] erreur:', e && e.message);
      out.status = 'FAILED';
      out.message = 'Erreur interne';
      return out;
    }
  }

  return { notify, waLink: (kind, bk) => waLink(kind, bk, readBookingConfig(env)) };
}

let _default = null;
function getDefault() {
  if (!_default) _default = create({ db: require('../config/db'), fetchFn: (...a) => fetch(...a) });
  return _default;
}

module.exports = {
  create, readBookingConfig, templateParams, manualText, splitDate,
  notify: (...a) => getDefault().notify(...a),
  waLink: (...a) => getDefault().waLink(...a)
};
