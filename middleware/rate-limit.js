// =========================================================
// Limiteur de requêtes intégré (mémoire, un seul processus PM2) — sans dépendance externe.
// API compatible avec l'usage précédent d'express-rate-limit :
//   rateLimit({ windowMs, max | limit, message, keyGenerator, skipFailedRequests, skipSuccessfulRequests })
// IPv6 : les adresses sont regroupées par /64 (un abonné ne peut pas contourner la limite
// en changeant d'adresse dans son propre préfixe).
// =========================================================
const net = require('net');

function ipKey(ip) {
  let s = String(ip || '');
  if (s.startsWith('::ffff:')) s = s.slice(7);            // IPv4 mappée
  if (net.isIPv6(s)) {
    // expansion puis 4 premiers groupes (= /64)
    const [head, tail = ''] = s.split('::');
    const h = head ? head.split(':') : [];
    const t = tail ? tail.split(':') : [];
    const full = [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
    return full.slice(0, 4).map((x) => (x || '0').toLowerCase()).join(':') + '::/64';
  }
  return s || 'unknown';
}

function rateLimit(opts = {}) {
  const windowMs = opts.windowMs || 60 * 1000;
  const max = opts.limit || opts.max || 5;
  const message = opts.message || { success: false, code: 'RATE_LIMIT' };
  const keyGen = opts.keyGenerator || ((req) => ipKey(req.ip));
  const skipFailed = !!opts.skipFailedRequests;
  const skipOk = !!opts.skipSuccessfulRequests;
  const hits = new Map();   // key -> { count, reset }

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, Math.min(windowMs, 10 * 60 * 1000));
  if (sweep.unref) sweep.unref();

  return function limiter(req, res, next) {
    const now = Date.now();
    const key = keyGen(req);
    let entry = hits.get(key);
    if (!entry || entry.reset <= now) { entry = { count: 0, reset: now + windowMs }; hits.set(key, entry); }
    entry.count += 1;

    const remaining = Math.max(0, max - entry.count);
    const resetSec = Math.ceil((entry.reset - now) / 1000);
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(resetSec));

    if (entry.count > max) {
      res.setHeader('Retry-After', String(resetSec));
      return res.status(429).json(message);
    }
    if (skipFailed || skipOk) {
      // skipFailed : les erreurs de saisie ne consomment pas le quota des clients honnêtes
      // skipOk     : seules les tentatives échouées comptent (ex. connexion du personnel depuis la même IP)
      res.on('finish', () => {
        if ((skipFailed && res.statusCode >= 400) || (skipOk && res.statusCode < 400)) {
          const e = hits.get(key);
          if (e && e === entry && e.count > 0) e.count -= 1;
        }
      });
    }
    next();
  };
}

module.exports = rateLimit;
module.exports.ipKey = ipKey;
