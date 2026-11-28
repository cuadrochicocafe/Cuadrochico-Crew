import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import {
  addDays,
  type CreateOrderRequest,
  defaultSettings,
  localDate,
  slotsFor,
  zonedToUtc,
} from '@cuadrochico/core';
import { vi } from 'vitest';
import { resetCalendarTokenCache } from '../src/calendar';
import type { Env } from '../src/env';
import worker from '../src/index';
import { hmacSha256Hex } from '../src/security';

export const ADMIN_TOKEN = 'admin-token-de-prueba-123';
export const MP_WEBHOOK_SECRET = 'mp-webhook-secret';

const HOUR = 3600_000;

/** Primer horario de entrega cuyo instante cae entre `minH` y `maxH` horas a partir de ahora. */
export function slotBetween(minH: number, maxH: number): { date: string; time: string } {
  const s = defaultSettings;
  const now = Date.now();
  let d = localDate(new Date(now + minH * HOUR), s.timezone);
  for (let i = 0; i < 30; i++, d = addDays(d, 1))
    for (const time of slotsFor(d, s)) {
      const t = zonedToUtc(d, time, s.timezone).getTime();
      if (t >= now + minH * HOUR && t <= now + maxH * HOUR) return { date: d, time };
    }
  throw new Error(`sin horario entre ${minH} y ${maxH} h`);
}

export function orderInput(over: Partial<CreateOrderRequest> = {}): CreateOrderRequest {
  return {
    customer: { name: 'Ana López', phone: '81 1234 5678', email: '' },
    fulfillment: { type: 'pickup' },
    slot: slotBetween(240, 320),
    lines: [
      {
        itemId: 'cold-brew-latte',
        variantId: 'regular',
        options: { leche: 'avena', jarabe: 'vainilla' },
        qty: 6,
      },
      { itemId: 'matcha-latte', variantId: 'regular', qty: 6 },
    ],
    paymentMethod: 'transfer',
    paymentPlan: 'deposit',
    notes: 'Sin popote',
    ...over,
  };
}

// ---------- Llaves y secretos de prueba

async function serviceAccount() {
  const keys = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const der = new Uint8Array((await crypto.subtle.exportKey('pkcs8', keys.privateKey)) as ArrayBuffer);
  let bin = '';
  for (const b of der) bin += String.fromCharCode(b);
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(bin).replace(/(.{64})/g, '$1\n')}\n-----END PRIVATE KEY-----\n`;
  return {
    publicKey: keys.publicKey,
    json: JSON.stringify({ client_email: 'pedidos@prueba.iam.gserviceaccount.com', private_key: pem }),
  };
}

const sa = await serviceAccount();

/** PINs de prueba (pocas iteraciones para que las pruebas sean rápidas). */
export const STAFF = { manager: { name: 'Rudy', pin: '1234' }, barista: { name: 'Sofía', pin: '5678' } };

async function staffEntry(n: string, r: string, pin: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 1000 },
    key,
    256,
  );
  const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
  return { n, r, s: b64(salt), h: b64(new Uint8Array(bits)), i: 1000 };
}

const staffPins = JSON.stringify([
  await staffEntry(STAFF.manager.name, 'Gerente', STAFF.manager.pin),
  await staffEntry(STAFF.barista.name, 'Barista', STAFF.barista.pin),
]);

export function testEnv(over: Partial<Env> = {}): Env {
  return {
    ...env,
    ADMIN_TOKEN,
    STAFF_PINS: staffPins,
    MP_ACCESS_TOKEN: 'TEST-mp-token',
    MP_WEBHOOK_SECRET,
    TRANSFER_BANK: 'Banco Prueba',
    TRANSFER_BENEFICIARY: 'Cuadrochico SA',
    TRANSFER_CLABE: '012345678901234567',
    TELEGRAM_BOT_TOKEN: 'bot-token',
    TELEGRAM_CHAT_ID: '-100',
    GOOGLE_SERVICE_ACCOUNT_JSON: sa.json,
    GOOGLE_CALENDAR_ID: 'equipo@group.calendar.google.com',
    ...over,
  };
}

// ---------- fetch simulado: Mercado Pago, Telegram, Google y Turnstile

export interface MpPayment {
  id: number;
  status: string;
  external_reference: string;
  transaction_amount: number;
  fee_details: { type: string; amount: number }[];
}

export interface Outbound {
  preferences: Record<string, unknown>[];
  telegram: string[];
  calendar: { method: string; url: string; body: Record<string, unknown> | null }[];
  tokenRequests: number;
  payments: Map<string, MpPayment>;
  refunds: { paymentId: string; idempotencyKey: string | null }[];
  refundStatus: number;
  calendarStatus: number;
  captchaOk: boolean;
}

function b64urlDecode(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function mockOutbound(): Outbound {
  resetCalendarTokenCache();
  const out: Outbound = {
    preferences: [],
    telegram: [],
    calendar: [],
    tokenRequests: 0,
    payments: new Map(),
    refunds: [],
    refundStatus: 201,
    calendarStatus: 200,
    captchaOk: true,
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const req = new Request(input as RequestInfo, init as RequestInit);
    const url = new URL(req.url);
    const form = url.host === 'oauth2.googleapis.com' || url.host === 'challenges.cloudflare.com';
    const text = req.method === 'GET' || req.method === 'DELETE' || form ? '' : await req.text();
    if (url.host === 'api.mercadopago.com' && url.pathname === '/checkout/preferences') {
      const body = JSON.parse(text) as Record<string, unknown>;
      out.preferences.push(body);
      return json({ id: 'pref-1', init_point: `https://mp.test/checkout/${body.external_reference}` }, 201);
    }
    const refund = url.pathname.match(/^\/v1\/payments\/([^/]+)\/refunds$/);
    if (url.host === 'api.mercadopago.com' && refund && req.method === 'POST') {
      out.refunds.push({ paymentId: refund[1] ?? '', idempotencyKey: req.headers.get('x-idempotency-key') });
      return out.refundStatus === 201
        ? json({ id: 1, status: 'approved' }, 201)
        : json({ message: 'insufficient_amount' }, out.refundStatus);
    }
    if (url.host === 'api.mercadopago.com' && url.pathname.startsWith('/v1/payments/')) {
      const p = out.payments.get(url.pathname.split('/').pop() ?? '');
      return p ? json(p) : json({ message: 'not found' }, 404);
    }
    if (url.host === 'api.telegram.org') {
      out.telegram.push((JSON.parse(text) as { text: string }).text);
      return json({ ok: true });
    }
    if (url.host === 'oauth2.googleapis.com') {
      out.tokenRequests++;
      const assertion = String((await req.formData()).get('assertion') ?? '');
      const [h, c, s] = assertion.split('.');
      const ok = await crypto.subtle.verify(
        'RSASSA-PKCS1-v1_5',
        sa.publicKey,
        b64urlDecode(s ?? ''),
        new TextEncoder().encode(`${h}.${c}`),
      );
      const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(c ?? ''))) as { scope: string };
      if (!ok || claims.scope !== 'https://www.googleapis.com/auth/calendar.events')
        return json({ error: 'invalid_grant' }, 400);
      return json({ access_token: 'google-access-token', expires_in: 3600 });
    }
    if (url.host === 'www.googleapis.com') {
      out.calendar.push({
        method: req.method,
        url: req.url,
        body: text ? (JSON.parse(text) as Record<string, unknown>) : null,
      });
      if (req.headers.get('authorization') !== 'Bearer google-access-token') return json({}, 401);
      return out.calendarStatus === 204 ? new Response(null, { status: 204 }) : json({}, out.calendarStatus);
    }
    if (url.host === 'challenges.cloudflare.com') return json({ success: out.captchaOk });
    throw new Error(`fetch no simulado: ${req.method} ${req.url}`);
  });
  return out;
}

// ---------- Llamadas al Worker

export async function call(
  path: string,
  init: RequestInit & { json?: unknown } = {},
  e: Env = testEnv(),
): Promise<Response> {
  const headers = new Headers(init.headers);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(init.json);
  }
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request(`https://pedidos.test${path}`, { ...init, headers, body }) as Request<
      unknown,
      IncomingRequestCfProperties
    >,
    e,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

export const admin = (path: string, init: RequestInit & { json?: unknown } = {}, e?: Env) =>
  call(path, { ...init, headers: { authorization: `Bearer ${ADMIN_TOKEN}`, ...init.headers } }, e);

export async function signedWebhook(paymentId: string, secret = MP_WEBHOOK_SECRET, e?: Env) {
  const ts = String(Date.now());
  const requestId = crypto.randomUUID();
  const v1 = await hmacSha256Hex(secret, `id:${paymentId};request-id:${requestId};ts:${ts};`);
  return call(
    `/api/webhooks/mercadopago?data.id=${paymentId}&type=payment`,
    {
      method: 'POST',
      headers: { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId },
      json: { type: 'payment', action: 'payment.created', data: { id: paymentId } },
    },
    e,
  );
}

export async function runCron(e: Env = testEnv()) {
  const ctx = createExecutionContext();
  await worker.scheduled({ scheduledTime: Date.now(), cron: '*/15 * * * *', noRetry() {} }, e, ctx);
  await waitOnExecutionContext(ctx);
}
