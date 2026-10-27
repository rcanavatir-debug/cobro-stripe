// Ticket térmico: al confirmar un pago, una terminal «imprime» el recibo de la reserva por la ranura.
// Adaptado de https://github.com/reneneitor22/ticket-termico (HTML + CSS + JS puro). Respeta prefers-reduced-motion.
// Uso: window.__recibo(contenedor, { lang, titulo, detalle, pagado, saldo, folio, via, despues }) → pinta y anima.
//   titulo/detalle: qué se pagó · pagado/saldo: textos ya con formato ($1,200 MXN) · via: "Mercado Pago" | "Stripe"
//   despues: HTML (avisos y botones) que aparece debajo del recibo cuando termina de imprimirse.
(function () {
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function fila(k, v, cls) { return '<div class="rc-l' + (cls ? " " + cls : "") + '"><span class="rc-k">' + esc(k) + '</span><span class="rc-v">' + esc(v) + "</span></div>"; }

  window.__recibo = function (cont, o) {
    var en = o.lang === "en", T = function (es, e) { return en ? e : es; };
    var fecha = new Date().toLocaleString(en ? "en-US" : "es-MX", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    var meta = fila(T("Folio", "Reference"), o.folio) + fila(T("Pagado con", "Paid with"), o.via || T("Tarjeta", "Card")) + fila(T("Fecha", "Date"), fecha);
    cont.innerHTML =
      '<div class="rc-stage">' +
        '<div class="rc-term">' +
          '<div class="rc-top"><span class="rc-mark"><img src="img/logo-claro.svg" alt="" width="54" height="32" decoding="async"></span><span class="rc-brand">Hagia Sofía · Huatulco</span></div>' +
          '<div class="rc-panel">' +
            '<div class="rc-row"><div><div class="rc-plan">' + esc(o.titulo) + '</div>' + (o.detalle ? '<div class="rc-sub">' + esc(o.detalle) + "</div>" : "") + '</div>' +
            '<div><div class="rc-totl">' + T("Pagado", "Paid") + '</div><div class="rc-tot">' + esc(o.pagado) + "</div></div></div>" +
            '<div class="rc-status"><span class="rc-spin"></span><span class="rc-check"><svg viewBox="0 0 24 24"><path d="M5.5 12.5l4 4 9-9"/></svg></span><span class="rc-txt">' + T("Procesando tu pago", "Processing your payment") + "</span></div>" +
          "</div>" +
          '<div class="rc-slot"></div>' +
        "</div>" +
        '<div class="rc-out"><div class="rc-sheet"><div class="rc-paper">' +
          '<img class="rc-pmark" src="img/logo-oscuro.svg" alt="Hagia Sofía" width="96" height="57" decoding="async">' +
          '<hr class="rc-hr">' +
          fila(o.titulo, o.pagado) + (o.detalle ? '<div class="rc-muted">' + esc(o.detalle) + "</div>" : "") +
          '<hr class="rc-hr">' +
          fila(T("Total pagado", "Total paid"), o.pagado, "rc-big") +
          (o.saldo ? fila(T("Saldo al llegar", "Balance on arrival"), o.saldo) : "") +
          '<hr class="rc-hr">' +
          '<div class="rc-meta">' + meta + "</div>" +
          '<div class="rc-barcode"></div><div class="rc-code">' + esc(o.folio) + "</div>" +
        "</div></div></div>" +
        '<div class="rc-after" hidden>' + (o.despues || "") + "</div>" +
      "</div>";

    var stage = cont.querySelector(".rc-stage"), out = cont.querySelector(".rc-out"), sheet = cont.querySelector(".rc-sheet"),
        paper = cont.querySelector(".rc-paper"), txt = cont.querySelector(".rc-txt"), after = cont.querySelector(".rc-after"), bc = cont.querySelector(".rc-barcode");

    // código de barras decorativo
    var html = "";
    for (var i = 0; i < 46; i++) { html += '<i style="width:' + [1, 1, 2, 3][Math.floor(Math.random() * 4)] + 'px"></i>'; if (Math.random() < .35) html += '<i style="width:1px;background:transparent"></i>'; }
    bc.innerHTML = html;

    // borde dentado, calculado sobre el ancho real del papel
    function dientes() {
      var w = paper.offsetWidth || 300, z = 9, n = Math.max(4, Math.round(w / (z * 2)) * 2), pts = ["0 0", "100% 0"];
      for (var i = n; i >= 0; i--) pts.push((i / n * 100).toFixed(3) + "% " + (i % 2 ? "100%" : "calc(100% - " + z + "px)"));
      paper.style.clipPath = "polygon(" + pts.join(",") + ")";
    }
    addEventListener("resize", dientes);

    var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches, timers = [];
    function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
    function setTxt(s) { txt.style.opacity = 0; later(function () { txt.textContent = s; txt.style.opacity = 1; }, 160); }

    later(function () {
      setTxt(T("Imprimiendo tu ticket", "Printing your ticket"));
      dientes();
      var H = sheet.offsetHeight, dur = reduce ? 400 : 2600, hecho = false;
      stage.classList.add("rc-feeding");
      var anim = out.animate ? out.animate([{ height: "0px" }, { height: H + "px" }], { duration: dur, easing: "cubic-bezier(.45,0,.55,1)", fill: "forwards" }) : null;
      function fin() {
        if (hecho) return; hecho = true;
        out.style.height = H + "px";
        stage.classList.remove("rc-feeding");
        setTxt(T("Reserva confirmada", "Booking confirmed"));
        stage.classList.add("rc-done");
        after.hidden = false;
      }
      if (anim) anim.onfinish = fin;
      later(fin, dur + 40);   // respaldo si la pestaña está en segundo plano
    }, reduce ? 300 : 1100);
  };
})();
