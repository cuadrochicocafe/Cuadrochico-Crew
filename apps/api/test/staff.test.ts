import { env } from 'cloudflare:test';
import type {
  AdminOrder,
  CreateOrderResponse,
  StaffListResponse,
  StaffLoginResponse,
} from '@cuadrochico/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { call, mockOutbound, orderInput, STAFF, testEnv } from './helpers';

beforeEach(async () => {
  mockOutbound();
  await env.DB.prepare('DELETE FROM staff_logins').run();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const loginAs = (name: string, pin: string) =>
  call('/api/staff/login', { method: 'POST', json: { name, pin } });

async function session(who: { name: string; pin: string }): Promise<string> {
  const res = await loginAs(who.name, who.pin);
  expect(res.status).toBe(200);
  return ((await res.json()) as StaffLoginResponse).token;
}

const as = (token: string, path: string, init: RequestInit & { json?: unknown } = {}) =>
  call(path, { ...init, headers: { authorization: `Bearer ${token}` } });

async function createOrder() {
  const res = await call('/api/orders', { method: 'POST', json: orderInput() });
  return ((await res.json()) as CreateOrderResponse).order.code;
}

describe('login del equipo con PIN', () => {
  it('lista nombres y roles, nunca huellas', async () => {
    const res = await call('/api/staff');
    const body = (await res.json()) as StaffListResponse;
    expect(body.staff).toEqual([
      { name: 'Rudy', role: 'manager' },
      { name: 'Sofía', role: 'barista' },
    ]);
    expect(JSON.stringify(body)).not.toMatch(/"h"|"s"/);
  });

  it('PIN correcto da una sesión que abre el admin; PIN incorrecto no', async () => {
    const res = await loginAs('Sofía', STAFF.barista.pin);
    const body = (await res.json()) as StaffLoginResponse;
    expect(body).toMatchObject({ name: 'Sofía', role: 'barista' });
    expect((await as(body.token, '/api/admin/orders')).status).toBe(200);

    expect((await loginAs('Sofía', '0000')).status).toBe(401);
    expect((await loginAs('Nadie', '1234')).status).toBe(401);
    expect((await loginAs('Rudy', 'abcd')).status).toBe(400);
  });

  it('bloquea tras 5 intentos fallidos, aun con el PIN correcto', async () => {
    for (let i = 0; i < 4; i++) expect((await loginAs('Rudy', '9999')).status).toBe(401);
    const fifth = await loginAs('Rudy', '9999');
    expect(fifth.status).toBe(429);
    expect(await fifth.json()).toMatchObject({ error: 'locked' });
    expect((await loginAs('Rudy', STAFF.manager.pin)).status).toBe(429);
    // El bloqueo es por nombre: otra persona entra normal.
    expect((await loginAs('Sofía', STAFF.barista.pin)).status).toBe(200);
  });

  it('una sesión alterada, vencida por rotar ADMIN_TOKEN o de alguien ya dado de baja no sirve', async () => {
    const token = await session(STAFF.barista);
    const [p, payload = '', sig] = token.split('.');
    const forged = `${p}.${btoa(JSON.stringify({ name: 'Sofía', role: 'manager', exp: '2099-01-01T00:00:00Z' }))}.${sig}`;
    expect((await as(forged, '/api/admin/orders')).status).toBe(401);
    expect(payload).not.toBe('');

    const rotated = testEnv({ ADMIN_TOKEN: 'otro-token-rotado' });
    expect(
      (await call('/api/admin/orders', { headers: { authorization: `Bearer ${token}` } }, rotated)).status,
    ).toBe(401);
    const removed = testEnv({ STAFF_PINS: '[]' });
    expect(
      (await call('/api/admin/orders', { headers: { authorization: `Bearer ${token}` } }, removed)).status,
    ).toBe(401);
  });

  it('la app interna (GitHub Pages) puede llamar al login; otros orígenes no reciben CORS', async () => {
    const ok = await call('/api/staff', { headers: { origin: 'https://cuadrochicocafe.github.io' } });
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://cuadrochicocafe.github.io');
    const other = await call('/api/staff', { headers: { origin: 'https://malo.example' } });
    expect(other.headers.get('access-control-allow-origin')).not.toBe('https://malo.example');
  });
});

describe('permisos por rol', () => {
  it('un barista marca listo y entregado, con su nombre en la bitácora', async () => {
    const code = await createOrder();
    const manager = await session(STAFF.manager);
    await as(manager, `/api/admin/orders/${code}`, { method: 'PATCH', json: { status: 'confirmed' } });
    const barista = await session(STAFF.barista);
    const res = await as(barista, `/api/admin/orders/${code}`, {
      method: 'PATCH',
      json: { status: 'ready' },
    });
    expect(res.status).toBe(200);
    const order = ((await res.json()) as { order: AdminOrder }).order;
    expect(order.events.map((e) => e.detail)).toEqual(
      expect.arrayContaining(['pending_payment → confirmed (Rudy)', 'confirmed → ready (Sofía)']),
    );
    const done = await as(barista, `/api/admin/orders/${code}`, {
      method: 'PATCH',
      json: { status: 'completed', paidCents: order.quote.totalCents },
    });
    expect(done.status).toBe(200);
    expect(((await done.json()) as { order: AdminOrder }).order.paidCents).toBe(order.quote.totalCents);
  });

  it('un barista no puede confirmar, cancelar ni cambiar pagos', async () => {
    const code = await createOrder();
    const barista = await session(STAFF.barista);
    for (const json of [
      { status: 'confirmed' },
      { status: 'cancelled' },
      { paidCents: 100 },
      { status: 'completed', paidCents: 100 },
    ]) {
      const res = await as(barista, `/api/admin/orders/${code}`, { method: 'PATCH', json });
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: 'forbidden' });
    }
  });
});
