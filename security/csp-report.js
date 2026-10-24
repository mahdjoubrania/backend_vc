// =========================================================
// Rapports de violation CSP envoyés par les navigateurs (site public)
// Pendant la phase « observation », chaque ressource qui serait bloquée est signalée ici.
// Journal : une ligne par violation différente (pas de répétition), sans données personnelles :
//   grep CSP /opt/verifcar/logs/api-out.log
// =========================================================
const seen = new Map();          // signature -> nombre
const MAX_KEYS = 500;

function clean(v, max = 200) {
  let s = String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').slice(0, max);
  // on ne garde que l'origine + le chemin (jamais les paramètres : ils peuvent contenir des données)
  if (/^https?:\/\//i.test(s)) { try { const u = new URL(s); s = u.origin + u.pathname; } catch (_) { /* ignore */ } }
  return s;
}

function handle(r) {
  if (!r || typeof r !== 'object') return;
  const directive = clean(r['effective-directive'] || r.effectiveDirective || r['violated-directive'] || r.violatedDirective, 60);
  const blocked = clean(r['blocked-uri'] || r.blockedURL || r.blockedUri, 160);
  const page = clean(r['document-uri'] || r.documentURL || r.documentUri, 160);
  const source = clean(r['source-file'] || r.sourceFile, 160);
  const line = Number(r['line-number'] || r.lineNumber) || '';
  if (!directive) return;
  const key = `${directive}|${blocked}|${page}`;
  const n = (seen.get(key) || 0) + 1;
  if (seen.size >= MAX_KEYS && !seen.has(key)) return;
  seen.set(key, n);
  if (n === 1 || n === 100 || n === 1000) {
    console.warn(`[CSP] ${directive} bloquerait « ${blocked || '(inline)'} » sur ${page}${source ? ` (${source}${line ? ':' + line : ''})` : ''}${n > 1 ? ` — ${n} fois` : ''}`);
  }
}

module.exports = function cspReport(req, res) {
  try {
    const b = req.body;
    if (Array.isArray(b)) b.forEach((x) => handle(x && (x.body || x)));       // format Reporting API
    else if (b && b['csp-report']) handle(b['csp-report']);                   // format report-uri
    else handle(b);
  } catch (_) { /* un rapport mal formé ne doit jamais faire d'erreur */ }
  res.status(204).end();
};
