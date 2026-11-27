import { describe, expect, it } from 'vitest';
import {
  cancellationDeadline,
  cancellationPolicyText,
  cancelProblem,
  defaultSettings,
  isRefundableOrder,
  NON_REFUNDABLE_NOTICE,
  nonRefundableNotice,
  refundFor,
  type Settings,
} from '../src';

const settings: Settings = structuredClone(defaultSettings);
// Entrega: sábado 5 de diciembre de 2026, 12:00 en Monterrey = 18:00 UTC.
const slot = { date: '2026-12-05', time: '12:00' };
const delivery = Date.parse('2026-12-05T18:00:00Z');
const hoursBefore = (h: number) => new Date(delivery - h * 3600_000);

describe('plazo de cancelación (72 h)', () => {
  it('el plazo termina 72 h antes de la entrega', () => {
    expect(cancellationDeadline(slot, settings).toISOString()).toBe('2026-12-02T18:00:00.000Z');
  });

  it('pedido creado a 73 h es reembolsable; a 71 h no', () => {
    expect(isRefundableOrder(hoursBefore(73), slot, settings)).toBe(true);
    expect(isRefundableOrder(hoursBefore(72), slot, settings)).toBe(true);
    expect(isRefundableOrder(hoursBefore(71), slot, settings)).toBe(false);
  });

  it('antes de pagar se avisa solo si el pedido ya no se podrá cancelar', () => {
    expect(nonRefundableNotice(slot, hoursBefore(73), settings)).toBeNull();
    expect(nonRefundableNotice(slot, hoursBefore(71), settings)).toBe(
      'Este pedido no se puede cancelar ni reembolsar.',
    );
  });
});

describe('cancelProblem', () => {
  const order = { createdAt: hoursBefore(100), slot, status: 'confirmed' as const };

  it('un pedido cancelado a 73 h de la entrega sí se puede cancelar', () => {
    expect(cancelProblem(order, hoursBefore(73), settings)).toBeNull();
    expect(cancelProblem({ ...order, status: 'pending_payment' }, hoursBefore(73), settings)).toBeNull();
  });

  it('a 71 h de la entrega ya pasó el plazo', () => {
    expect(cancelProblem(order, hoursBefore(71), settings)).toBe('deadline_passed');
  });

  it('un pedido creado a 71 h no se puede cancelar nunca', () => {
    expect(cancelProblem({ ...order, createdAt: hoursBefore(71) }, hoursBefore(70), settings)).toBe(
      'not_refundable_order',
    );
  });

  it('pedidos listos, entregados o ya cancelados no se cancelan', () => {
    for (const status of ['ready', 'completed', 'cancelled', 'expired'] as const)
      expect(cancelProblem({ ...order, status }, hoursBefore(80), settings)).toBe('invalid_status');
  });
});

describe('refundFor', () => {
  it('la transferencia se devuelve completa', () => {
    expect(refundFor({ paidCents: 21400, paymentMethod: 'transfer', providerFeeCents: 0 })).toBe(21400);
    expect(refundFor({ paidCents: 21400, paymentMethod: 'transfer', providerFeeCents: 999 })).toBe(21400);
  });

  it('Mercado Pago se devuelve menos su comisión real', () => {
    expect(refundFor({ paidCents: 42700, paymentMethod: 'mercadopago', providerFeeCents: 2193 })).toBe(40507);
    expect(refundFor({ paidCents: 100, paymentMethod: 'mercadopago', providerFeeCents: 500 })).toBe(0);
  });
});

describe('cancellationPolicyText', () => {
  it('describe plazo, reembolso por método y pedidos no reembolsables en un solo texto', () => {
    const text = cancellationPolicyText(settings);
    expect(text).toContain('hasta 72 horas antes');
    expect(text).toContain('transferencias se devuelven completas');
    expect(text).toContain('menos la comisión que cobra Mercado Pago');
    expect(text).toContain('menos de 72 horas de anticipación no se pueden cancelar ni reembolsar');
    expect(NON_REFUNDABLE_NOTICE).toBe('Este pedido no se puede cancelar ni reembolsar.');
  });
});
