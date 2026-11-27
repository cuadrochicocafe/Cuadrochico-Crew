# Traspaso de sesión · pedidos de mayoreo

Estado al 27 nov 2026. Léelo junto con `CLAUDE.md` y `docs/pedidos/contexto.md`.

## Hecho (rama `feat/pedidos-mayoreo`)

- **Monorepo con pnpm** (`pnpm-workspace.yaml`), TypeScript estricto, Biome y CI en `.github/workflows/ci.yml`.
  - npm 10 se cae resolviendo las dependencias de vitest 4; por eso se usa pnpm.
- **`packages/core`**: reglas de negocio puras, con 48 pruebas en verde.
  - `schema.ts`: validación con zod del menú, la configuración y el pedido que envía el cliente (incluye `paymentPlan`).
  - `pricing.ts`: `quote()`, la única función que define el precio (niveles de descuento, jarabes, leche por variante, temporada, envío y anticipo), y `chargeFor()`, que da lo que se cobra ahora según el plan.
  - `schedule.ts`: zona horaria de Monterrey, horarios cada 30 min, anticipación según tamaño (`leadTimeTiers`), capacidad opcional (`null` = sin límite), días cerrados.
  - `cancellation.ts`: plazo de 72 h, pedidos no reembolsables, monto a devolver (`refundFor()`) y el texto único de la política.
  - `api.ts`: **contrato HTTP** entre web y API. Los dos lados lo deben respetar.
  - `data/menu.json`: menú de mayoreo con precios vigentes del POS. Jarabe +$5 confirmado por el dueño.
  - `data/settings.json`: valores de negocio. Los marcados como **[SUPUESTO]** en `contexto.md` siguen sin confirmar.
- La herramienta interna de la raíz (`index.html`, etc.) **no se tocó**.

## Siguiente: dos piezas en paralelo, sobre el contrato de `packages/core/src/api.ts`

### `apps/api`: Cloudflare Worker + Hono + D1

- Un solo Worker que sirve `apps/web/dist` como assets (fallback SPA) y responde `/api/*`.
- **Endpoints** (ver tipos en `api.ts`):
  - `GET /api/catalog`
  - `GET /api/availability`
  - `POST /api/orders`
  - `GET /api/orders/:code?t=`
  - `POST /api/webhooks/mercadopago`
  - `GET /api/admin/orders`, `PATCH /api/admin/orders/:code` y `GET /api/admin/prep`, con Bearer `ADMIN_TOKEN` y comparación en tiempo constante.
- **Al crear un pedido:**
  - validar con `OrderInputSchema`;
  - recalcular el precio con `quote()`, sin confiar nunca en el cliente;
  - verificar el horario con `checkSlot()` según las bebidas del pedido; si `capacity` está configurada, sumar pedidos en `ACTIVE_STATUSES` dentro de una transacción o `batch` de D1;
  - generar un código corto legible (p. ej. `CC-7K3Q`) y un token de acceso aleatorio, guardando solo su hash;
  - poner `expiresAt = ahora + unpaidHoldHours`.
- **D1:**
  - tablas `orders`, `order_items` (copia del nombre y precio al momento de pedir) y `order_events` (auditoría);
  - migraciones en `apps/api/migrations`.
- **Mercado Pago Checkout Pro:**
  - crear la preferencia con `external_reference = code` y monto igual a `chargeFor(quote, paymentPlan).dueNowCents`;
  - guardar la comisión real (`fee_details`) para calcular el reembolso;
  - en el webhook, validar la firma `x-signature` (HMAC-SHA256 sobre `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`);
  - consultar `GET /v1/payments/:id` y, si `approved` y el monto es suficiente, pasar el pedido a `confirmed`.
- **Transferencia:** se responden los datos bancarios y el código como concepto; el equipo confirma el pago desde admin.
- **Avisos al equipo:** bot de Telegram (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`) cuando hay un pedido nuevo, pagado o cancelado (con el monto a devolver). Si falta configuración, no se manda y no se rompe nada.
- **Google Calendar** (`GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_CALENDAR_ID`): un evento por pedido confirmado a la hora de entrega, con recordatorios a 72 h y 48 h; se borra si se cancela o vence. Si falla, no rompe el pedido.
- **Cancelación:** `POST /api/orders/:code/cancel?t=` con `cancelProblem()`; el reembolso se hace a mano y el admin muestra `refundCents`.
- **Cron trigger:** expira los pedidos `pending_payment` vencidos.
- **Turnstile opcional:** si existe `TURNSTILE_SECRET`, se verifica `captchaToken`.
- **Secretos** solo vía `wrangler secret`. Incluir `.dev.vars.example`.
- **Pruebas** con `@cloudflare/vitest-pool-workers` (vitest 4) y D1 real de miniflare, simulando con `fetch` las llamadas a Mercado Pago y a Telegram.

### `apps/web`: Vite + Preact + TypeScript

- Pensada primero para celular, en español de México, con nivel WCAG 2.2 AA.
- **Flujo del cliente:**
  1. **Arma tu pedido:** bebidas con leche y jarabe, cantidades y cotización en vivo con `quote()`. Se muestra "agrega N y obtén X %" solo como información.
  2. **Fecha y hora:** con `GET /api/availability`; los horarios llenos se muestran como no disponibles, sin dramatizar.
  3. **Tus datos:** nombre, teléfono y correo opcional. Recoger en tienda (o envío, si está activo).
  4. **Revisión:** total, descuento y anticipo visibles antes de pedir datos de pago. Política de cancelación.
  5. **Pago:** transferencia (datos bancarios y concepto) o Mercado Pago (redirección).
  6. **Página del pedido:** `/pedido/:code?t=`, con estado e instrucciones.
- **Admin** en `/admin`: pide el token y lo guarda en `sessionStorage`; lista de pedidos por fecha; marcar pagado, listo, entregado o cancelado; hoja de producción del día.
- **Marca:**
  - azul `#13293D`, crema `#F6F2EA`, terracota de acento `#D2652D` (decorativo) y `#B4501C` (texto);
  - wordmark `logo_cuadrochico.svg` y el personaje `logo_vaso.svg` de la raíz (copiarlos a `apps/web/public`);
  - tipografía display de alto contraste para títulos y una sans geométrica para el texto (autohospedadas con @fontsource);
  - acentos escritos a mano como en el flyer "Arma tu six";
  - todas las bebidas son frías.

## Decisiones pendientes del dueño

1. Solo recoger en tienda, o también envío.
2. Alinear el flyer "Arma tu six: 10 %" con los cortes confirmados (6–11 = 5 %).
3. Configuración de Mercado Pago: aplicación, plazo de liberación del dinero y webhook. Las credenciales y los datos bancarios se cargan solo con `wrangler secret put`, nunca en el repo.

Resueltas (ver `contexto.md`): cortes de descuento, anticipo o liquidación, política de cancelación y reembolso, sin límite de capacidad, anticipación según tamaño, leche en el Cinnamon Banana Latte, avisos por Telegram + Google Calendar.

## Nota de seguridad (herramienta interna, fuera de alcance)

`usuarios.js` publica los hashes PBKDF2 de los PIN del equipo en un repo público. Los PIN cortos se pueden adivinar fuera de línea. Conviene moverlo a un repo privado o a una autenticación del lado del servidor.
