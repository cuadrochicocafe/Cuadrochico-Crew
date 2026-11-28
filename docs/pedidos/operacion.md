# Pedidos de mayoreo · Manual de operación

Qué hacer en el día a día y cómo activar lo que falta. Los comandos con `wrangler` se corren en PowerShell
desde `apps/api` (`cd C:\...\Cuadrochico-Crew\apps\api`), con la sesión de Cloudflare ya iniciada.

- Sitio de clientes: https://cuadrochico-pedidos.cuadrochico-api.workers.dev
- Admin del equipo: https://cuadrochico-pedidos.cuadrochico-api.workers.dev/admin, o la tarjeta
  "Pedidos de mayoreo" dentro de la app interna.

---

## Pendiente de activar

Cada paso es independiente. Ninguno rompe nada si todavía no se hace.

### 1. Publicación automática

**Qué hace:** cada vez que se une un PR a `main` y las pruebas pasan, GitHub publica solo. Ya no hace
falta correr `pnpm run deploy` a mano. El flujo ya está en `.github/workflows/ci.yml`; sin la llave se
salta y deja un aviso en la pestaña Actions.

1. **Crear la llave en Cloudflare** (la tiene que crear el dueño de la cuenta de Cloudflare):
   - Ve a _Mi perfil → API Tokens → Create Token_.
   - Usa la plantilla **Edit Cloudflare Workers**.
   - En _Permissions_ agrega **Account → D1 → Edit**; hace falta para aplicar migraciones.
   - En _Account Resources_ elige solo la cuenta de Cuadrochico.
   - Crea la llave y cópiala. Solo se muestra una vez.
2. **Copiar el Account ID:** en _Workers & Pages_, columna derecha, "Account ID".
3. **Guardarlos en GitHub.** Esto lo tiene que hacer un **administrador del repo**: como colaborador no
   tienes ese permiso, así que debe hacerlo el dueño de la organización `cuadrochicocafe`.
   - Ve al repo → _Settings → Secrets and variables → Actions → New repository secret_.
   - Crea `CLOUDFLARE_API_TOKEN` con la llave.
   - Crea `CLOUDFLARE_ACCOUNT_ID` con el Account ID.
4. **Probar:** une cualquier PR. En _Actions_, el trabajo **deploy** debe terminar en verde.

**Recomendado:** en _Settings → Branches_, protege `main` para exigir que pase **check** antes de unir.
También lo hace un administrador.

### 2. Anti-bots (Cloudflare Turnstile)

**Qué hace:** evita pedidos falsos de bots que aparten horarios. Es invisible para el cliente. Si
fallara, el cliente ve un enlace para pedir por chat.

> ⚠️ **El orden importa.** Si se carga la clave secreta antes de publicar la clave de sitio, **todos los
> pedidos fallan**. Primero la clave de sitio, después la secreta.

1. **Crear el widget:** en Cloudflare, _Turnstile → Add widget_.
   - Nombre: "Pedidos".
   - Hostname: `cuadrochico-pedidos.cuadrochico-api.workers.dev`. Agrega también el dominio propio si un
     día lo hay.
   - Modo: **Invisible**.
2. **Publicar la clave de sitio** (_Site Key_). Es pública, así que se puede compartir sin problema.
   - Pégala en `apps/web/.env.production` como `VITE_TURNSTILE_SITE_KEY=...`.
   - Haz commit y publica: con la publicación automática basta con unir el PR; sin ella, `pnpm run deploy`.
3. **Cargar la clave secreta** (_Secret Key_), solo cuando lo del paso 2 ya esté publicado:
   `npx wrangler secret put TURNSTILE_SECRET`
4. **Probar:** haz un pedido de prueba desde el celular. Si sale el error "No pudimos verificar que eres
   una persona", borra la clave secreta con `npx wrangler secret delete TURNSTILE_SECRET` y revisa el
   hostname del widget.

### 3. Avisos por Telegram (pedidos nuevos, pagos, cancelaciones y errores)

**Qué hace:** el equipo recibe en un grupo de Telegram:
- pedidos nuevos;
- pagos confirmados;
- cancelaciones, con el monto a devolver o la confirmación de que Mercado Pago ya reembolsó;
- **alertas de errores** del sistema: máximo una cada 10 minutos por tipo, para no llenar el chat.

1. **Crear el bot:** en Telegram, busca **@BotFather**, escribe `/newbot` y sigue los pasos. Al final te da
   el **token del bot**.
2. **Crear el grupo:** crea un grupo (por ejemplo "Pedidos Cuadrochico"), agrega al bot y a quien deba
   recibir avisos.
3. **Obtener el ID del grupo:**
   - Escribe en el grupo `/start@nombre_de_tu_bot`.
   - Abre en el navegador `https://api.telegram.org/bot<TOKEN>/getUpdates`, cambiando `<TOKEN>` por el
     token del bot.
   - Busca `"chat":{"id":-100…`. Ese número, con el signo menos, es el ID.
4. **Cargar ambos datos:**
   - `npx wrangler secret put TELEGRAM_BOT_TOKEN`
   - `npx wrangler secret put TELEGRAM_CHAT_ID`
5. **Probar:** haz un pedido de prueba. Debe llegar "🆕 Pedido nuevo" al grupo.

### 4. Google Calendar (entregas con recordatorios a 72 h y 48 h)

**Qué hace:** cada pedido pagado aparece en el calendario del equipo a la hora de entrega, y se borra si
se cancela. Los pasos están en `apps/api/README.md`, sección **Google Calendar**. Al final, cada persona
debe poner sus notificaciones del calendario del equipo en 72 h y 48 h.

---

## Día a día

### Reembolsos

| Situación | Qué pasa | Qué hace el equipo |
|---|---|---|
| El cliente cancela a tiempo y pagó con **Mercado Pago** | Se reembolsa el total solo. En el admin dice "Reembolsado automáticamente". | Nada. |
| El reembolso de Mercado Pago **falla** (casi siempre por falta de saldo) | El pedido queda cancelado. El admin dice "Falló el reembolso automático" y llega aviso. | Devolver a mano desde Mercado Pago, en _Actividad → el pago → Devolver_. |
| El cliente cancela a tiempo y pagó por **transferencia** | El admin muestra el monto a devolver y llega aviso. | Transferir de vuelta a mano. |
| El equipo cancela desde el admin | No se reembolsa solo. | Decidir y, si aplica, devolver a mano. |
| Pedido hecho con menos de 72 h, o fuera de plazo | El cliente no puede cancelar. | Nada (la política se mostró antes de pagar). |

### Equipo y accesos

**Agregar o quitar a alguien, o cambiar un PIN:**
1. Edita nombres y roles en `usuarios.js` (raíz del repo) y súbelo.
2. Desde `apps/api`, corre `node scripts/staff-pins.mjs` y vuelve a cargar los PIN de todos.

Quitar a alguien cierra su sesión al instante.

**Cerrar todas las sesiones** (por ejemplo, si se pierde un celular): cambia el token de admin con
`npx wrangler secret put ADMIN_TOKEN` y pon un valor largo y nuevo.

**Si alguien se bloquea por 5 intentos fallidos:** espera 15 minutos.

### Errores y registros

- **Avisos:** las alertas de errores llegan por Telegram, una vez que esté configurado.
- **Detalle:** en Cloudflare, _Workers & Pages → cuadrochico-pedidos → Logs_.
- **Webhook de Mercado Pago:** si falla, Mercado Pago lo reintenta solo durante varias horas.

### Respaldos de la base de datos (gratis)

Cloudflare guarda **automáticamente** el historial de la base de datos (D1 Time Travel). En el plan
gratuito son **7 días** y no tiene costo. No hay que configurar nada.

- **Ver el punto actual:**
  `npx wrangler d1 time-travel info cuadrochico-pedidos`
- **Restaurar a un momento del pasado.** Ojo: **sobrescribe la base actual**.
  `npx wrangler d1 time-travel restore cuadrochico-pedidos --timestamp=2026-12-01T18:00:00Z`
  La hora va en UTC: Monterrey + 6 h.
- **Deshacer una restauración:** el comando de restaurar imprime el "bookmark" anterior. Restaura a ese:
  `npx wrangler d1 time-travel restore cuadrochico-pedidos --bookmark=<bookmark>`

Para guardar algo por más de 7 días, exporta una copia a tu computadora (no al repo, que es público):
`npx wrangler d1 export cuadrochico-pedidos --remote --output=respaldo-AAAA-MM-DD.sql`

### Publicar un cambio a mano

Desde la raíz del repo, con la rama `main` actualizada: `pnpm run deploy`. Compila la web, aplica las
migraciones y publica.
