# Pedidos de mayoreo · Contexto del proyecto

Documento vivo. Cada decisión de diseño o de código en `apps/` y `packages/` debe poder rastrearse hasta algo de aquí.
Lo marcado **[SUPUESTO]** es una decisión tomada sin confirmar; cámbiala aquí primero y luego en `packages/core/data/settings.json`.

## 1. Problema

Hoy los pedidos grandes (posadas, oficinas, eventos) llegan por WhatsApp o Instagram. Eso implica:

- precios y descuentos calculados a mano;
- confirmar fecha y hora en varios mensajes;
- anticipos sin rastreo;
- nada que impida aceptar más bebidas de las que la barra puede preparar ese día.

**Qué buscamos:** que un cliente arme su pedido, elija fecha y hora con al menos 48 h de anticipación, vea el precio final antes de pagar y deje un anticipo. El equipo recibe el pedido completo y ya pagado, listo para planear la producción.

## 2. Usuarios

| Quién | Contexto real | Lo que necesita |
|---|---|---|
| **Quien organiza** (posada, junta, evento) | Lo hace desde el celular entre otras pendientes, a veces junta gustos de un grupo ("¿quién quiere avena?"). Suele ser su primer pedido grande con nosotros. | Saber cuánto le va a costar **antes** de dar datos, armar mezclas de bebidas sin perder la cuenta, tener certeza de que su pedido quedó apartado. |
| **Barista o gerente de Cuadrochico** | Está atendiendo la barra; revisa pedidos en el celular entre clientes. | Enterarse al momento de un pedido nuevo o pagado; saber qué preparar cada día, agrupado por bebida y leche; marcar pagado, listo y entregado. |

Sin investigación directa con clientes todavía **[SUPUESTO]**. Antes de invertir más, conviene validarlo con 3 a 5 clientes que ya hicieron pedidos grandes por WhatsApp.

## 3. Producto y oferta

- **Menú de mayoreo:** Cinnamon Banana Latte, Matcha Latte, Chai Latte, Cold Brew (negro o latte), Cold Brew Jamaica, Cold Brew Tonic y Cold Brew Lemonade.
  - Todas se sirven **frías** y se pueden preparar con anticipación. El espresso queda fuera porque no aguanta 48 h.
- **Leches:** entera, deslactosada, almendra o avena, sin costo extra **[SUPUESTO]**. Aplican al Matcha, al Chai y al Cold Brew Latte.
- **Jarabes (+$5):** moka, vainilla, canela, plátano, caramelo, miel de abeja y miel de agave. Aplican al Matcha, al Chai y al Cold Brew.
- **Temporada:** se agregan bebidas con fechas de inicio y fin.
- **Descuentos por número de bebidas:**
  - 6 a 11 → 5 %
  - 12 a 23 → 10 %
  - 24 o más → 15 % **[SUPUESTO sobre los cortes]**
  - Nota: el flyer actual dice "Arma tu six: 10 %"; habrá que alinearlo.
- **Mínimo:** 6 bebidas. **Anticipación mínima:** 48 h.
- **Anticipo:** 50 % **[SUPUESTO]**.
- **Entrega:** recoger en Av. Fundadores 5296, Torre Elysium. El envío a domicilio está desactivado **[SUPUESTO]**.
- **Horarios de entrega:** de lunes a viernes de 8:00 a 21:00, y fines de semana de 9:00 a 20:00 **[SUPUESTO, sacado de los turnos del equipo]**.

## 4. Restricciones

- **Costo:** casi cero al mes.
  - Cloudflare Workers + D1 + Pages en plan gratuito (100 mil peticiones al día y 5 GB).
  - Sin servidores propios.
  - La única comisión variable es la del pago con tarjeta.
- **Pagos:**
  - **Transferencia SPEI directa:** 0 % de comisión. El equipo confirma el pago a mano.
  - **Mercado Pago Checkout Pro:** acepta tarjeta, OXXO y SPEI. Cobra 3.49 % + $4 + IVA si el dinero se libera al momento, y 2.95 % si se libera a los 30 días. El pago se confirma solo mediante webhook.
  - **PayPal queda descartado:** cobra 3.95 % + cuota fija y en México se usa menos para pagos locales.
- **Equipo:** sin desarrollador de planta. El código debe ser legible, probado y fácil de desplegar con un solo comando.
- **Legal:** aviso de privacidad (LFPDPPP). Solo pedimos nombre y teléfono; el correo es opcional.

## 5. Postura ética (no negociable)

- **El precio total, el descuento y el anticipo se ven antes de pedir cualquier dato.** Nada de costos escondidos.
- **No usamos urgencia ni escasez inventadas.** Si un horario está lleno, lo decimos porque de verdad lo está, con base en la capacidad real.
- **Nada viene preseleccionado** para marketing. No hay suscripciones.
- **La política de cancelación y de devolución del anticipo se muestra antes de pagar** **[POR DEFINIR]**.
- **El anti-bots (Turnstile) es invisible.** Si falla, se puede pedir por WhatsApp.
- **Accesibilidad:** cumplir WCAG 2.2 AA como mínimo. Funcionar en celulares viejos y con red lenta.

## 6. Éxito

- La mayoría de los pedidos de mayoreo de la temporada navideña entran por la página y no por chat.
- Cero pedidos aceptados por encima de la capacidad del día.
- Tiempo para completar un pedido menor a 4 minutos en celular.
- Cero discrepancias entre el precio cotizado y el cobrado.
