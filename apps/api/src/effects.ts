/**
 * Efectos secundarios de los cambios de estado: avisos de Telegram y Google Calendar.
 * Corren después de responder (`waitUntil`) y nunca hacen fallar el flujo del pedido.
 */
import { formatMXN, type OrderStatus, type Quote, type Settings } from '@cuadrochico/core';
import { calendarEnabled, deleteOrderEvent, upsertOrderEvent } from './calendar';
import type { Env } from './env';
import { logEvent, type OrderRow, refundCentsFor } from './orders';
import { notifyTeam } from './telegram';

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Estados en los que el pedido tiene evento en el calendario. */
const ON_CALENDAR: readonly OrderStatus[] = ['confirmed', 'ready', 'completed'];

async function syncCalendar(env: Env, r: OrderRow, settings: Settings): Promise<void> {
  if (!calendarEnabled(env)) return;
  try {
    await upsertOrderEvent(
      env,
      {
        code: r.code,
        slot: { date: r.slot_date, time: r.slot_time },
        customerName: r.customer_name,
        quote: JSON.parse(r.quote_json) as Quote,
        paymentPlan: r.payment_plan,
        paidCents: r.paid_cents,
        notes: r.notes,
      },
      settings,
    );
    await logEvent(env.DB, r.code, 'calendar_synced');
  } catch (err) {
    console.error('calendar', r.code, err);
    await logEvent(env.DB, r.code, 'calendar_error', errText(err)).catch(() => {});
  }
}

async function removeCalendar(env: Env, code: string): Promise<void> {
  if (!calendarEnabled(env)) return;
  try {
    await deleteOrderEvent(env, code);
    await logEvent(env.DB, code, 'calendar_removed');
  } catch (err) {
    console.error('calendar', code, err);
    await logEvent(env.DB, code, 'calendar_error', errText(err)).catch(() => {});
  }
}

const summary = (r: OrderRow) =>
  `${r.code} · ${r.drinks} bebidas · ${r.customer_name} · ${r.slot_date} ${r.slot_time}`;

export async function onOrderCreated(env: Env, r: OrderRow): Promise<void> {
  const method = r.payment_method === 'transfer' ? 'transferencia' : 'Mercado Pago';
  const plan = r.payment_plan === 'full' ? 'liquidar 100 %' : 'anticipo';
  await notifyTeam(
    env,
    `🆕 Pedido nuevo ${summary(r)}\nTotal ${formatMXN(r.total_cents)} · por cobrar ahora ${formatMXN(r.due_now_cents)} (${plan}, ${method}).\nTel. ${r.customer_phone}`,
  );
}

/** Llamar cuando el admin cambia lo pagado sin cambiar el estado: el saldo del evento del calendario se actualiza. */
export async function onPaymentUpdated(
  env: Env,
  r: OrderRow,
  prevPaidCents: number,
  settings: Settings,
): Promise<void> {
  if (r.paid_cents !== prevPaidCents && ON_CALENDAR.includes(r.status)) await syncCalendar(env, r, settings);
}

/** Llamar después de guardar un cambio de estado de `prev` a `r.status`. */
export async function onStatusChanged(
  env: Env,
  r: OrderRow,
  prev: OrderStatus,
  settings: Settings,
  by: 'customer' | 'admin' | 'system',
): Promise<void> {
  if (r.status === prev) return;
  const tasks: Promise<unknown>[] = [];
  if (r.status === 'confirmed' && !ON_CALENDAR.includes(prev)) {
    tasks.push(
      notifyTeam(
        env,
        `✅ Pago confirmado ${summary(r)}\nPagado ${formatMXN(r.paid_cents)} de ${formatMXN(r.total_cents)}.`,
      ),
    );
    tasks.push(syncCalendar(env, r, settings));
  }
  if ((r.status === 'cancelled' || r.status === 'expired') && ON_CALENDAR.includes(prev))
    tasks.push(removeCalendar(env, r.code));
  if (r.status === 'cancelled' && by === 'customer') {
    const refund = refundCentsFor(r, settings);
    tasks.push(
      notifyTeam(
        env,
        `❌ El cliente canceló ${summary(r)}\n${
          refund
            ? `Devolver a mano: ${formatMXN(refund)} (${r.payment_method === 'transfer' ? 'transferencia completa' : 'Mercado Pago menos comisión'}). Tel. ${r.customer_phone}`
            : 'No hay pagos que devolver.'
        }`,
      ),
    );
  }
  await Promise.all(tasks);
}
