# @cuadrochico/api

Cloudflare Worker (Hono) + D1 de los pedidos de mayoreo. Es la única fuente de verdad del precio
(recalcula todo con `@cuadrochico/core`) y sirve la app web compilada (`apps/web/dist`) con fallback SPA.
El contrato HTTP está en `packages/core/src/api.ts`.

## Endpoints

| Método y ruta                                            | Qué hace                                                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `GET /api/catalog`                                       | Menú y configuración pública (métodos de pago habilitados según los secretos).                          |
| `GET /api/availability?from=&days=&drinks=`              | Horarios por día; la anticipación depende de `drinks`.                                                  |
| `POST /api/orders`                                       | Valida, recotiza, verifica horario, aparta `unpaidHoldHours` y devuelve instrucciones de pago.          |
| `GET /api/orders/:code?t=`                               | Pedido del cliente (token secreto). Código o token incorrecto → `not_found`.                            |
| `POST /api/orders/:code/cancel?t=`                       | Cancela en plazo; si no se puede → `not_cancellable`.                                                   |
| `POST /api/webhooks/mercadopago`                         | Valida `x-signature`, consulta el pago y confirma el pedido.                                            |
| `GET /api/admin/orders`, `PATCH /api/admin/orders/:code` | Admin con `Authorization: Bearer <sesión o ADMIN_TOKEN>`. Barista: solo listo/entregado.                |
| `GET /api/staff`, `POST /api/staff/login`                | Nombres del equipo y login con PIN personal. Devuelve un token de sesión (14 días) para `/api/admin/*`. |

Cron (cada 15 min): pasa a `expired` los pedidos `pending_payment` vencidos.

## Desarrollo

```bash
cp apps/api/.dev.vars.example apps/api/.dev.vars   # y llena los valores
pnpm build                                          # la web: wrangler necesita apps/web/dist
pnpm dev:api                                        # aplica migraciones locales y levanta wrangler dev
pnpm --filter @cuadrochico/api test                 # pruebas en workerd con D1 local
```

Las pruebas no leen `wrangler.jsonc` (no necesitan `apps/web/dist`) y simulan con `fetch`
Mercado Pago, Telegram, Turnstile, Google OAuth y Google Calendar.

## Despliegue

1. `pnpm exec wrangler d1 create cuadrochico-pedidos` (desde `apps/api`) y copia el `database_id` a `wrangler.jsonc`.
2. Carga cada secreto de `.dev.vars.example`: `pnpm exec wrangler secret put NOMBRE`.
3. `pnpm deploy` desde la raíz (compila la web, aplica migraciones remotas y publica el Worker).
4. En Mercado Pago, configura el webhook de pagos hacia `https://<dominio>/api/webhooks/mercadopago`
   y copia su clave secreta en `MP_WEBHOOK_SECRET`.

Cualquier secreto que falte desactiva su función sin romper el resto: sin `TRANSFER_*` o sin `MP_*`
el método aparece desactivado en `/api/catalog`; sin Telegram o Calendar no se avisa; sin
`TURNSTILE_SECRET` no se exige captcha; sin `ADMIN_TOKEN` el admin queda cerrado.

## PINs del equipo

Cada persona entra con su nombre y su PIN, igual en la app interna y en `/admin`.

- **Dónde se guardan:** el PIN se valida aquí; solo existe su huella (PBKDF2) en el secreto `STAFF_PINS`, nunca en el repo.
- **Roles:** gerente hace todo. Barista solo ve pedidos y producción, y marca listo o entregado.
- **Bloqueo:** 5 intentos fallidos bloquean ese nombre 15 minutos.
- **Cargar o cambiar PINs:** desde `apps/api`, `node scripts/staff-pins.mjs`. Pide el PIN de cada persona de `usuarios.js` sin
  mostrarlo y sube el secreto. Siempre carga a todo el equipo de una vez.
- **Agregar o quitar a alguien:** edita nombres y roles en `usuarios.js` (raíz) y vuelve a correr el script.
  Quitar a alguien invalida su sesión al instante.
- **Cerrar todas las sesiones:** rota `ADMIN_TOKEN` (la sesión se firma con él).

## Google Calendar (configuración única)

Cuando un pedido pasa a `confirmed`, el Worker crea un evento en el calendario del equipo a la hora de
entrega (duración `slotMinutes`, zona America/Monterrey) con lo que hay que preparar, notas, plan de pago,
saldo y la ruta del admin. Al cancelarse o expirar se borra. El id del evento se deriva del código del
pedido, así que un reintento nunca lo duplica. Si Google falla, el pedido sigue su curso y el error queda
en la bitácora del pedido (`calendar_error`).

1. En [Google Cloud Console](https://console.cloud.google.com/) crea (o elige) un proyecto y habilita
   **Google Calendar API**.
2. En _IAM y administración → Cuentas de servicio_ crea una cuenta de servicio (sin roles) y, en
   _Claves_, agrega una clave **JSON**. Descárgala.
3. En Google Calendar, abre la configuración del calendario del equipo → _Compartir con personas
   específicas_ → agrega el correo de la cuenta de servicio (`...@...iam.gserviceaccount.com`) con el
   permiso **Hacer cambios en los eventos**.
4. Copia el _ID del calendario_ (sección _Integrar el calendario_) a `GOOGLE_CALENDAR_ID`.
5. Guarda el JSON completo, en una sola línea, en `GOOGLE_SERVICE_ACCOUNT_JSON`
   (`pnpm exec wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON` y pega el contenido).

**Recordatorios:** cada evento lleva recordatorios emergentes a 72 h y 48 h, pero en Google los
recordatorios son **por usuario**: los del evento solo se aplican a quien lo crea (la cuenta de servicio).
Por eso cada persona del equipo debe abrir _Configuración → [calendario del equipo] → Notificaciones de
eventos_ y poner sus notificaciones predeterminadas a **72 horas** y **48 horas** antes.
