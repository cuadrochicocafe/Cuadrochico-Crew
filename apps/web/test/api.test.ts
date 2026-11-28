import type { ApiError } from '@cuadrochico/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, adminApi, api, apiErrorMessage, toApiError } from '../src/api';

const respond = (status: number, body: unknown, json = true) =>
  vi.fn(async () =>
    json
      ? new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
      : new Response(String(body), { status }),
  );

async function errorOf(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiRequestError);
    return toApiError(e);
  }
  throw new Error('se esperaba un error');
}

afterEach(() => vi.unstubAllGlobals());

describe('cliente de la API', () => {
  it('devuelve el JSON en respuestas correctas y arma la URL', async () => {
    const f = respond(200, { days: [] });
    vi.stubGlobal('fetch', f);
    await expect(api.availability(25, 61)).resolves.toEqual({ days: [] });
    expect(f).toHaveBeenCalledWith('/api/availability?drinks=25&days=61', expect.anything());
  });

  it('manda el token del pedido en la query y el de admin como Bearer', async () => {
    const f = respond(200, {});
    vi.stubGlobal('fetch', f);
    await api.cancelOrder('CC-7K3Q', 'a b');
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe('/api/orders/CC-7K3Q/cancel?t=a+b');
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBe('POST');
    await adminApi.orders('secreto', '2026-12-10', '2026-12-20');
    const init = (f.mock.calls[1] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secreto');
  });

  it.each<ApiError>([
    {
      error: 'validation',
      issues: [{ path: 'customer.phone', message: 'escribe un teléfono de 10 dígitos' }],
    },
    { error: 'quote', messages: ['El pedido mínimo es de 6 bebidas; llevas 3.'] },
    {
      error: 'slot',
      problem: 'too_soon',
      message: 'Para tu pedido necesitamos al menos 2 días de anticipación.',
    },
    { error: 'captcha', message: 'No pudimos verificar.' },
    { error: 'not_cancellable', problem: 'deadline_passed', message: 'El plazo para cancelar terminó.' },
    { error: 'not_found' },
    { error: 'unauthorized' },
    { error: 'payment_provider', message: 'Mercado Pago no respondió.' },
    { error: 'internal', message: 'Falló algo.' },
  ])('conserva el error $error del contrato y da un mensaje', async (body) => {
    vi.stubGlobal('fetch', respond(400, body));
    const err = await errorOf(api.order('CC-1', 't'));
    expect(err).toEqual(body);
    const msg = apiErrorMessage(err);
    expect(msg.length).toBeGreaterThan(5);
    if ('message' in body) expect(msg).toBe(body.message);
  });

  it('une los mensajes de validación y de cotización', () => {
    expect(
      apiErrorMessage({
        error: 'validation',
        issues: [
          { path: 'a', message: 'uno' },
          { path: 'b', message: 'dos' },
        ],
      }),
    ).toBe('Revisa estos datos: uno; dos.');
    expect(apiErrorMessage({ error: 'quote', messages: ['A.', 'B.'] })).toBe('A. B.');
  });

  it('un error sin JSON del contrato se vuelve `internal`', async () => {
    vi.stubGlobal('fetch', respond(502, 'Bad gateway', false));
    expect((await errorOf(api.catalog())).error).toBe('internal');
    vi.stubGlobal('fetch', respond(500, { error: 'otra_cosa' }));
    expect((await errorOf(api.catalog())).error).toBe('internal');
  });

  it('una falla de red se vuelve `internal` con mensaje de conexión', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const err = await errorOf(api.catalog());
    expect(err.error).toBe('internal');
    expect(apiErrorMessage(err)).toContain('conexión');
  });
});
