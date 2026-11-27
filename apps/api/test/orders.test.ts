import { env } from 'cloudflare:test';
import {
  type ApiError,
  type CatalogResponse,
  type CreateOrderResponse,
  defaultMenu,
  defaultSettings,
  type OrderInput,
  OrderInputSchema,
  type OrderResponse,
  quote,
} from '@cuadrochico/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { call, mockOutbound, type Outbound, orderInput, slotBetween, testEnv } from './helpers';

let out: Outbound;
beforeEach(() => {
  out = mockOutbound();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const expectedQuote = (input: ReturnType<typeof orderInput>) => {
  const parsed: OrderInput = OrderInputSchema.parse(input);
  const q = quote(parsed.lines, {
    menu: defaultMenu,
    settings: defaultSettings,
    fulfillment: 'pickup',
    date: parsed.slot.date,
  });
  if (!q.ok) throw new Error('cotización de prueba inválida');
  return q.value;
};

async function create(input = orderInput(), e = testEnv()) {
  const res = await call('/api/orders', { method: 'POST', json: input }, e);
  return { res, body: (await res.json()) as CreateOrderResponse & ApiError };
}

describe('GET /api/catalog', () => {
  it('reporta métodos de pago habilitados sin exponer datos bancarios', async () => {
    const body = (await (await call('/api/catalog')).json()) as CatalogResponse;
    expect(body.menu.items.length).toBeGreaterThan(0);
    expect(body.settings.payments).toEqual({ transfer: { enabled: true }, mercadopago: { enabled: true } });
    expect(JSON.stringify(body)).not.toContain('012345678901234567');
  });

  it('desactiva transferencia y Mercado Pago si faltan sus secretos', async () => {
    const e = testEnv({ TRANSFER_CLABE: undefined, MP_WEBHOOK_SECRET: undefined });
    const body = (await (await call('/api/catalog', {}, e)).json()) as CatalogResponse;
    expect(body.settings.payments).toEqual({ transfer: { enabled: false }, mercadopago: { enabled: false } });
  });
});

describe('GET /api/availability', () => {
  it('marca too_soon según el tamaño del pedido', async () => {
    const slot = slotBetween(96, 120);
    const q = (drinks: number) =>
      call(`/api/availability?from=${slot.date}&days=1&drinks=${drinks}`).then(
        (r) => r.json() as Promise<{ days: { slots: { time: string; available: boolean }[] }[] }>,
      );
    const small = await q(24);
    const big = await q(25);
    expect(small.days[0]?.slots.find((s) => s.time === slot.time)?.available).toBe(true);
    expect(big.days[0]?.slots.find((s) => s.time === slot.time)?.available).toBe(false);
  });
});

describe('POST /api/orders', () => {
  it('con anticipo por transferencia cobra el anticipo y da los datos bancarios', async () => {
    const input = orderInput();
    const { res, body } = await create(input);
    expect(res.status).toBe(201);
    const q = expectedQuote(input);
    expect(body.order.code).toMatch(/^CC-[2-9A-HJKMNP-Z]{4}$/);
    expect(body.order.status).toBe('pending_payment');
    expect(body.order.paymentPlan).toBe('deposit');
    expect(body.order.quote.totalCents).toBe(q.totalCents);
    expect(body.payment).toEqual({
      method: 'transfer',
      amountCents: q.depositCents,
      bank: 'Banco Prueba',
      beneficiary: 'Cuadrochico SA',
      clabe: '012345678901234567',
      reference: body.order.code,
    });
    expect(body.order.cancellation).toMatchObject({ refundable: true, canCancelNow: true });
    expect(body.order.expiresAt).not.toBeNull();
    const hold = Date.parse(body.order.expiresAt ?? '') - Date.parse(body.order.createdAt);
    expect(hold).toBe(defaultSettings.unpaidHoldHours * 3600_000);
    expect(out.telegram.some((t) => t.includes(body.order.code) && t.includes('Pedido nuevo'))).toBe(true);
  });

  it('con pago completo por Mercado Pago crea la preferencia por el total', async () => {
    const input = orderInput({ paymentMethod: 'mercadopago', paymentPlan: 'full' });
    const { res, body } = await create(input);
    expect(res.status).toBe(201);
    const q = expectedQuote(input);
    expect(body.payment).toEqual({
      method: 'mercadopago',
      amountCents: q.totalCents,
      checkoutUrl: `https://mp.test/checkout/${body.order.code}`,
    });
    const pref = out.preferences[0] as { items: { unit_price: number }[]; external_reference: string };
    expect(pref.external_reference).toBe(body.order.code);
    expect(pref.items[0]?.unit_price).toBe(q.totalCents / 100);
  });

  it('recalcula el precio en el servidor e ignora montos del cliente', async () => {
    const input = {
      ...orderInput(),
      quote: { totalCents: 100 },
      totalCents: 100,
      lines: [{ itemId: 'chai-latte', variantId: 'regular', qty: 12, unitPriceCents: 1, priceCents: 1 }],
    };
    const { res, body } = await create(input as ReturnType<typeof orderInput>);
    expect(res.status).toBe(201);
    // 12 × $80 = $960, 10 % de descuento = $864; anticipo 50 % = $432.
    expect(body.order.quote.totalCents).toBe(86400);
    expect(body.payment.amountCents).toBe(43200);
    const row = await env.DB.prepare('SELECT total_cents, due_now_cents FROM orders WHERE code = ?')
      .bind(body.order.code)
      .first();
    expect(row).toEqual({ total_cents: 86400, due_now_cents: 43200 });
  });

  it('rechaza 25 bebidas con menos de 168 h de anticipación (24 sí pasan)', async () => {
    const slot = slotBetween(96, 120);
    const lines = (qty: number) => [{ itemId: 'cold-brew-tonic', variantId: 'regular', qty }];
    const big = await create(orderInput({ slot, lines: lines(25) }));
    expect(big.res.status).toBe(409);
    expect(big.body.error).toBe('slot');
    expect(big.body).toMatchObject({ problem: 'too_soon' });
    expect((big.body as { message: string }).message).toContain('25 bebidas');
    const ok = await create(orderInput({ slot, lines: lines(24) }));
    expect(ok.res.status).toBe(201);
  });

  it('responde errores de validación con path y mensaje', async () => {
    const input = orderInput({ customer: { name: 'Ana', phone: '123' } });
    const { paymentPlan: _omit, ...withoutPlan } = input;
    const { res, body } = await create(withoutPlan as ReturnType<typeof orderInput>);
    expect(res.status).toBe(400);
    expect(body.error).toBe('validation');
    const paths = (body as Extract<ApiError, { error: 'validation' }>).issues.map((i) => i.path);
    expect(paths).toContain('customer.phone');
    expect(paths).toContain('paymentPlan');
    const bad = await call('/api/orders', { method: 'POST', body: 'no es json' });
    expect(bad.status).toBe(400);
  });

  it('responde error de cotización si la bebida no existe', async () => {
    const { res, body } = await create(
      orderInput({ lines: [{ itemId: 'espresso', variantId: 'x', qty: 6 }] }),
    );
    expect(res.status).toBe(422);
    expect(body.error).toBe('quote');
  });

  it('rechaza un método de pago desactivado', async () => {
    const { res, body } = await create(
      orderInput({ paymentMethod: 'mercadopago' }),
      testEnv({ MP_ACCESS_TOKEN: undefined }),
    );
    expect(res.status).toBe(400);
    expect(body).toMatchObject({ error: 'validation', issues: [{ path: 'paymentMethod' }] });
  });

  it('exige Turnstile solo si hay TURNSTILE_SECRET', async () => {
    const e = testEnv({ TURNSTILE_SECRET: 'secret' });
    const missing = await create(orderInput(), e);
    expect(missing.res.status).toBe(400);
    expect(missing.body.error).toBe('captcha');
    const ok = await create(orderInput({ captchaToken: 'token' }), e);
    expect(ok.res.status).toBe(201);
  });

  it('respeta la capacidad cuando está configurada', async () => {
    const original = defaultSettings.capacity;
    defaultSettings.capacity = { drinksPerSlot: 15, drinksPerDay: 100 };
    try {
      const slot = slotBetween(240, 320);
      expect((await create(orderInput({ slot }))).res.status).toBe(201);
      const full = await create(orderInput({ slot }));
      expect(full.res.status).toBe(409);
      expect(full.body).toMatchObject({ error: 'slot', problem: 'slot_full' });
    } finally {
      defaultSettings.capacity = original;
    }
  });
});

describe('GET /api/orders/:code', () => {
  it('con token válido devuelve el pedido; con token inválido, not_found', async () => {
    const { body } = await create();
    const ok = await call(`/api/orders/${body.order.code}?t=${body.accessToken}`);
    expect(ok.status).toBe(200);
    const got = (await ok.json()) as OrderResponse;
    expect(got.order.code).toBe(body.order.code);
    expect(got.payment?.method).toBe('transfer');
    expect(got.order.cancellation.refundable).toBe(true);

    for (const t of ['otro-token', '']) {
      const bad = await call(`/api/orders/${body.order.code}?t=${t}`);
      expect(bad.status).toBe(404);
      expect(await bad.json()).toEqual({ error: 'not_found' });
    }
    expect((await call(`/api/orders/CC-ZZZZ?t=${body.accessToken}`)).status).toBe(404);
  });
});

describe('POST /api/orders/:code/cancel', () => {
  const cancel = (code: string, token: string) =>
    call(`/api/orders/${code}/cancel?t=${token}`, { method: 'POST' });

  it('cancela en plazo y avisa al equipo', async () => {
    const { body } = await create();
    const res = await cancel(body.order.code, body.accessToken);
    expect(res.status).toBe(200);
    const got = (await res.json()) as OrderResponse;
    expect(got.order.status).toBe('cancelled');
    expect(got.order.cancellation.canCancelNow).toBe(false);
    expect(got.payment).toBeNull();
    expect(out.telegram.some((t) => t.includes('canceló') && t.includes(body.order.code))).toBe(true);
    const ev = await env.DB.prepare('SELECT type FROM order_events WHERE order_code = ? ORDER BY id')
      .bind(body.order.code)
      .all();
    expect(ev.results.map((r) => r.type)).toEqual(['created', 'status']);
  });

  it('no cancela un pedido creado con menos de 72 h de anticipación', async () => {
    const { res: created, body } = await create(orderInput({ slot: slotBetween(50, 70) }));
    expect(created.status).toBe(201);
    expect(body.order.cancellation).toEqual({ refundable: false, deadline: null, canCancelNow: false });
    const res = await cancel(body.order.code, body.accessToken);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'not_cancellable',
      problem: 'not_refundable_order',
      message: 'Este pedido no se puede cancelar ni reembolsar.',
    });
  });

  it('no cancela después del plazo', async () => {
    const { body } = await create();
    const near = slotBetween(50, 70);
    await env.DB.prepare('UPDATE orders SET created_at = ?, slot_date = ?, slot_time = ? WHERE code = ?')
      .bind(new Date(Date.now() - 20 * 86400_000).toISOString(), near.date, near.time, body.order.code)
      .run();
    const res = await cancel(body.order.code, body.accessToken);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'not_cancellable', problem: 'deadline_passed' });
  });

  it('con token inválido responde not_found', async () => {
    const { body } = await create();
    expect((await cancel(body.order.code, 'x')).status).toBe(404);
  });
});

describe('cron', () => {
  it('expira los pedidos sin pagar vencidos y libera el resto', async () => {
    const { runCron } = await import('./helpers');
    const a = await create();
    const b = await create();
    await env.DB.prepare('UPDATE orders SET expires_at = ? WHERE code = ?')
      .bind(new Date(Date.now() - 60_000).toISOString(), a.body.order.code)
      .run();
    await runCron();
    const rows = await env.DB.prepare('SELECT code, status FROM orders ORDER BY code').all();
    const status = Object.fromEntries(rows.results.map((r) => [r.code, r.status]));
    expect(status[a.body.order.code]).toBe('expired');
    expect(status[b.body.order.code]).toBe('pending_payment');
  });
});

describe('rutas desconocidas', () => {
  it('/api/* responde JSON not_found y lo demás 404 sin assets', async () => {
    const api = await call('/api/nada');
    expect(api.status).toBe(404);
    expect(await api.json()).toEqual({ error: 'not_found' });
    expect((await call('/pedido/CC-AAAA')).status).toBe(404);
  });
});
