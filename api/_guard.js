// Anti-spam básico para los endpoints que reciben datos: solo acepta envíos desde la propia página
// (cabecera Origin/Referer igual al host) y limita los intentos por IP. El límite vive en memoria de cada
// instancia de Vercel, así que frena ráfagas, no ataques distribuidos.
const hits = new Map();
const VENTANA = 60 * 1000, MAXIMO = 10;

module.exports = function permitido(req, res) {
  const host = String(req.headers.host || "").toLowerCase();
  const de = String(req.headers.origin || req.headers.referer || "");
  let h = "";
  try { h = new URL(de).host.toLowerCase(); } catch (e) { /* sin origen */ }
  if (!h || h !== host) { res.status(403).json({ error: "origen" }); return false; }

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "?";
  const ahora = Date.now();
  if (hits.size > 500) hits.forEach(function (v, k) { if (ahora - v.t > VENTANA) hits.delete(k); });
  const r = hits.get(ip);
  if (!r || ahora - r.t > VENTANA) hits.set(ip, { t: ahora, n: 1 });
  else if (++r.n > MAXIMO) { res.setHeader("Retry-After", "60"); res.status(429).json({ error: "demasiados" }); return false; }
  return true;
};
