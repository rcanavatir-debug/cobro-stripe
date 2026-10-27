// Lado de la página: abre el formulario de Stripe incrustado, confirma el pago al volver y muestra el ticket térmico.
// Uso: window.cobrar({ amount, description, sum, res, email, lang, titulo, detalle, despues })
//   amount: pesos · description: concepto corto (sale en Stripe) · sum: resumen para el registro
//   res: datos que el servidor revisa contra sus precios ({ producto, personas, anticipo }) · lang: "es" | "en"
//   titulo/detalle/despues: lo que se imprime en el ticket y el HTML que aparece debajo (botón de WhatsApp, avisos…)
(function () {
  var box = document.getElementById("paybox"), brick = document.getElementById("payBrick"), st = document.getElementById("payState");
  var stripeJs = null, emb = null, pk = "", cur = null;
  function T(es, en) { return cur && cur.lang === "en" ? en : es; }
  function money(n) { return "$" + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + " MXN"; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function state(html) { st.innerHTML = html; st.hidden = !html; }
  function abrir() { box.hidden = false; document.body.style.overflow = "hidden"; }
  function cerrar() { if (emb) { try { emb.destroy(); } catch (e) {} emb = null; } brick.innerHTML = ""; state(""); box.hidden = true; document.body.style.overflow = ""; }
  function loadStripe() {
    if (!stripeJs) stripeJs = new Promise(function (ok, no) {
      if (window.Stripe) return ok();
      var sc = document.createElement("script"); sc.src = "https://js.stripe.com/v3/"; sc.onload = ok; sc.onerror = function () { stripeJs = null; no(); }; document.head.appendChild(sc);
    });
    return stripeJs;
  }
  // Pago aprobado: la terminal imprime el ticket (js/recibo.js); si no cargó, texto plano
  function recibo(o, despues) {
    document.getElementById("payTitle").textContent = T("Pago recibido ✓", "Payment received ✓");
    if (!window.__recibo) return state("<b>" + T("Pago recibido ✓", "Payment received ✓") + "</b>" + (o.detalle ? esc(o.detalle) + "<br>" : "") + T("Folio: ", "Reference: ") + "<strong>" + esc(o.folio) + "</strong><br>" + despues);
    o.lang = cur ? cur.lang : "es"; o.despues = despues; st.hidden = false; window.__recibo(st, o);
  }
  function resultado(j) {
    if (emb) { try { emb.destroy(); } catch (e) {} emb = null; }
    brick.innerHTML = "";
    if (j && j.status === "approved") {
      var guardado = null; try { guardado = JSON.parse(sessionStorage.getItem("cobro_" + "actual") || "null"); } catch (e) {}
      cur = cur || guardado || { lang: "es" };
      recibo({ titulo: cur.titulo || T("Pago de tu reserva", "Your booking payment"), detalle: j.sum || cur.detalle || "", pagado: money(j.amount), folio: j.folio, via: "Stripe" },
        cur.despues || (T("Tu pago quedó registrado con el folio ", "Your payment is registered with reference ") + "<strong>" + esc(j.folio) + "</strong>."));
    } else if (j && j.status === "unpaid") {
      state("<b>" + T("El pago no se completó", "The payment was not completed") + "</b>" + T("No se hizo ningún cargo. Puedes volver a intentarlo.", "Nothing was charged. You can try again."));
    } else {
      state("<b>" + T("No pudimos confirmar tu pago", "We couldn't confirm your payment") + "</b>" + T("Si se te cobró, escríbenos y lo revisamos al momento.", "If you were charged, contact us and we'll check right away."));
    }
  }
  function confirmar(id) {
    abrir(); state(T("Confirmando tu pago…", "Confirming your payment…"));
    return fetch("/api/stripe?session=" + id).then(function (r) { return r.json(); }).then(resultado).catch(function () { resultado(null); });
  }

  window.cobrar = function (o) {
    cur = o; cur.lang = o.lang === "en" ? "en" : "es";
    try { sessionStorage.setItem("cobro_actual", JSON.stringify({ lang: cur.lang, titulo: o.titulo, detalle: o.detalle, despues: o.despues })); } catch (e) {}
    document.getElementById("payTitle").textContent = o.titulo || T("Pagar con tarjeta", "Pay by card");
    document.getElementById("payWhat").textContent = (o.detalle || "") + " · " + money(o.amount);
    abrir(); state(T("Abriendo el pago seguro…", "Opening secure payment…"));
    Promise.all([
      fetch("/api/stripe").then(function (r) { return r.json(); }).then(function (j) { if (!j || !j.enabled) throw { detail: "Stripe no está configurado en el servidor" }; pk = j.pk; }),
      fetch("/api/stripe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount: o.amount, description: o.description || o.titulo, lang: cur.lang, res: o.res || null, sum: o.sum || "", email: o.email || "" }) })
        .then(function (r) { return r.text().then(function (tx) { var j = null; try { j = JSON.parse(tx); } catch (e) {} if (!r.ok || !j || !j.clientSecret) throw { detail: "servidor HTTP " + r.status + " · " + (j ? [j.error, j.code, j.msg].filter(Boolean).join(" ") : tx.slice(0, 80)) }; return j; }); }),
      loadStripe().catch(function () { throw { detail: "no cargó js.stripe.com" }; })
    ]).then(function (v) {
      var j = v[1];
      return new window.Stripe(pk, { locale: cur.lang }).initEmbeddedCheckout({ clientSecret: j.clientSecret, onComplete: function () { confirmar(j.id); } });
    }).then(function (e) { emb = e; state(""); emb.mount("#payBrick"); })
      .catch(function (err) { state("<b>" + T("No se pudo abrir el pago", "Could not open the payment") + '</b><small style="opacity:.6">' + esc(err && err.detail || err && err.message || err) + "</small>"); });
  };

  document.getElementById("payClose").addEventListener("click", cerrar);
  box.addEventListener("click", function (e) { if (e.target === box) cerrar(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !box.hidden) cerrar(); });

  // Vuelta de Stripe (cuando el banco pidió redirigir): /?stripe_session=cs_…
  var m = /[?&]stripe_session=(cs_[A-Za-z0-9_]+)/.exec(location.search);
  if (m) { try { history.replaceState(null, "", location.pathname + location.hash); } catch (e) {} confirmar(m[1]); }

  // Demo sin cobrar: /?ticket=demo
  if (/[?&]ticket=demo/.test(location.search)) {
    cur = { lang: "es" }; abrir();
    recibo({ titulo: "Anticipo de tu reserva", detalle: "Tour · 2 personas · 15 de noviembre", pagado: money(1200), saldo: money(1200), folio: "RN-DEMO01", via: "Stripe" }, "Ejemplo: no se cobró nada.");
  }
})();
