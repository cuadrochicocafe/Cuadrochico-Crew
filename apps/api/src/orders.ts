import {
  type AdminOrder,
  cancellationDeadline,
  cancelProblem,
  isRefundableOrder,
  type OrderStatus,
  type PaymentMethod,
  type PaymentPlan,
  type PublicOrder,
  type Quote,
  refundFor,
  type Settings,
} from '@cuadrochico/core';

/** Fila de la tabla `orders`. */
export interface OrderRow {
  code: string;
  token_hash: string;
  status: OrderStatus;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  slot_date: string;
  slot_time: string;
  fulfillment_type: 'pickup' | 'delivery';
  delivery_address: string;
  delivery_references: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  payment_method: PaymentMethod;
  payment_plan: PaymentPlan;
  quote_json: string;
  drinks: number;
  total_cents: number;
  due_now_cents: number;
  paid_cents: number;
  provider_fee_cents: number | null;
  notes: string;
  mp_checkout_url: string | null;
  mp_payment_id: string | null;
}

export interface EventRow {
  at: string;
  type: string;
  detail: string;
}

export async function getOrder(db: D1Database, code: string): Promise<OrderRow | null> {
  return db.prepare('SELECT * FROM orders WHERE code = ?').bind(code).first<OrderRow>();
}

export function eventStatement(db: D1Database, code: string, type: string, detail = '', at = new Date()) {
  return db
    .prepare('INSERT INTO order_events (order_code, at, type, detail) VALUES (?, ?, ?, ?)')
    .bind(code, at.toISOString(), type, detail);
}

export async function logEvent(db: D1Database, code: string, type: string, detail = ''): Promise<void> {
  await eventStatement(db, code, type, detail).run();
}

const slotOf = (r: OrderRow) => ({ date: r.slot_date, time: r.slot_time });

export function toPublicOrder(r: OrderRow, settings: Settings, now = new Date()): PublicOrder {
  const createdAt = new Date(r.created_at);
  const slot = slotOf(r);
  const refundable = isRefundableOrder(createdAt, slot, settings);
  return {
    code: r.code,
    status: r.status,
    createdAt: r.created_at,
    expiresAt: r.status === 'pending_payment' ? r.expires_at : null,
    slot,
    fulfillment:
      r.fulfillment_type === 'delivery'
        ? { type: 'delivery', address: r.delivery_address, references: r.delivery_references }
        : { type: 'pickup' },
    customerName: r.customer_name,
    paymentMethod: r.payment_method,
    paymentPlan: r.payment_plan,
    quote: JSON.parse(r.quote_json) as Quote,
    paidCents: r.paid_cents,
    notes: r.notes,
    cancellation: {
      refundable,
      deadline: refundable ? cancellationDeadline(slot, settings).toISOString() : null,
      canCancelNow: cancelProblem({ createdAt, slot, status: r.status }, now, settings) === null,
    },
  };
}

/** Monto a devolver: solo pedidos cancelados que eran reembolsables y que recibieron algún pago. */
export function refundCentsFor(r: OrderRow, settings: Settings): number | null {
  if (r.status !== 'cancelled' || r.paid_cents <= 0) return null;
  if (!isRefundableOrder(new Date(r.created_at), slotOf(r), settings)) return null;
  return refundFor({ paidCents: r.paid_cents });
}

export function toAdminOrder(
  r: OrderRow,
  events: EventRow[],
  settings: Settings,
  now = new Date(),
): AdminOrder {
  return {
    ...toPublicOrder(r, settings, now),
    customerPhone: r.customer_phone,
    customerEmail: r.customer_email,
    updatedAt: r.updated_at,
    events,
    providerFeeCents: r.provider_fee_cents,
    refundCents: refundCentsFor(r, settings),
  };
}
