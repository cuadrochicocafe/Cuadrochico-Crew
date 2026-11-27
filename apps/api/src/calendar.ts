/**
 * Google Calendar: un evento por pedido confirmado, en el calendario compartido del equipo.
 * Autenticación con cuenta de servicio (JWT RS256 firmado con WebCrypto). Ver README.md.
 */
import {
  chargeFor,
  formatMXN,
  type PaymentPlan,
  type Quote,
  type Settings,
  zonedToUtc,
} from '@cuadrochico/core';
import type { Env } from './env';
import { base64url, toHex } from './security';

const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/calendar/v3';

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

let cachedToken: { email: string; token: string; expiresAt: number } | null = null;

/** Solo para pruebas. */
export function resetCalendarTokenCache() {
  cachedToken = null;
}

export function calendarEnabled(env: Env): boolean {
  return !!env.GOOGLE_SERVICE_ACCOUNT_JSON && !!env.GOOGLE_CALENDAR_ID;
}

function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

async function signJwt(sa: ServiceAccount, nowSec: number): Promise<string> {
  const enc = new TextEncoder();
  const header = base64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = base64url(
    enc.encode(
      JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: nowSec, exp: nowSec + 3600 }),
    ),
  );
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${header}.${claims}`));
  return `${header}.${claims}.${base64url(sig)}`;
}

async function accessToken(env: Env): Promise<string> {
  const sa = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON ?? '') as ServiceAccount;
  if (!sa.client_email || !sa.private_key) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON incompleto');
  const now = Date.now();
  if (cachedToken && cachedToken.email === sa.client_email && cachedToken.expiresAt > now + 60_000)
    return cachedToken.token;
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: await signJwt(sa, Math.floor(now / 1000)),
    }),
  });
  if (!res.ok) throw new Error(`Google OAuth respondió ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { email: sa.client_email, token: data.access_token, expiresAt: now + data.expires_in * 1000 };
  return data.access_token;
}

/** Id determinista (base32hex: 0-9 a-v) a partir del código: los reintentos no duplican eventos. */
export function eventIdFor(code: string): string {
  return `cc${toHex(new TextEncoder().encode(code.toLowerCase()))}`;
}

export interface CalendarOrder {
  code: string;
  slot: { date: string; time: string };
  customerName: string;
  quote: Quote;
  paymentPlan: PaymentPlan;
  paidCents: number;
  notes: string;
}

export function eventBody(o: CalendarOrder, settings: Settings) {
  const start = zonedToUtc(o.slot.date, o.slot.time, settings.timezone);
  const end = new Date(start.getTime() + settings.slotMinutes * 60_000);
  const firstName = o.customerName.trim().split(/\s+/)[0] ?? '';
  const prep = o.quote.lines.map((l) => {
    const opts = l.options.map((op) => op.label).join(', ');
    return `• ${l.qty} × ${l.name} · ${l.variantLabel}${opts ? ` · ${opts}` : ''}`;
  });
  const { dueNowCents } = chargeFor(o.quote, o.paymentPlan);
  const balance = Math.max(0, o.quote.totalCents - Math.max(o.paidCents, 0));
  const plan =
    o.paymentPlan === 'full'
      ? `Liquidado al pedir (${formatMXN(dueNowCents)})`
      : `Anticipo ${settings.depositPercent} % (${formatMXN(dueNowCents)})`;
  const description = [
    ...prep,
    '',
    o.notes ? `Notas: ${o.notes}` : 'Sin notas',
    '',
    `Pago: ${plan}`,
    `Total: ${formatMXN(o.quote.totalCents)} · Pagado: ${formatMXN(o.paidCents)} · Saldo al recoger: ${formatMXN(balance)}`,
    '',
    `Admin: /admin?pedido=${o.code}`,
  ].join('\n');
  return {
    id: eventIdFor(o.code),
    status: 'confirmed',
    summary: `${o.code} · ${o.quote.drinks} bebidas · ${firstName}`,
    description,
    start: { dateTime: start.toISOString(), timeZone: settings.timezone },
    end: { dateTime: end.toISOString(), timeZone: settings.timezone },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 4320 },
        { method: 'popup', minutes: 2880 },
      ],
    },
  };
}

const eventsUrl = (env: Env) => `${API}/calendars/${encodeURIComponent(env.GOOGLE_CALENDAR_ID ?? '')}/events`;

/** Crea (o actualiza, si ya existía) el evento del pedido. Lanza error si Google falla. */
export async function upsertOrderEvent(env: Env, o: CalendarOrder, settings: Settings): Promise<void> {
  const token = await accessToken(env);
  const body = eventBody(o, settings);
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const res = await fetch(eventsUrl(env), { method: 'POST', headers, body: JSON.stringify(body) });
  if (res.ok) return;
  if (res.status !== 409) throw new Error(`Google Calendar respondió ${res.status}: ${await res.text()}`);
  // Ya existe (reintento o evento cancelado antes): se reemplaza con el mismo id.
  const put = await fetch(`${eventsUrl(env)}/${body.id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
  if (!put.ok) throw new Error(`Google Calendar respondió ${put.status}: ${await put.text()}`);
}

/** Borra el evento del pedido; si ya no existe, no es error. */
export async function deleteOrderEvent(env: Env, code: string): Promise<void> {
  const token = await accessToken(env);
  const res = await fetch(`${eventsUrl(env)}/${eventIdFor(code)}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404 && res.status !== 410)
    throw new Error(`Google Calendar respondió ${res.status}: ${await res.text()}`);
}
