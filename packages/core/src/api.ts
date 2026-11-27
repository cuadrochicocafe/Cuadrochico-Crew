/**
 * Contrato HTTP entre `apps/web` y `apps/api`. Cualquier cambio aquí es un cambio de API:
 * actualiza ambos lados en el mismo commit.
 */
import type { Quote } from './pricing';
import type { DayAvailability, SlotProblem } from './schedule';
import type { Menu, OrderInputRaw, PaymentMethod, Settings } from './schema';

export type OrderStatus =
  /** Creado, esperando anticipo. Aparta capacidad hasta `expiresAt`. */
  | 'pending_payment'
  /** Anticipo recibido: entra a producción. */
  | 'confirmed'
  /** Preparado, listo para entregar. */
  | 'ready'
  /** Entregado y liquidado. */
  | 'completed'
  | 'cancelled'
  /** No se pagó a tiempo; liberó su capacidad. */
  | 'expired';

/** Estados que ocupan capacidad de producción. */
export const ACTIVE_STATUSES: readonly OrderStatus[] = ['pending_payment', 'confirmed', 'ready'];

/** Configuración visible para el cliente: sin datos bancarios (se dan solo al crear un pedido). */
export type PublicSettings = Omit<Settings, 'payments'> & {
  payments: { transfer: { enabled: boolean }; mercadopago: { enabled: boolean } };
};

export function toPublicSettings(s: Settings): PublicSettings {
  return {
    ...s,
    payments: {
      transfer: { enabled: s.payments.transfer.enabled },
      mercadopago: { enabled: s.payments.mercadopago.enabled },
    },
  };
}

// GET /api/catalog
export interface CatalogResponse {
  menu: Menu;
  settings: PublicSettings;
}

// GET /api/availability?from=YYYY-MM-DD&days=14&drinks=12
export interface AvailabilityResponse {
  days: DayAvailability[];
}

// POST /api/orders  (cuerpo: OrderInputRaw)
export type CreateOrderRequest = OrderInputRaw;

export type PaymentInstructions =
  | {
      method: 'transfer';
      amountCents: number;
      bank: string;
      beneficiary: string;
      clabe: string;
      /** Concepto que el cliente debe poner en la transferencia (el código del pedido). */
      reference: string;
    }
  | { method: 'mercadopago'; amountCents: number; checkoutUrl: string };

export interface PublicOrder {
  code: string;
  status: OrderStatus;
  createdAt: string;
  /** Hasta cuándo se aparta el lugar si no se paga; null si ya no aplica. */
  expiresAt: string | null;
  slot: { date: string; time: string };
  fulfillment: { type: 'pickup' } | { type: 'delivery'; address: string; references: string };
  customerName: string;
  paymentMethod: PaymentMethod;
  quote: Quote;
  paidCents: number;
  notes: string;
}

export interface CreateOrderResponse {
  order: PublicOrder;
  /** Token secreto para consultar el pedido sin cuenta: /pedido/:code?t=token */
  accessToken: string;
  payment: PaymentInstructions;
}

// GET /api/orders/:code?t=token
export interface OrderResponse {
  order: PublicOrder;
  payment: PaymentInstructions | null;
}

// Errores: todos los endpoints responden { error } con estos códigos.
export type ApiError =
  | { error: 'validation'; issues: { path: string; message: string }[] }
  | { error: 'quote'; messages: string[] }
  | { error: 'slot'; problem: SlotProblem; message: string }
  | { error: 'captcha'; message: string }
  | { error: 'not_found' }
  | { error: 'unauthorized' }
  | { error: 'payment_provider'; message: string }
  | { error: 'internal'; message: string };

// ---------- Administración (Authorization: Bearer <ADMIN_TOKEN>)

export interface AdminOrder extends PublicOrder {
  customerPhone: string;
  customerEmail: string;
  updatedAt: string;
  events: { at: string; type: string; detail: string }[];
}

// GET /api/admin/orders?from=YYYY-MM-DD&to=YYYY-MM-DD&status=confirmed
export interface AdminOrdersResponse {
  orders: AdminOrder[];
}

// PATCH /api/admin/orders/:code
export interface AdminUpdateOrderRequest {
  status?: OrderStatus;
  /** Monto total recibido hasta ahora (p. ej. al confirmar una transferencia). */
  paidCents?: number;
  note?: string;
}

// GET /api/admin/prep?date=YYYY-MM-DD — qué preparar ese día, agregado por bebida y opciones.
export interface PrepResponse {
  date: string;
  totals: { name: string; variantLabel: string; options: string; qty: number }[];
  orders: { code: string; time: string; customerName: string; status: OrderStatus; drinks: number }[];
}
