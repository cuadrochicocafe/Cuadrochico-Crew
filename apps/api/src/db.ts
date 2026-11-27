import { ACTIVE_STATUSES, type Booked, type PricedLine } from '@cuadrochico/core';
import type { OrderRow } from './orders';

/**
 * Condición SQL de "ocupa capacidad": estados activos, pero un pendiente de pago ya vencido
 * (aunque el cron aún no lo marque) no cuenta. Usa un parámetro: el instante actual.
 */
const PAID_ACTIVE = ACTIVE_STATUSES.filter((s) => s !== 'pending_payment')
  .map((s) => `'${s}'`)
  .join(', ');
const ACTIVE_SQL = `(status IN (${PAID_ACTIVE}) OR (status = 'pending_payment' AND expires_at > ?))`;

/** Bebidas comprometidas por fecha y horario en un rango (solo se usa si hay límite de capacidad). */
export async function bookingsBetween(
  db: D1Database,
  from: string,
  to: string,
  now: Date,
): Promise<Map<string, Booked>> {
  const { results } = await db
    .prepare(
      `SELECT slot_date, slot_time, SUM(drinks) AS drinks FROM orders
       WHERE slot_date BETWEEN ? AND ? AND ${ACTIVE_SQL} GROUP BY slot_date, slot_time`,
    )
    .bind(from, to, now.toISOString())
    .all<{ slot_date: string; slot_time: string; drinks: number }>();
  const out = new Map<string, Booked>();
  for (const r of results) {
    const b = out.get(r.slot_date) ?? { perSlot: {}, perDay: 0 };
    b.perSlot[r.slot_time] = r.drinks;
    b.perDay += r.drinks;
    out.set(r.slot_date, b);
  }
  return out;
}

const ORDER_COLUMNS = [
  'code',
  'token_hash',
  'status',
  'created_at',
  'updated_at',
  'expires_at',
  'slot_date',
  'slot_time',
  'fulfillment_type',
  'delivery_address',
  'delivery_references',
  'customer_name',
  'customer_phone',
  'customer_email',
  'payment_method',
  'payment_plan',
  'quote_json',
  'drinks',
  'total_cents',
  'due_now_cents',
  'paid_cents',
  'provider_fee_cents',
  'notes',
  'mp_checkout_url',
  'mp_payment_id',
] as const satisfies readonly (keyof OrderRow)[];

/**
 * Guarda el pedido, sus líneas y el evento de creación en un solo `batch` (transacción de D1).
 * Con `capacity`, el INSERT solo ocurre si todavía cabe en el horario y en el día, así dos pedidos
 * simultáneos no pueden rebasar el límite. Devuelve `false` si ya no cupo.
 */
export async function insertOrder(
  db: D1Database,
  row: OrderRow,
  lines: PricedLine[],
  capacity: { drinksPerSlot: number; drinksPerDay: number } | null,
  now: Date,
): Promise<boolean> {
  const cols = ORDER_COLUMNS.join(', ');
  const values = ORDER_COLUMNS.map((c) => row[c]);
  const placeholders = ORDER_COLUMNS.map(() => '?').join(', ');
  const nowIso = now.toISOString();
  const insert = capacity
    ? db
        .prepare(
          `INSERT INTO orders (${cols}) SELECT ${placeholders}
           WHERE (SELECT COALESCE(SUM(drinks), 0) FROM orders
                  WHERE slot_date = ? AND slot_time = ? AND ${ACTIVE_SQL}) + ? <= ?
             AND (SELECT COALESCE(SUM(drinks), 0) FROM orders
                  WHERE slot_date = ? AND ${ACTIVE_SQL}) + ? <= ?`,
        )
        .bind(
          ...values,
          row.slot_date,
          row.slot_time,
          nowIso,
          row.drinks,
          capacity.drinksPerSlot,
          row.slot_date,
          nowIso,
          row.drinks,
          capacity.drinksPerDay,
        )
    : db.prepare(`INSERT INTO orders (${cols}) VALUES (${placeholders})`).bind(...values);

  const exists = 'WHERE EXISTS (SELECT 1 FROM orders WHERE code = ?)';
  const items = lines.map((l) =>
    db
      .prepare(
        `INSERT INTO order_items (order_code, item_id, variant_id, name, variant_label, options_label,
           options_json, qty, unit_price_cents, line_total_cents)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? ${exists}`,
      )
      .bind(
        row.code,
        l.itemId,
        l.variantId,
        l.name,
        l.variantLabel,
        optionsLabel(l),
        JSON.stringify(l.options),
        l.qty,
        l.unitPriceCents,
        l.lineTotalCents,
        row.code,
      ),
  );
  const created = db
    .prepare(`INSERT INTO order_events (order_code, at, type, detail) SELECT ?, ?, 'created', ? ${exists}`)
    .bind(row.code, nowIso, `${row.payment_method} · ${row.payment_plan}`, row.code);

  const [res] = await db.batch([insert, ...items, created]);
  return (res?.meta.changes ?? 0) > 0;
}

export const optionsLabel = (l: Pick<PricedLine, 'options'>) => l.options.map((o) => o.label).join(', ');

/**
 * Cambia el estado solo si sigue siendo `from` (evita carreras entre webhook, admin y cron)
 * y registra el evento. Devuelve la fila nueva o `null` si alguien más la cambió antes.
 */
export async function transition(
  db: D1Database,
  code: string,
  from: OrderRow['status'],
  set: Partial<Pick<OrderRow, 'status' | 'paid_cents' | 'provider_fee_cents' | 'mp_payment_id'>>,
  event: { type: string; detail: string },
  now = new Date(),
): Promise<OrderRow | null> {
  const keys = Object.keys(set) as (keyof typeof set)[];
  const assignments = [...keys.map((k) => `${k} = ?`), 'updated_at = ?'].join(', ');
  const [upd] = await db.batch([
    db
      .prepare(`UPDATE orders SET ${assignments} WHERE code = ? AND status = ?`)
      .bind(...keys.map((k) => set[k] ?? null), now.toISOString(), code, from),
    db
      .prepare(
        `INSERT INTO order_events (order_code, at, type, detail)
         SELECT ?, ?, ?, ? WHERE changes() > 0`,
      )
      .bind(code, now.toISOString(), event.type, event.detail),
  ]);
  if (!upd || upd.meta.changes === 0) return null;
  return db.prepare('SELECT * FROM orders WHERE code = ?').bind(code).first<OrderRow>();
}
