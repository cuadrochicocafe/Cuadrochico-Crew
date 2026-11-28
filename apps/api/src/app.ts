import {
  type AdminOrdersResponse,
  type ApiError,
  type AvailabilityResponse,
  addDays,
  type CatalogResponse,
  type CreateOrderResponse,
  cancelProblem,
  cancelProblemMessage,
  chargeFor,
  checkSlot,
  dayAvailability,
  defaultMenu,
  localDate,
  NO_BOOKINGS,
  OrderInputSchema,
  type OrderResponse,
  type OrderStatus,
  type PaymentInstructions,
  quote,
  quoteErrorMessage,
  type Settings,
  type StaffListResponse,
  type StaffLoginResponse,
  slotProblemMessage,
  toPublicSettings,
} from '@cuadrochico/core';
import { type Context, Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { bookingsBetween, insertOrder, transition } from './db';
import { onOrderCreated, onPaymentUpdated, onStatusChanged } from './effects';
import { type AppEnv, type Env, settingsFor } from './env';
import { createPreference, feeCents, getPayment, toCents, verifySignature } from './mercadopago';
import { type EventRow, getOrder, logEvent, type OrderRow, toAdminOrder, toPublicOrder } from './orders';
import { newAccessToken, newOrderCode, safeEqual, sha256Hex } from './security';
import { actorFor, login, publicStaff } from './staff';
import { verifyTurnstile } from './turnstile';

type C = Context<AppEnv>;

const fail = (c: C, status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 502 | 503 | 500, body: ApiError) =>
  c.json(body, status);

const zodIssues = (error: z.ZodError) =>
  error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message }));

/** Corre un efecto después de responder; en pruebas se espera con `waitOnExecutionContext`. */
function background(c: C, p: Promise<unknown>) {
  const safe = p.catch((err) => console.error('background', err));
  try {
    c.executionCtx.waitUntil(safe);
  } catch {
    // Sin ExecutionContext (no debería pasar en Workers): el efecto corre igual sin esperar.
  }
}

function paymentFor(r: OrderRow, settings: Settings): PaymentInstructions | null {
  if (r.status !== 'pending_payment') return null;
  if (r.payment_method === 'mercadopago')
    return r.mp_checkout_url
      ? { method: 'mercadopago', amountCents: r.due_now_cents, checkoutUrl: r.mp_checkout_url }
      : null;
  const t = settings.payments.transfer;
  if (!t.enabled) return null;
  return {
    method: 'transfer',
    amountCents: r.due_now_cents,
    bank: t.bank,
    beneficiary: t.beneficiary,
    clabe: t.clabe,
    reference: r.code,
  };
}

/** Busca el pedido y valida el token del cliente. Código inexistente y token incorrecto responden igual. */
async function orderWithToken(c: C): Promise<OrderRow | null> {
  const code = c.req.param('code')?.toUpperCase() ?? '';
  const token = c.req.query('t') ?? '';
  if (!token) return null;
  const row = await getOrder(c.env.DB, code);
  if (!row) return null;
  return safeEqual(await sha256Hex(token), row.token_hash) ? row : null;
}

async function uniqueCode(db: D1Database): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = newOrderCode(i < 5 ? 4 : 5);
    if (!(await db.prepare('SELECT 1 FROM orders WHERE code = ?').bind(code).first())) return code;
  }
  throw new Error('No se pudo generar un código de pedido único');
}

export const app = new Hono<AppEnv>();

app.onError((err, c) => {
  console.error(err);
  return fail(c, 500, { error: 'internal', message: 'Ocurrió un error inesperado. Intenta de nuevo.' });
});

// ---------- Público

app.get('/api/catalog', (c) => {
  const body: CatalogResponse = { menu: defaultMenu, settings: toPublicSettings(settingsFor(c.env)) };
  return c.json(body);
});

const AvailabilityQuery = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  days: z.coerce.number().int().min(1).max(62).default(14),
  drinks: z.coerce.number().int().min(0).max(1000).default(0),
});

app.get('/api/availability', async (c) => {
  const parsed = AvailabilityQuery.safeParse(c.req.query());
  if (!parsed.success) return fail(c, 400, { error: 'validation', issues: zodIssues(parsed.error) });
  const settings = settingsFor(c.env);
  const now = new Date();
  const from = parsed.data.from ?? localDate(now, settings.timezone);
  const to = addDays(from, parsed.data.days - 1);
  const booked = settings.capacity ? await bookingsBetween(c.env.DB, from, to, now) : null;
  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1))
    days.push(dayAvailability(d, now, settings, booked?.get(d) ?? NO_BOOKINGS, parsed.data.drinks));
  const body: AvailabilityResponse = { days };
  return c.json(body);
});

app.post('/api/orders', async (c) => {
  const env = c.env;
  const settings = settingsFor(env);
  const raw = await c.req.json().catch(() => undefined);
  const parsed = OrderInputSchema.safeParse(raw);
  if (!parsed.success) return fail(c, 400, { error: 'validation', issues: zodIssues(parsed.error) });
  const input = parsed.data;

  if (!settings.payments[input.paymentMethod].enabled)
    return fail(c, 400, {
      error: 'validation',
      issues: [{ path: 'paymentMethod', message: 'Ese método de pago no está disponible por ahora.' }],
    });

  if (
    env.TURNSTILE_SECRET &&
    !(await verifyTurnstile(
      env.TURNSTILE_SECRET,
      input.captchaToken,
      c.req.header('cf-connecting-ip') ?? null,
    ))
  )
    return fail(c, 400, {
      error: 'captcha',
      message: 'No pudimos verificar que no eres un robot. Recarga la página o pídenos por WhatsApp.',
    });

  // El precio lo define el servidor: se recalcula con core, ignorando lo que mande el cliente.
  const q = quote(input.lines, {
    menu: defaultMenu,
    settings,
    fulfillment: input.fulfillment.type,
    date: input.slot.date,
  });
  if (!q.ok)
    return fail(c, 422, {
      error: 'quote',
      messages: [...new Set(q.errors.map((e) => quoteErrorMessage(e, defaultMenu)))],
    });
  const qv = q.value;

  const now = new Date();
  const { date, time } = input.slot;
  const slotError = (problem: NonNullable<ReturnType<typeof checkSlot>>) =>
    fail(c, 409, { error: 'slot', problem, message: slotProblemMessage(problem, settings, qv.drinks) });
  const booked = settings.capacity
    ? ((await bookingsBetween(env.DB, date, date, now)).get(date) ?? NO_BOOKINGS)
    : NO_BOOKINGS;
  const problem = checkSlot(date, time, qv.drinks, now, settings, booked);
  if (problem) return slotError(problem);

  const code = await uniqueCode(env.DB);
  const accessToken = newAccessToken();
  const expiresAt = new Date(now.getTime() + settings.unpaidHoldHours * 3600_000).toISOString();
  const { dueNowCents } = chargeFor(qv, input.paymentPlan);
  const origin = new URL(c.req.url).origin;
  const orderUrl = `${origin}/pedido/${code}?t=${accessToken}`;

  let checkoutUrl: string | null = null;
  if (input.paymentMethod === 'mercadopago') {
    try {
      checkoutUrl = await createPreference(env.MP_ACCESS_TOKEN ?? '', {
        code,
        title: `Pedido ${code} · ${qv.drinks} bebidas · ${settings.businessName}`,
        amountCents: dueNowCents,
        backUrl: orderUrl,
        notificationUrl: `${origin}/api/webhooks/mercadopago`,
        expiresAt,
      });
    } catch (err) {
      console.error('mercadopago', err);
      return fail(c, 502, {
        error: 'payment_provider',
        message: 'Mercado Pago no respondió. Intenta de nuevo o elige transferencia.',
      });
    }
  }

  const f = input.fulfillment;
  const row: OrderRow = {
    code,
    token_hash: await sha256Hex(accessToken),
    status: 'pending_payment',
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    expires_at: expiresAt,
    slot_date: date,
    slot_time: time,
    fulfillment_type: f.type,
    delivery_address: f.type === 'delivery' ? f.address : '',
    delivery_references: f.type === 'delivery' ? f.references : '',
    customer_name: input.customer.name,
    customer_phone: input.customer.phone,
    customer_email: input.customer.email,
    payment_method: input.paymentMethod,
    payment_plan: input.paymentPlan,
    quote_json: JSON.stringify(qv),
    drinks: qv.drinks,
    total_cents: qv.totalCents,
    due_now_cents: dueNowCents,
    paid_cents: 0,
    provider_fee_cents: input.paymentMethod === 'transfer' ? 0 : null,
    notes: input.notes,
    mp_checkout_url: checkoutUrl,
    mp_payment_id: null,
  };

  if (!(await insertOrder(env.DB, row, qv.lines, settings.capacity, now))) {
    // Otro pedido ocupó el lugar entre la verificación y el guardado.
    const again = (await bookingsBetween(env.DB, date, date, now)).get(date) ?? NO_BOOKINGS;
    return slotError(checkSlot(date, time, qv.drinks, now, settings, again) ?? 'slot_full');
  }

  background(c, onOrderCreated(env, row));
  const payment = paymentFor(row, settings);
  if (!payment) throw new Error('Método de pago sin instrucciones');
  const body: CreateOrderResponse = { order: toPublicOrder(row, settings, now), accessToken, payment };
  return c.json(body, 201);
});

app.get('/api/orders/:code', async (c) => {
  const row = await orderWithToken(c);
  if (!row) return fail(c, 404, { error: 'not_found' });
  const settings = settingsFor(c.env);
  const body: OrderResponse = { order: toPublicOrder(row, settings), payment: paymentFor(row, settings) };
  return c.json(body);
});

app.post('/api/orders/:code/cancel', async (c) => {
  const row = await orderWithToken(c);
  if (!row) return fail(c, 404, { error: 'not_found' });
  const settings = settingsFor(c.env);
  const now = new Date();
  const problem = cancelProblem(
    {
      createdAt: new Date(row.created_at),
      slot: { date: row.slot_date, time: row.slot_time },
      status: row.status,
    },
    now,
    settings,
  );
  if (problem)
    return fail(c, 409, {
      error: 'not_cancellable',
      problem,
      message: cancelProblemMessage(problem, settings),
    });
  const updated = await transition(
    c.env.DB,
    row.code,
    row.status,
    { status: 'cancelled' },
    { type: 'status', detail: `${row.status} → cancelled (cliente)` },
    now,
  );
  if (!updated)
    return fail(c, 409, {
      error: 'not_cancellable',
      problem: 'invalid_status',
      message: cancelProblemMessage('invalid_status', settings),
    });
  background(c, onStatusChanged(c.env, updated, row.status, settings, 'customer'));
  const body: OrderResponse = { order: toPublicOrder(updated, settings, now), payment: null };
  return c.json(body);
});

// ---------- Mercado Pago

app.post('/api/webhooks/mercadopago', async (c) => {
  const env = c.env;
  const settings = settingsFor(env);
  if (!settings.payments.mercadopago.enabled || !env.MP_ACCESS_TOKEN || !env.MP_WEBHOOK_SECRET)
    return fail(c, 503, { error: 'payment_provider', message: 'Mercado Pago no está configurado.' });

  const body = (await c.req.json().catch(() => ({}))) as { type?: string; data?: { id?: string | number } };
  const dataId = c.req.query('data.id') ?? (body.data?.id !== undefined ? String(body.data.id) : undefined);
  const valid = await verifySignature(
    env.MP_WEBHOOK_SECRET,
    c.req.header('x-signature'),
    c.req.header('x-request-id'),
    dataId,
  );
  if (!valid) return fail(c, 401, { error: 'unauthorized' });

  const type = c.req.query('type') ?? body.type ?? c.req.query('topic');
  if (type !== 'payment' || !dataId) return c.json({ ok: true });

  const payment = await getPayment(env.MP_ACCESS_TOKEN, dataId);
  const code = payment.external_reference ?? '';
  const row = await getOrder(env.DB, code);
  if (!row) {
    console.warn('webhook: pago sin pedido', dataId, code);
    return c.json({ ok: true });
  }
  const paid = toCents(payment.transaction_amount);
  const detail = `pago ${payment.id}: ${payment.status}, ${paid} centavos`;

  if (payment.status !== 'approved') {
    await logEvent(env.DB, row.code, 'mp_payment', detail);
    return c.json({ ok: true });
  }
  if (row.mp_payment_id === String(payment.id)) return c.json({ ok: true }); // reintento ya procesado
  if (paid < row.due_now_cents) {
    await logEvent(env.DB, row.code, 'payment_insufficient', `${detail}; se esperaban ${row.due_now_cents}`);
    return c.json({ ok: true });
  }
  if (row.status !== 'pending_payment' && row.status !== 'expired') {
    await logEvent(env.DB, row.code, 'payment_unexpected', `${detail}; estado ${row.status}`);
    return c.json({ ok: true });
  }
  const updated = await transition(
    env.DB,
    row.code,
    row.status,
    {
      status: 'confirmed',
      paid_cents: paid,
      provider_fee_cents: feeCents(payment),
      mp_payment_id: String(payment.id),
    },
    { type: 'status', detail: `${row.status} → confirmed (Mercado Pago, ${detail})` },
  );
  if (updated) background(c, onStatusChanged(env, updated, row.status, settings, 'system'));
  return c.json({ ok: true });
});

// ---------- Administración

// ---------- Equipo: login con PIN

/** La app interna del equipo (GitHub Pages) inicia sesión aquí; nadie más puede llamar desde el navegador. */
export const TEAM_APP_ORIGIN = 'https://cuadrochicocafe.github.io';
app.use('/api/staff/*', cors({ origin: TEAM_APP_ORIGIN, allowMethods: ['GET', 'POST'] }));
app.use('/api/staff', cors({ origin: TEAM_APP_ORIGIN, allowMethods: ['GET'] }));

app.get('/api/staff', (c) => {
  const body: StaffListResponse = { staff: publicStaff(c.env) };
  return c.json(body);
});

const StaffLoginSchema = z.object({
  name: z.string().min(1).max(60),
  pin: z.string().regex(/^\d{4,8}$/, 'El PIN son de 4 a 8 números.'),
});

app.post('/api/staff/login', async (c) => {
  const parsed = StaffLoginSchema.safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) return fail(c, 400, { error: 'validation', issues: zodIssues(parsed.error) });
  const r = await login(c.env, parsed.data.name, parsed.data.pin);
  if (r.ok) {
    const body: StaffLoginResponse = { token: r.token, ...r.actor, expiresAt: r.expiresAt };
    return c.json(body);
  }
  if (r.reason === 'locked')
    return fail(c, 429, {
      error: 'locked',
      message: 'Demasiados intentos con este nombre. Espera 15 minutos o pide ayuda a un gerente.',
    });
  return fail(c, 401, { error: 'unauthorized' });
});

app.use('/api/admin/*', async (c, next) => {
  const header = c.req.header('authorization') ?? '';
  const actor = await actorFor(c.env, header.startsWith('Bearer ') ? header.slice(7) : '');
  if (!actor) return fail(c, 401, { error: 'unauthorized' });
  c.set('actor', actor);
  await next();
});

/** Lo que un barista puede marcar; todo lo demás es de gerente. */
const BARISTA_STATUSES: readonly OrderStatus[] = ['ready', 'completed'];

const STATUSES = ['pending_payment', 'confirmed', 'ready', 'completed', 'cancelled', 'expired'] as const;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha AAAA-MM-DD');

const AdminOrdersQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  status: z.enum(STATUSES).optional(),
});

async function eventsFor(db: D1Database, codes: string[]): Promise<Map<string, EventRow[]>> {
  const out = new Map<string, EventRow[]>();
  // D1 limita los parámetros por consulta: se piden en grupos.
  for (let i = 0; i < codes.length; i += 90) {
    const chunk = codes.slice(i, i + 90);
    const { results } = await db
      .prepare(
        `SELECT order_code, at, type, detail FROM order_events
         WHERE order_code IN (${chunk.map(() => '?').join(', ')}) ORDER BY id`,
      )
      .bind(...chunk)
      .all<EventRow & { order_code: string }>();
    for (const { order_code, ...e } of results) out.set(order_code, [...(out.get(order_code) ?? []), e]);
  }
  return out;
}

app.get('/api/admin/orders', async (c) => {
  const parsed = AdminOrdersQuery.safeParse(c.req.query());
  if (!parsed.success) return fail(c, 400, { error: 'validation', issues: zodIssues(parsed.error) });
  const { from, to, status } = parsed.data;
  const filters: [string, string | undefined][] = [
    ['slot_date >= ?', from],
    ['slot_date <= ?', to],
    ['status = ?', status],
  ];
  const active = filters.filter((f): f is [string, string] => f[1] !== undefined);
  const where = active.map(([sql]) => sql);
  const binds = active.map(([, v]) => v);
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM orders ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY slot_date, slot_time, created_at LIMIT 500`,
  )
    .bind(...binds)
    .all<OrderRow>();
  const events = await eventsFor(
    c.env.DB,
    results.map((r) => r.code),
  );
  const settings = settingsFor(c.env);
  const body: AdminOrdersResponse = {
    orders: results.map((r) => toAdminOrder(r, events.get(r.code) ?? [], settings)),
  };
  return c.json(body);
});

const AdminUpdateSchema = z
  .object({
    status: z.enum(STATUSES).optional(),
    paidCents: z.number().int().nonnegative().optional(),
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

app.patch('/api/admin/orders/:code', async (c) => {
  const env = c.env;
  const parsed = AdminUpdateSchema.safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) return fail(c, 400, { error: 'validation', issues: zodIssues(parsed.error) });
  const code = c.req.param('code').toUpperCase();
  const row = await getOrder(env.DB, code);
  if (!row) return fail(c, 404, { error: 'not_found' });
  const settings = settingsFor(env);
  const { status, paidCents, note } = parsed.data;
  const actor = c.get('actor');
  // Un barista solo marca listo o entregado; al entregar puede registrar el saldo cobrado (el total exacto).
  const baristaOk =
    (status === undefined || BARISTA_STATUSES.includes(status)) &&
    (paidCents === undefined || (status === 'completed' && paidCents === row.total_cents));
  if (actor.role !== 'manager' && !baristaOk)
    return fail(c, 403, {
      error: 'forbidden',
      message: 'Solo un gerente puede cambiar pagos, confirmar o cancelar pedidos.',
    });

  let current = row;
  if (status !== undefined || paidCents !== undefined) {
    const set: { status?: OrderStatus; paid_cents?: number } = {};
    const changes: string[] = [];
    if (status !== undefined && status !== row.status) {
      set.status = status;
      changes.push(`${row.status} → ${status}`);
    }
    if (paidCents !== undefined && paidCents !== row.paid_cents) {
      set.paid_cents = paidCents;
      changes.push(`pagado ${row.paid_cents} → ${paidCents} centavos`);
    }
    if (changes.length) {
      const updated = await transition(env.DB, code, row.status, set, {
        type: set.status ? 'status' : 'payment',
        detail: `${changes.join('; ')} (${actor.name})`,
      });
      if (!updated)
        return fail(c, 409, {
          error: 'internal',
          message: 'El pedido cambió mientras lo editabas. Recarga.',
        });
      current = updated;
      background(c, onStatusChanged(env, current, row.status, settings, 'admin'));
      if (current.status === row.status)
        background(c, onPaymentUpdated(env, current, row.paid_cents, settings));
    }
  }
  if (note) await logEvent(env.DB, code, 'note', `${note} (${actor.name})`);

  const events = await eventsFor(env.DB, [code]);
  return c.json({ order: toAdminOrder(current, events.get(code) ?? [], settings) });
});

app.all('/api/*', (c) => fail(c, 404, { error: 'not_found' }));

// Todo lo demás es la app web (con fallback SPA). Sin ASSETS (pruebas, web sin compilar) responde 404.
app.all('*', (c) => (c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.text('Not found', 404)));

/** Cron: expira los pedidos sin pagar cuyo apartado venció. */
export async function expireOverdue(env: Env, now = new Date()): Promise<string[]> {
  const nowIso = now.toISOString();
  const { results } = await env.DB.prepare(
    `UPDATE orders SET status = 'expired', updated_at = ?
     WHERE status = 'pending_payment' AND expires_at <= ? RETURNING code`,
  )
    .bind(nowIso, nowIso)
    .all<{ code: string }>();
  const codes = results.map((r) => r.code);
  if (codes.length)
    await env.DB.batch(
      codes.map((code) =>
        env.DB.prepare('INSERT INTO order_events (order_code, at, type, detail) VALUES (?, ?, ?, ?)').bind(
          code,
          nowIso,
          'status',
          'pending_payment → expired (sin pago a tiempo)',
        ),
      ),
    );
  return codes;
}
