import { hmacSha256Hex, safeEqual } from './security';

const API = 'https://api.mercadopago.com';

export interface PreferenceInput {
  code: string;
  title: string;
  amountCents: number;
  /** Página del pedido a la que vuelve el cliente. */
  backUrl: string;
  notificationUrl: string;
  expiresAt: string;
}

/** Crea una preferencia de Checkout Pro y devuelve la URL de pago. */
export async function createPreference(accessToken: string, p: PreferenceInput): Promise<string> {
  const res = await fetch(`${API}/checkout/preferences`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      'x-idempotency-key': p.code,
    },
    body: JSON.stringify({
      items: [
        { id: p.code, title: p.title, quantity: 1, currency_id: 'MXN', unit_price: p.amountCents / 100 },
      ],
      external_reference: p.code,
      notification_url: p.notificationUrl,
      back_urls: { success: p.backUrl, pending: p.backUrl, failure: p.backUrl },
      auto_return: 'approved',
      expires: true,
      expiration_date_to: p.expiresAt,
    }),
  });
  if (!res.ok) throw new Error(`Mercado Pago respondió ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { init_point?: string };
  if (!data.init_point) throw new Error('Mercado Pago no devolvió init_point');
  return data.init_point;
}

export interface Payment {
  id: number | string;
  status: string;
  external_reference: string | null;
  transaction_amount: number;
  fee_details?: { type?: string; amount: number }[];
}

export async function getPayment(accessToken: string, id: string): Promise<Payment> {
  const res = await fetch(`${API}/v1/payments/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Mercado Pago respondió ${res.status} al consultar el pago ${id}`);
  return (await res.json()) as Payment;
}

/**
 * Reembolso total del pago (sin `amount`, Mercado Pago devuelve todo).
 * `idempotencyKey` evita reembolsar dos veces si se reintenta.
 */
export async function refundPayment(accessToken: string, id: string, idempotencyKey: string): Promise<void> {
  const res = await fetch(`${API}/v1/payments/${encodeURIComponent(id)}/refunds`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      'x-idempotency-key': idempotencyKey,
    },
    body: '{}',
  });
  if (!res.ok) throw new Error(`Mercado Pago respondió ${res.status}: ${await res.text()}`);
}

export const toCents = (amount: number) => Math.round(amount * 100);

/** Comisión real cobrada por Mercado Pago, en centavos (suma de `fee_details`). */
export function feeCents(p: Payment): number {
  return (p.fee_details ?? []).reduce((s, f) => s + toCents(f.amount), 0);
}

/**
 * Valida `x-signature` (`ts=...,v1=...`): HMAC-SHA256 del manifiesto
 * `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`. Las partes que falten se omiten del manifiesto.
 */
export async function verifySignature(
  secret: string,
  signature: string | null | undefined,
  requestId: string | null | undefined,
  dataId: string | null | undefined,
): Promise<boolean> {
  if (!signature) return false;
  const parts = Object.fromEntries(
    signature.split(',').map((kv) => {
      const [k, ...v] = kv.split('=');
      return [k?.trim() ?? '', v.join('=').trim()];
    }),
  );
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;
  // Los ids alfanuméricos llegan en mayúsculas en la URL pero se firman en minúsculas.
  const id = dataId ? (/^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId) : '';
  let manifest = '';
  if (id) manifest += `id:${id};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${ts};`;
  return safeEqual(await hmacSha256Hex(secret, manifest), v1.toLowerCase());
}
