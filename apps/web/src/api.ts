/** Cliente HTTP de la API. Solo usa los tipos del contrato en `@cuadrochico/core` (`api.ts`). */
import type {
  AdminOrdersResponse,
  AdminUpdateOrderRequest,
  ApiError,
  AvailabilityResponse,
  CatalogResponse,
  CreateOrderRequest,
  CreateOrderResponse,
  OrderResponse,
  PrepResponse,
} from '@cuadrochico/core';

const ERROR_CODES: readonly ApiError['error'][] = [
  'validation',
  'quote',
  'slot',
  'captcha',
  'not_cancellable',
  'not_found',
  'unauthorized',
  'payment_provider',
  'internal',
];

/** Error de la API con el cuerpo `{ error }` del contrato. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError,
  ) {
    super(body.error);
  }
}

function isApiError(v: unknown): v is ApiError {
  return (
    typeof v === 'object' &&
    v !== null &&
    'error' in v &&
    ERROR_CODES.includes((v as { error: unknown }).error as ApiError['error'])
  );
}

const NETWORK_MESSAGE = 'No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.';

/** Convierte cualquier falla (red, JSON raro, error del contrato) en un `ApiError`. */
export function toApiError(e: unknown): ApiError {
  if (e instanceof ApiRequestError) return e.body;
  return { error: 'internal', message: NETWORK_MESSAGE };
}

/** Mensaje en español para mostrar al usuario. */
export function apiErrorMessage(e: ApiError): string {
  switch (e.error) {
    case 'validation':
      return e.issues.length
        ? `Revisa estos datos: ${e.issues.map((i) => i.message).join('; ')}.`
        : 'Revisa los datos del pedido.';
    case 'quote':
      return e.messages.join(' ');
    case 'slot':
    case 'captcha':
    case 'not_cancellable':
    case 'payment_provider':
    case 'internal':
      return e.message;
    case 'not_found':
      return 'No encontramos ese pedido. Revisa que el enlace esté completo.';
    case 'unauthorized':
      return 'No tienes acceso. Revisa el enlace o el token.';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
    });
  } catch {
    throw new ApiRequestError(0, { error: 'internal', message: NETWORK_MESSAGE });
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Respuesta sin JSON (p. ej. un 502 del proxy): se trata abajo.
  }
  if (!res.ok) {
    throw new ApiRequestError(
      res.status,
      isApiError(body) ? body : { error: 'internal', message: 'Algo falló de nuestro lado. Inténtalo de nuevo en un momento.' },
    );
  }
  return body as T;
}

const q = (params: Record<string, string | number | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : '';
};

const enc = encodeURIComponent;

export const api = {
  catalog: () => request<CatalogResponse>('/api/catalog'),
  availability: (drinks: number) => request<AvailabilityResponse>(`/api/availability${q({ drinks })}`),
  createOrder: (body: CreateOrderRequest) =>
    request<CreateOrderResponse>('/api/orders', { method: 'POST', body: JSON.stringify(body) }),
  order: (code: string, token: string) => request<OrderResponse>(`/api/orders/${enc(code)}${q({ t: token })}`),
  cancelOrder: (code: string, token: string) =>
    request<OrderResponse>(`/api/orders/${enc(code)}/cancel${q({ t: token })}`, { method: 'POST' }),
};

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export const adminApi = {
  orders: (token: string, from: string, to: string) =>
    request<AdminOrdersResponse>(`/api/admin/orders${q({ from, to })}`, { headers: bearer(token) }),
  update: (token: string, code: string, body: AdminUpdateOrderRequest) =>
    request<unknown>(`/api/admin/orders/${enc(code)}`, {
      method: 'PATCH',
      headers: bearer(token),
      body: JSON.stringify(body),
    }),
  prep: (token: string, date: string) =>
    request<PrepResponse>(`/api/admin/prep${q({ date })}`, { headers: bearer(token) }),
};
