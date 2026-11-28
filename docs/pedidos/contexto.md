# Pedidos de mayoreo · Contexto del proyecto

Documento vivo. Cada decisión de diseño o de código en `apps/` y `packages/` debe poder rastrearse hasta algo de aquí.
Lo marcado **[SUPUESTO]** es una decisión tomada sin confirmar; cámbiala aquí primero y luego en `packages/core/data/settings.json`.

## 1. Problema

Hoy los pedidos grandes (posadas, oficinas, eventos) llegan por WhatsApp o Instagram. Eso implica:

- precios y descuentos calculados a mano;
- confirmar fecha y hora en varios mensajes;
- anticipos sin rastreo;
- nada que impida aceptar más bebidas de las que la barra puede preparar ese día.

**Qué buscamos:** que un cliente arme su pedido, elija fecha y hora con la anticipación necesaria, vea el precio final antes de pagar y deje un anticipo o liquide. El equipo recibe el pedido completo y ya pagado, listo para planear la producción.

## 2. Usuarios

| Quién | Contexto real | Lo que necesita |
|---|---|---|
| **Quien organiza** (posada, junta, evento) | Lo hace desde el celular entre otras pendientes, a veces junta gustos de un grupo ("¿quién quiere avena?"). Suele ser su primer pedido grande con nosotros. | Saber cuánto le va a costar **antes** de dar datos, armar mezclas de bebidas sin perder la cuenta, tener certeza de que su pedido quedó apartado. |
| **Barista o gerente de Cuadrochico** | Está atendiendo la barra; revisa pedidos en el celular entre clientes. | Enterarse al momento de un pedido nuevo o pagado; saber qué preparar cada día, agrupado por bebida y leche; marcar pagado, listo y entregado. |

Sin investigación directa con clientes todavía **[SUPUESTO]**. Antes de invertir más, conviene validarlo con 3 a 5 clientes que ya hicieron pedidos grandes por WhatsApp.

## 3. Producto y oferta

- **Menú de mayoreo:** Cinnamon Banana Latte, Matcha Latte, Chai Latte, Cold Brew, Cold Brew Latte, Cold Brew Jamaica, Cold Brew Tonic y Cold Brew Lemonade.
  - Todas se sirven **frías** y se pueden preparar con anticipación. El espresso queda fuera porque no aguanta 48 h.
- **Leches:** entera, deslactosada, almendra o avena, sin costo extra (confirmado por el dueño). Aplican al Cinnamon Banana Latte, al Matcha, al Chai y al Cold Brew Latte.
- **Jarabes (+$5):** moka, vainilla, canela, plátano, caramelo, miel de abeja y miel de agave. Aplican al Matcha, al Chai, al Cold Brew Latte y al Cold Brew (que solo se puede endulzar, sin leche).
- **Temporada:** se agregan bebidas con fechas de inicio y fin.
- **Descuentos por número de bebidas:**
  - 6 a 11 → 5 %
  - 12 a 23 → 10 %
  - 24 o más → 15 % (cortes confirmados por el dueño)
  - Nota: el flyer actual dice "Arma tu six: 10 %"; habrá que alinearlo.
- **Mínimo:** 6 bebidas. No hay máximo de negocio; solo un tope técnico anti-abuso de 1000 bebidas por pedido (más grandes, por WhatsApp).
- **Anticipación según tamaño:** hasta 24 bebidas, 48 h; de 25 en adelante, una semana (168 h). La web explica por qué cambian las fechas al pasar de 24.
- **Capacidad de producción:** sin límite por ahora. El código de capacidad se conserva (`capacity: null` en settings) por si se necesita después.
- **Forma de pago:** el cliente elige entre anticipo del 50 % o liquidar el 100 %. Se cobra ese monto por Mercado Pago o transferencia.
- **Cancelación:**
  - Se puede cancelar desde la página del pedido hasta 72 h antes de la hora de entrega.
  - Si se cancela a tiempo se devuelve todo lo pagado, con cualquier método (decisión del dueño: no se descuenta la comisión).
  - Un pedido creado con menos de 72 h de anticipación no se puede cancelar ni reembolsar, y se avisa claramente antes de pagar.
  - Mercado Pago se reembolsa solo, por su API, en cuanto el cliente cancela a tiempo. Si falla (por ejemplo, sin saldo en la cuenta), queda en la bitácora y el equipo recibe aviso para hacerlo a mano.
  - La transferencia la devuelve el equipo a mano; el admin muestra el monto y el estado del reembolso, y el equipo recibe aviso por Telegram.
  - Si el equipo cancela desde el admin, no se reembolsa solo.
  - El texto de la política sale de una sola función de core (`cancellationPolicyText`) para que sea idéntico antes de pagar y en la página del pedido.
- **Entrega:** recoger en Av. Fundadores 5296, Torre Elysium. El envío a domicilio está desactivado **[SUPUESTO]**.
- **Horarios de entrega:** de lunes a viernes de 8:00 a 21:00, y fines de semana de 9:00 a 20:00 **[SUPUESTO, sacado de los turnos del equipo]**.

## 4. Restricciones

- **Costo:** casi cero al mes.
  - Cloudflare Workers + D1 + Pages en plan gratuito (100 mil peticiones al día y 5 GB).
  - Sin servidores propios.
  - La única comisión variable es la del pago con tarjeta.
- **Pagos:**
  - **Transferencia SPEI directa:** 0 % de comisión. El equipo confirma el pago a mano. Los datos bancarios (banco, titular, CLABE) no van en el repo público: la API los lee de secretos de Cloudflare.
  - **Mercado Pago Checkout Pro:** acepta tarjeta, OXXO y SPEI. Cobra 3.49 % + $4 + IVA si el dinero se libera al momento, y 2.95 % si se libera a los 30 días. El pago se confirma solo mediante webhook.
  - **PayPal queda descartado:** cobra 3.95 % + cuota fija y en México se usa menos para pagos locales.
- **Equipo:** sin desarrollador de planta. El código debe ser legible, probado y fácil de desplegar con un solo comando.
- **Legal:** aviso de privacidad (LFPDPPP). Solo pedimos nombre y teléfono; el correo es opcional.

## 5. Postura ética (no negociable)

- **El precio total, el descuento y el anticipo se ven antes de pedir cualquier dato.** Nada de costos escondidos.
- **No usamos urgencia ni escasez inventadas.** Si un horario no está disponible, decimos la razón real (anticipación o, si algún día se activa, capacidad).
- **Nada viene preseleccionado** para marketing, tampoco el plan de pago. No hay suscripciones.
- **La política de cancelación y reembolso se muestra completa antes de pagar** y también en la página del pedido.
- **El anti-bots (Turnstile) es invisible.** Si falla, se puede pedir por WhatsApp.
- **Accesibilidad:** cumplir WCAG 2.2 AA como mínimo. Funcionar en celulares viejos y con red lenta.

## 6. Éxito

- La mayoría de los pedidos de mayoreo de la temporada navideña entran por la página y no por chat.
- Tiempo para completar un pedido menor a 4 minutos en celular.
- Cero discrepancias entre el precio cotizado y el cobrado.
