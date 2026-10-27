# Cobro con Stripe para un sitio estático (Vercel)

Formulario de pago de Stripe **incrustado en tu página** (el cliente no sale de tu sitio), con confirmación segura en el servidor, registro del pago por webhook aunque el cliente cierre la pestaña, y el [ticket térmico](https://github.com/reneneitor22/ticket-termico) que se imprime al aprobar.

Sin frameworks ni librerías: HTML + CSS + JS puro y una función de Vercel en Node 20. Es la misma pieza que corre en producción en hagiasofiahuatulco.com, limpiada para copiarse.

## Qué hay

| Archivo | Para qué |
|---|---|
| `api/stripe.js` | La función del servidor: crea la sesión, confirma el pago, recibe el aviso de Stripe |
| `api/_guard.js` | Anti-spam: solo acepta llamadas desde tu propia página y limita intentos por IP |
| `js/cobro.js` | Lado de la página: abre el formulario, confirma al volver, imprime el ticket |
| `js/recibo.js` + `css/recibo.css` | El ticket térmico (tu repo, adaptado para recibir datos) |
| `index.html` + `css/cobro.css` | Página de ejemplo con la ventana de pago `#paybox` |
| `vercel.json` | 30 s de tiempo para la función |

## Cómo meterlo en tu página (6 pasos)

1. **Stripe.** Crea la cuenta y actívala (datos del negocio y cuenta bancaria). Mientras, usa las claves de prueba (`sk_test_…` / `pk_test_…`) y la tarjeta `4242 4242 4242 4242`, cualquier fecha futura y CVC.
2. **Vercel → Settings → Environment Variables:**
   - `STRIPE_SECRET_KEY` = clave secreta (`sk_live_…` o `sk_test_…`)
   - `STRIPE_PUBLISHABLE_KEY` = clave pública (`pk_live_…` o `pk_test_…`)
   - `SITIO_URL` = `https://tu-dominio.com` (sin diagonal al final; es a donde regresa Stripe y a donde manda el webhook)
   - `SALES_HOOK_URL` (opcional) = URL que recibe cada pago y cada rechazo en JSON (Google Apps Script, Make, Zapier, tu servidor). Sin ella el cobro igual funciona.
3. **Copia** `api/`, `js/`, `css/` y la ventana `#paybox` de `index.html` a tu sitio. Carga `js/recibo.js` antes de `js/cobro.js`.
4. **Precios.** En `api/stripe.js` ajusta `PRECIOS`, `PREFIJO` (del folio) y la función `revisar()`: el servidor recalcula el total y rechaza si no coincide con lo que mandó la página. **Nunca confíes en el monto que llega del navegador.**
5. **Tu botón de reservar** llama a:
   ```js
   cobrar({
     amount: 2400,                                   // pesos
     titulo: "Tour tradicional",                     // sale en la terminal y el ticket
     detalle: "2 personas · 15 de noviembre",
     description: "Tour tradicional · 2 personas",   // concepto que ve Stripe
     sum: "Tour tradicional · 2 personas · 15 nov",  // resumen para tu registro
     res: { producto: "tour", personas: 2 },         // lo que revisa el servidor contra PRECIOS
     email: "cliente@correo.com",                    // opcional, Stripe lo precarga
     lang: "es",
     despues: '<a class="btn primary" href="https://wa.me/52…">Avisar por WhatsApp →</a>'
   });
   ```
6. **Publica** y prueba con la tarjeta de prueba. El webhook se da de alta solo la primera vez que corre la función (lo verás en Stripe → Developers → Webhooks apuntando a `SITIO_URL/api/stripe`). Cuando pases a claves `live`, se crea otro webhook igual.

## Cómo funciona por dentro

1. La página pide `GET /api/stripe` → `{ enabled, pk }`. Si no hay clave, no ofrece Stripe.
2. `POST /api/stripe` con monto y datos → el servidor valida precio, crea una **Checkout Session** en modo `embedded` y devuelve `clientSecret`.
3. La página carga `js.stripe.com/v3` y monta `initEmbeddedCheckout` en `#payBrick`.
4. Al terminar, `onComplete` llama `GET /api/stripe?session=cs_…`; el servidor pregunta a Stripe si está `paid` **antes** de mostrar el folio. Si el banco obligó a redirigir, Stripe regresa a `/?stripe_session=cs_…` y la página hace lo mismo.
5. Stripe también manda el evento al webhook; la función vuelve a pedir el evento por su id (no confía en el cuerpo que llega) y registra el pago o el rechazo.
6. El folio es `PREFIJO-` + los últimos 6 caracteres de la sesión: siempre el mismo para el mismo pago, así tu registro no lo duplica.

## Cosas que cuestan trabajo descubrir

- Stripe recorta cada dato de `metadata` a 500 caracteres: la reserva se guarda partida en `r1`, `r2`, `r3`.
- Vercel Hobby guarda solo 1 hora de registros: por eso conviene `SALES_HOOK_URL` para apuntar también los rechazos.
- El webhook llega sin cabecera `Origin`, así que pasa **antes** del anti-spam de `_guard.js`.
- **No funciona en `localhost`**: Stripe necesita el dominio publicado (usa un deploy de prueba de Vercel).
- Si al pegar la clave en Vercel se cuelan comillas o espacios, `limpia()` los quita.
- Ver el ticket sin cobrar: `/?ticket=demo`.

## Mercado Pago

En hagiasofiahuatulco.com Stripe convive con Mercado Pago (formulario Bricks `cardPayment` + API de Orders en `api/pay.js`), y Stripe se ofrece como segunda opción para tarjetas extranjeras. Esa parte no está en este repo; si la quieres, pídesela a Rodrigo.
