// Cobro con Stripe Checkout incrustado, para un sitio estático en Vercel (Node 20, sin librerías).
// La clave privada vive solo en Vercel (variable STRIPE_SECRET_KEY). Sin clave, la página simplemente no ofrece Stripe.
//   GET  /api/stripe              → { enabled, pk } (pk = STRIPE_PUBLISHABLE_KEY, sirve para mostrar el formulario)
//   POST /api/stripe              → crea la sesión de pago incrustada y devuelve { clientSecret, id }
//   GET  /api/stripe?session=cs_… → al volver del pago: verifica con Stripe y, si está pagado, registra la venta
//   POST /api/stripe (de Stripe, con cabecera stripe-signature) → aviso de Stripe: registra el pago aunque el cliente
//        cierre la página. El aviso se vuelve a pedir a Stripe por su id (no se confía en lo que llega) y la
//        suscripción a estos avisos se crea sola la primera vez (asegurarAviso).
const crypto = require("crypto");
const permitido = require("./_guard.js");

// ---------- AJUSTA ESTO ----------
const SITIO = process.env.SITIO_URL || "https://TU-DOMINIO.com";   // sin diagonal al final
const PREFIJO = "RN";                                                // folio: RN-XXXXXX
const MONEDA = "mxn";
const MINIMO = 50, MAXIMO = 200000;                                  // en pesos
// Productos y precios: el servidor NUNCA confía en el monto que manda la página. Si tus precios dependen de
// personas/fechas, calcula aquí el total a partir de los datos y compáralo con `amount`.
const PRECIOS = { tour: 1200, tirolesas: 1800, cabana: 2500 };
function revisar(d, amount) {
  if (!d || !PRECIOS[d.producto]) return false;
  const personas = Math.max(1, Math.min(30, Math.round(Number(d.personas)) || 1));
  const total = PRECIOS[d.producto] * personas;
  const anticipo = d.anticipo ? Math.round(total / 2) : total;
  return Math.round(amount) === anticipo;
}
// ----------------------------------

const API = "https://api.stripe.com/v1";
const AVISO = SITIO + "/api/stripe";
const EVENTOS = ["checkout.session.completed", "checkout.session.async_payment_succeeded", "payment_intent.payment_failed"];

function form(o) { const p = new URLSearchParams(); Object.keys(o).forEach(function (k) { p.append(k, o[k]); }); return p; }
function folioDe(id) { return PREFIJO + "-" + String(id).replace(/[^A-Za-z0-9]/g, "").slice(-6).toUpperCase(); }
// Motivo del fallo para mostrarlo en la página (Stripe a veces cita la clave enmascarada: se tapa igual)
function motivo(t) { return String(t || "").replace(/\b(rk|sk|pk)_(live|test)_\S*/g, "***").slice(0, 160); }
function leeReserva(md) { try { return JSON.parse([md.r1, md.r2, md.r3].filter(Boolean).join("")); } catch (e) { return null; } }

// Dónde apuntar la venta. Aquí se manda a un webhook (SALES_HOOK_URL: Google Apps Script, Zapier, Make, tu propio servidor…).
// Si no hay URL, el cobro igual se hace; solo no se registra en ningún lado más que en el panel de Stripe.
async function registrar(venta) {
  const url = process.env.SALES_HOOK_URL;
  if (!url) return true;
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(venta), signal: AbortSignal.timeout(20000) });
    return r.ok;
  } catch (e) { console.error("registro", venta.folio, e && e.message); return false; }
}

// Sesión pagada → registra la venta (con el mismo folio siempre: si tu registro ya la tiene, que no la repita)
async function apuntar(s) {
  const md = s.metadata || {};
  const amount = Math.round(Number(s.amount_total)) / 100;
  const folio = folioDe(s.id);
  const email = (s.customer_details && s.customer_details.email) || s.customer_email || "";
  const ok = await registrar({ evento: "pago", pasarela: "Stripe", order: s.id, folio: folio, amount: amount, email: email, lang: md.lang === "en" ? "en" : "es", res: leeReserva(md), sum: md.sum || "" });
  return { folio: folio, registrado: ok, amount: amount, sum: md.sum || "" };
}

// Cobro rechazado → también se avisa (sirve para llamar al cliente o ver qué bancos rechazan)
async function apuntaFallo(pi) {
  const e = pi.last_payment_error || {}, pm = e.payment_method || {}, card = pm.card || {}, md = pi.metadata || {};
  await registrar({
    evento: "fallo", pasarela: "Stripe", lang: md.lang === "en" ? "en" : "es", detalle: [e.decline_code || e.code || "", motivo(e.message)].filter(Boolean).join(" · ").slice(0, 300),
    orden: pi.id, importe: Math.round(Number(pi.amount)) / 100, correo: (pm.billing_details && pm.billing_details.email) || md.email || "",
    res: leeReserva(md), tarjeta: [card.brand, card.funding, card.country].filter(Boolean).join(" ")
  });
}

// La primera vez en cada arranque revisa que Stripe tenga dado de alta el aviso (webhook) a esta página; si no, lo crea.
let avisoListo = false;
async function asegurarAviso(auth) {
  if (avisoListo) return;
  avisoListo = true;
  try {
    const r = await fetch(API + "/webhook_endpoints?limit=100", { headers: auth, signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    if (!r.ok) { console.error("stripe_aviso_lista", r.status, JSON.stringify(j).slice(0, 200)); return; }
    const ya = (j.data || []).some(function (w) { return w.url === AVISO && w.status === "enabled" && EVENTOS.every(function (ev) { return (w.enabled_events || []).indexOf(ev) >= 0 || (w.enabled_events || []).indexOf("*") >= 0; }); });
    if (!ya) {
      const o = { url: AVISO, description: "Registrar pagos y rechazos del sitio" };
      EVENTOS.forEach(function (ev, i) { o["enabled_events[" + i + "]"] = ev; });
      const c = await fetch(API + "/webhook_endpoints", { method: "POST", headers: Object.assign({ "Content-Type": "application/x-www-form-urlencoded" }, auth), body: form(o), signal: AbortSignal.timeout(8000) });
      if (!c.ok) { console.error("stripe_aviso_crear", c.status, (await c.text()).slice(0, 200)); return; }
      console.log("stripe_aviso_creado");
    }
  } catch (e) { console.error("stripe_aviso", e && e.message); }
}

module.exports = async function (req, res) {
  // Se quitan espacios, saltos de línea o comillas que se cuelan al pegar la clave en Vercel
  const limpia = function (v) { return String(v || "").trim().replace(/^["']+|["']+$/g, "").trim(); };
  const key = limpia(process.env.STRIPE_SECRET_KEY);
  const pk = limpia(process.env.STRIPE_PUBLISHABLE_KEY);
  const auth = { Authorization: "Bearer " + key };
  if (req.method === "GET" && !req.query.session) {
    if (key) await asegurarAviso(auth);
    return res.status(200).json({ enabled: !!(key && /^pk_(live|test)_/.test(pk)), pk: pk });
  }
  if (!key) return res.status(503).json({ error: "not_configured" });

  // Aviso de Stripe: viene de sus servidores (sin Origin), así que va antes del filtro anti-spam
  if (req.method === "POST" && req.headers["stripe-signature"]) {
    const evId = String((req.body && req.body.id) || "");
    if (!/^evt_[A-Za-z0-9_]{10,200}$/.test(evId)) return res.status(400).json({ error: "evento" });
    try {
      const r = await fetch(API + "/events/" + evId, { headers: auth, signal: AbortSignal.timeout(15000) });
      const ev = await r.json();
      if (!r.ok || !ev || ev.id !== evId) return res.status(400).json({ error: "evento" });
      const obj = (ev.data && ev.data.object) || {};
      if ((ev.type === "checkout.session.completed" || ev.type === "checkout.session.async_payment_succeeded") && obj.payment_status === "paid") {
        const v = await apuntar(obj);
        if (!v.registrado) return res.status(500).json({ error: "registro" });   // Stripe lo reintenta más tarde
      } else if (ev.type === "payment_intent.payment_failed") {
        await apuntaFallo(obj);
      }
      return res.status(200).json({ received: true });
    } catch (e) {
      console.error("stripe_aviso_evento", e && e.message);
      return res.status(500).json({ error: "network" });
    }
  }

  if (!permitido(req, res)) return;

  // Vuelta del pago: se confirma con Stripe (no se confía en lo que diga la URL)
  if (req.method === "GET") {
    const id = String(req.query.session || "");
    if (!/^cs_[A-Za-z0-9_]{10,200}$/.test(id)) return res.status(400).json({ error: "session" });
    try {
      const r = await fetch(API + "/checkout/sessions/" + id, { headers: auth, signal: AbortSignal.timeout(15000) });
      const s = await r.json();
      if (!r.ok || !s || s.id !== id) return res.status(502).json({ error: "stripe" });
      if (s.payment_status !== "paid") return res.status(200).json({ status: "unpaid" });
      const v = await apuntar(s);
      return res.status(200).json({ status: "approved", folio: v.folio, registrado: v.registrado, amount: v.amount, sum: v.sum });
    } catch (e) {
      console.error("stripe_confirm", e && e.message);
      return res.status(502).json({ error: "network" });
    }
  }

  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  const b = req.body && typeof req.body === "object" ? req.body : {};
  const n = Math.round(Number(b.amount) * 100) / 100;
  if (!(n >= MINIMO && n <= MAXIMO)) return res.status(400).json({ error: "amount" });
  const email = typeof b.email === "string" ? b.email.trim().slice(0, 120) : "";
  const rv = b.res && typeof b.res === "object" ? b.res : null;
  if (!revisar(rv, n)) return res.status(400).json({ error: "precio", msg: "el monto no coincide con las tarifas; recarga la página" });
  // Stripe solo deja 500 caracteres por dato: la reserva se guarda partida en hasta 3
  const json = JSON.stringify(rv).slice(0, 1440);
  const en = b.lang === "en";
  const desc = String(b.description || "Reserva").slice(0, 120);
  const o = {
    mode: "payment",
    ui_mode: "embedded",
    redirect_on_completion: "if_required",
    "payment_method_types[0]": "card",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": MONEDA,
    "line_items[0][price_data][unit_amount]": String(Math.round(n * 100)),
    "line_items[0][price_data][product_data][name]": desc,
    "payment_intent_data[description]": desc,
    locale: en ? "en" : "es",
    return_url: SITIO + "/?stripe_session={CHECKOUT_SESSION_ID}",
    "metadata[lang]": en ? "en" : "es",
    "metadata[sum]": String(b.sum || "").slice(0, 200),
    "metadata[r1]": json.slice(0, 480), "metadata[r2]": json.slice(480, 960), "metadata[r3]": json.slice(960, 1440),
    // Copia de la reserva en el cobro mismo, para que un rechazo se apunte con el nombre del cliente
    "payment_intent_data[metadata][lang]": en ? "en" : "es",
    "payment_intent_data[metadata][r1]": json.slice(0, 480), "payment_intent_data[metadata][r2]": json.slice(480, 960), "payment_intent_data[metadata][r3]": json.slice(960, 1440)
  };
  if (email) { o.customer_email = email; o["payment_intent_data[metadata][email]"] = email; }
  asegurarAviso(auth);
  try {
    const r = await fetch(API + "/checkout/sessions", { method: "POST", headers: Object.assign({ "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": crypto.randomUUID() }, auth), body: form(o), signal: AbortSignal.timeout(20000) });
    const s = await r.json().catch(function () { return {}; });
    if (!r.ok || !s.client_secret) {
      console.error("stripe_error", r.status, JSON.stringify(s).slice(0, 300));
      const se = s.error || {};
      return res.status(502).json({ error: "stripe", status: r.status, code: String(se.code || se.type || ""), msg: motivo(se.message) });
    }
    return res.status(200).json({ clientSecret: s.client_secret, id: s.id });
  } catch (e) {
    console.error("stripe_exception", e && e.message);
    return res.status(502).json({ error: "network", msg: motivo(e && e.message) });
  }
};
