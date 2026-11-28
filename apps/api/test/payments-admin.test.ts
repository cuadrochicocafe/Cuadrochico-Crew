import { env } from 'cloudflare:test';
import type { AdminOrder, AdminOrdersResponse, CreateOrderResponse } from '@cuadrochico/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventIdFor } from '../src/calendar';
import { admin, call, mockOutbound, type Outbound, orderInput, signedWebhook, testEnv } from './helpers';

let out: Outbound;
beforeEach(() => {
  out = mockOutbound();
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function create(input = orderInput()) {
  const res = await call('/api/orders', { method: 'POST', json: input });
  expect(res.status).toBe(201);
  return (await res.json()) as CreateOrderResponse;
}

async function adminOrder(code: string): Promise<AdminOrder> {
  const res = await admin('/api/admin/orders');
  const body = (await res.json()) as AdminOrdersResponse;
  const o = body.orders.find((x) => x.code === code);
  if (!o) throw new Error(`no está ${code}`);
  return o;
}

/** Pedido por Mercado Pago + pago aprobado simulado por el monto a cobrar. */
async function mpOrderWithPayment(plan: 'deposit' | 'full' = 'deposit', fee = 31.5) {
  const created = await create(orderInput({ paymentMethod: 'mercadopago', paymentPlan: plan }));
  const id = String(Math.floor(Math.random() * 1e9));
  out.payments.set(id, {
    id: Number(id),
    status: 'approved',
    external_reference: created.order.code,
    transaction_amount: created.payment.amountCents / 100,
    fee_details: [
      { type: 'mercadopago_fee', amount: fee },
      { type: 'application_fee', amount: 0.5 },
    ],
  });
  return { created, id };
}

describe('admin: autenticación', () => {
  it('exige Bearer ADMIN_TOKEN', async () => {
    expect((await call('/api/admin/orders')).status).toBe(401);
    expect(
      (await call('/api/admin/orders', { headers: { authorization: 'Bearer otro-token' } })).status,
    ).toBe(401);
    expect(await (await call('/api/admin/orders')).json()).toEqual({ error: 'unauthorized' });
    expect((await admin('/api/admin/orders')).status).toBe(200);
  });

  it('sin ADMIN_TOKEN configurado, el admin queda cerrado', async () => {
    const res = await admin('/api/admin/orders', {}, testEnv({ ADMIN_TOKEN: undefined }));
    expect(res.status).toBe(401);
  });
});

describe('webhook de Mercado Pago', () => {
  it('rechaza una firma inválida', async () => {
    const { created, id } = await mpOrderWithPayment();
    const res = await signedWebhook(id, 'otro-secreto');
    expect(res.status).toBe(401);
    const noSig = await call(`/api/webhooks/mercadopago?data.id=${id}&type=payment`, {
      method: 'POST',
      json: { type: 'payment', data: { id } },
    });
    expect(noSig.status).toBe(401);
    expect((await adminOrder(created.order.code)).status).toBe('pending_payment');
  });

  it('pago aprobado confirma, guarda la comisión real y crea el evento de Calendar', async () => {
    const { created, id } = await mpOrderWithPayment('deposit');
    const code = created.order.code;
    const res = await signedWebhook(id);
    expect(res.status).toBe(200);

    const o = await adminOrder(code);
    expect(o.status).toBe('confirmed');
    expect(o.paidCents).toBe(created.payment.amountCents);
    expect(o.providerFeeCents).toBe(3200);
    expect(o.refundCents).toBeNull();
    expect(o.events.map((e) => e.type)).toContain('calendar_synced');
    expect(out.telegram.some((t) => t.includes('Pago confirmado') && t.includes(code))).toBe(true);

    expect(out.tokenRequests).toBe(1);
    const post = out.calendar.find((c) => c.method === 'POST');
    expect(post?.url).toBe(
      'https://www.googleapis.com/calendar/v3/calendars/equipo%40group.calendar.google.com/events',
    );
    const ev = post?.body as {
      id: string;
      summary: string;
      description: string;
      start: { dateTime: string; timeZone: string };
      end: { dateTime: string };
      reminders: unknown;
    };
    expect(ev.id).toBe(eventIdFor(code));
    expect(ev.id).toMatch(/^[a-v0-9]{5,1024}$/);
    expect(ev.summary).toBe(`${code} · 12 bebidas · Ana`);
    expect(ev.description).toContain('6 × Cold Brew Latte · Regular · Avena, Vainilla');
    expect(ev.description).toContain('Sin popote');
    expect(ev.description).toContain('Anticipo 50 %');
    expect(ev.description).toContain(`/admin?pedido=${code}`);
    expect(ev.start.timeZone).toBe('America/Monterrey');
    expect(Date.parse(ev.end.dateTime) - Date.parse(ev.start.dateTime)).toBe(30 * 60_000);
    expect(ev.reminders).toEqual({
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 4320 },
        { method: 'popup', minutes: 2880 },
      ],
    });

    // Reintento del mismo webhook: idempotente, no duplica evento.
    await signedWebhook(id);
    expect(out.calendar.filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  it('un pago menor al monto a cobrar no confirma', async () => {
    const { created, id } = await mpOrderWithPayment('full');
    const p = out.payments.get(id);
    if (p) p.transaction_amount = created.payment.amountCents / 100 - 1;
    await signedWebhook(id);
    const o = await adminOrder(created.order.code);
    expect(o.status).toBe('pending_payment');
    expect(o.events.map((e) => e.type)).toContain('payment_insufficient');
  });

  it('un error de Calendar no impide confirmar y queda en la bitácora', async () => {
    out.calendarStatus = 500;
    const { created, id } = await mpOrderWithPayment();
    const res = await signedWebhook(id);
    expect(res.status).toBe(200);
    const o = await adminOrder(created.order.code);
    expect(o.status).toBe('confirmed');
    const err = o.events.find((e) => e.type === 'calendar_error');
    expect(err?.detail).toContain('500');
  });

  it('si el evento ya existe (409) lo reemplaza con PUT', async () => {
    out.calendarStatus = 409;
    const { created, id } = await mpOrderWithPayment();
    await signedWebhook(id);
    const put = out.calendar.find((c) => c.method === 'PUT');
    expect(put?.url).toContain(`/events/${eventIdFor(created.order.code)}`);
  });
});

describe('calendario y saldo', () => {
  it('si el admin cambia lo pagado sin cambiar el estado, se actualiza el evento', async () => {
    const created = await create();
    const code = created.order.code;
    await admin(`/api/admin/orders/${code}`, {
      method: 'PATCH',
      json: { status: 'confirmed', paidCents: created.payment.amountCents },
    });
    const writes = () => out.calendar.filter((c) => c.method === 'POST' || c.method === 'PUT').length;
    const before = writes();
    const total = created.order.quote.totalCents;
    const res = await admin(`/api/admin/orders/${code}`, { method: 'PATCH', json: { paidCents: total } });
    expect(res.status).toBe(200);
    expect(writes()).toBe(before + 1);
    const synced = (await adminOrder(code)).events.filter((e) => e.type === 'calendar_synced');
    expect(synced).toHaveLength(2);
  });
});

describe('reembolsos', () => {
  it('transferencia: se devuelve completo lo pagado', async () => {
    const created = await create();
    const code = created.order.code;
    const patch = await admin(`/api/admin/orders/${code}`, {
      method: 'PATCH',
      json: { status: 'confirmed', paidCents: created.payment.amountCents, note: 'SPEI recibido' },
    });
    expect(patch.status).toBe(200);
    const patched = ((await patch.json()) as { order: AdminOrder }).order;
    expect(patched.status).toBe('confirmed');
    expect(patched.providerFeeCents).toBe(0);
    expect(patched.events.map((e) => e.type)).toEqual(expect.arrayContaining(['created', 'status', 'note']));
    expect((await adminOrder(code)).events.map((e) => e.type)).toContain('calendar_synced');

    const res = await call(`/api/orders/${code}/cancel?t=${created.accessToken}`, { method: 'POST' });
    expect(res.status).toBe(200);
    const o = await adminOrder(code);
    expect(o.status).toBe('cancelled');
    expect(o.refundCents).toBe(created.payment.amountCents);
    expect(out.calendar.some((c) => c.method === 'DELETE' && c.url.endsWith(eventIdFor(code)))).toBe(true);
    const notice = out.telegram.find((t) => t.includes('canceló'));
    expect(notice).toContain('Devolver a mano');
    expect(out.refunds).toHaveLength(0);
  });

  it('Mercado Pago: al cancelar se reembolsa el total automáticamente', async () => {
    const { created, id } = await mpOrderWithPayment('full', 99.99);
    await signedWebhook(id);
    const code = created.order.code;
    const res = await call(`/api/orders/${code}/cancel?t=${created.accessToken}`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(out.refunds).toEqual([{ paymentId: id, idempotencyKey: `refund-${code}` }]);
    const o = await adminOrder(code);
    expect(o.providerFeeCents).toBe(10049);
    expect(o.refundCents).toBe(created.payment.amountCents);
    expect(o.events.map((e) => e.type)).toContain('mp_refund');
    const notice = out.telegram.find((t) => t.includes('canceló'));
    expect(notice).toContain('Reembolsado automáticamente por Mercado Pago');
    expect(notice).not.toContain('Devolver a mano');
  });

  it('Mercado Pago: si el reembolso falla, queda en la bitácora y se avisa para hacerlo a mano', async () => {
    out.refundStatus = 400;
    const { created, id } = await mpOrderWithPayment('deposit');
    await signedWebhook(id);
    const code = created.order.code;
    await call(`/api/orders/${code}/cancel?t=${created.accessToken}`, { method: 'POST' });
    const o = await adminOrder(code);
    expect(o.status).toBe('cancelled');
    expect(o.events.find((e) => e.type === 'mp_refund_error')?.detail).toContain('400');
    expect(out.telegram.find((t) => t.includes('canceló'))).toContain('Devolver a mano');
  });

  it('Mercado Pago sin pago: cancelar no intenta reembolsar', async () => {
    const created = await create(orderInput({ paymentMethod: 'mercadopago' }));
    await call(`/api/orders/${created.order.code}/cancel?t=${created.accessToken}`, { method: 'POST' });
    expect(out.refunds).toHaveLength(0);
  });

  it('el admin cancelando no reembolsa solo', async () => {
    const { created, id } = await mpOrderWithPayment();
    await signedWebhook(id);
    await admin(`/api/admin/orders/${created.order.code}`, {
      method: 'PATCH',
      json: { status: 'cancelled' },
    });
    expect(out.refunds).toHaveLength(0);
  });

  it('un pedido hecho con menos de 72 h no se puede cancelar ni se reembolsa', async () => {
    const { slotBetween } = await import('./helpers');
    const created = await create(orderInput({ paymentMethod: 'mercadopago', slot: slotBetween(50, 70) }));
    const res = await call(`/api/orders/${created.order.code}/cancel?t=${created.accessToken}`, {
      method: 'POST',
    });
    expect(res.status).toBe(409);
    expect(out.refunds).toHaveLength(0);
  });

  it('cancelado sin pagos: refundCents es null', async () => {
    const created = await create();
    await call(`/api/orders/${created.order.code}/cancel?t=${created.accessToken}`, { method: 'POST' });
    expect((await adminOrder(created.order.code)).refundCents).toBeNull();
  });
});

describe('admin: pedidos y producción', () => {
  it('filtra por estado y valida el PATCH', async () => {
    const a = await create();
    await create();
    await admin(`/api/admin/orders/${a.order.code}`, { method: 'PATCH', json: { status: 'confirmed' } });
    const res = await admin('/api/admin/orders?status=confirmed');
    const body = (await res.json()) as AdminOrdersResponse;
    expect(body.orders.map((o) => o.code)).toEqual([a.order.code]);
    expect(body.orders[0]?.customerPhone).toBe('8112345678');

    const bad = await admin(`/api/admin/orders/${a.order.code}`, { method: 'PATCH', json: { status: 'x' } });
    expect(bad.status).toBe(400);
    const missing = await admin('/api/admin/orders/CC-ZZZZ', { method: 'PATCH', json: { note: 'hola' } });
    expect(missing.status).toBe(404);
  });
});

it('el cron no toca pedidos confirmados', async () => {
  const { runCron } = await import('./helpers');
  const created = await create();
  await admin(`/api/admin/orders/${created.order.code}`, { method: 'PATCH', json: { status: 'confirmed' } });
  await env.DB.prepare('UPDATE orders SET expires_at = ?').bind(new Date(0).toISOString()).run();
  await runCron();
  expect((await adminOrder(created.order.code)).status).toBe('confirmed');
});
