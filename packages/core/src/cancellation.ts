import type { OrderStatus } from './api';
import { zonedToUtc } from './schedule';
import type { Settings } from './schema';

const HOUR_MS = 3600_000;

/** Estados desde los que el cliente puede cancelar (si además está en plazo). */
export const CANCELLABLE_STATUSES: readonly OrderStatus[] = ['pending_payment', 'confirmed'];

/** Aviso que se muestra antes de pagar cuando el pedido se hace con menos anticipación que `cancellationHours`. */
export const NON_REFUNDABLE_NOTICE = 'Este pedido no se puede cancelar ni reembolsar.';

type Slot = { date: string; time: string };

/** Instante UTC de la entrega. */
export function deliveryInstant(slot: Slot, settings: Settings): Date {
  return zonedToUtc(slot.date, slot.time, settings.timezone);
}

/** Último instante en que se puede cancelar: `cancellationHours` antes de la entrega (inclusive). */
export function cancellationDeadline(slot: Slot, settings: Settings): Date {
  return new Date(deliveryInstant(slot, settings).getTime() - settings.cancellationHours * HOUR_MS);
}

/** Un pedido creado en `createdAt` se puede cancelar y reembolsar si se hizo antes del plazo de cancelación. */
export function isRefundableOrder(createdAt: Date, slot: Slot, settings: Settings): boolean {
  return createdAt.getTime() <= cancellationDeadline(slot, settings).getTime();
}

/** El aviso de no cancelable para un pedido que se crearía `now`; `null` si sí se podrá cancelar. */
export function nonRefundableNotice(slot: Slot, now: Date, settings: Settings): string | null {
  return isRefundableOrder(now, slot, settings) ? null : NON_REFUNDABLE_NOTICE;
}

export type CancelProblem = 'invalid_status' | 'not_refundable_order' | 'deadline_passed';

/** Si el pedido se puede cancelar en `now`: `null` si sí, o la razón si no. */
export function cancelProblem(
  order: { createdAt: Date; slot: Slot; status: OrderStatus },
  now: Date,
  settings: Settings,
): CancelProblem | null {
  if (!CANCELLABLE_STATUSES.includes(order.status)) return 'invalid_status';
  if (!isRefundableOrder(order.createdAt, order.slot, settings)) return 'not_refundable_order';
  if (now.getTime() > cancellationDeadline(order.slot, settings).getTime()) return 'deadline_passed';
  return null;
}

/**
 * Monto a devolver al cancelar a tiempo: todo lo pagado, con cualquier método.
 * La transferencia la devuelve el equipo a mano; Mercado Pago la devuelve sola por su API.
 */
export function refundFor(p: { paidCents: number }): number {
  return p.paidCents;
}

/** Texto único de la política: se muestra igual antes de pagar y en la página del pedido. */
export function cancellationPolicyText(settings: Settings): string {
  const h = settings.cancellationHours;
  return [
    `Puedes cancelar tu pedido hasta ${h} horas antes de la hora de entrega, desde la página de tu pedido.`,
    'Si cancelas a tiempo, te devolvemos todo lo que pagaste: los pagos con Mercado Pago se reembolsan automáticamente al mismo medio de pago y las transferencias te las devolvemos por transferencia.',
    `Los pedidos hechos con menos de ${h} horas de anticipación no se pueden cancelar ni reembolsar.`,
  ].join(' ');
}

export function cancelProblemMessage(p: CancelProblem, settings: Settings): string {
  switch (p) {
    case 'invalid_status':
      return 'Este pedido ya no se puede cancelar por su estado actual.';
    case 'not_refundable_order':
      return NON_REFUNDABLE_NOTICE;
    case 'deadline_passed':
      return `El plazo para cancelar terminó ${settings.cancellationHours} horas antes de la entrega.`;
  }
}
