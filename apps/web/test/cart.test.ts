import { leadTimeMessage, defaultMenu as menu, defaultSettings as settings } from '@cuadrochico/core';
import { describe, expect, it } from 'vitest';
import {
  addLine,
  canEnter,
  type FlowProgress,
  furthestStep,
  leadTimeChangeNotice,
  nextTierHint,
  quoteCart,
  setQty,
} from '../src/order/cart';

const matcha = (qty: number, jarabe = 'sin-jarabe') => ({
  itemId: 'matcha-latte',
  variantId: 'regular',
  options: { leche: 'avena', jarabe },
  qty,
});

describe('carrito', () => {
  it('junta líneas con la misma configuración y separa las distintas', () => {
    let cart = addLine([], matcha(3));
    cart = addLine(cart, matcha(2));
    expect(cart).toHaveLength(1);
    expect(cart[0]?.qty).toBe(5);
    cart = addLine(cart, matcha(1, 'vainilla'));
    expect(cart).toHaveLength(2);
  });

  it('cambia cantidades y quita la línea al llegar a 0', () => {
    const cart = addLine([], matcha(3));
    const key = cart[0]?.key ?? '';
    expect(setQty(cart, key, 7)[0]?.qty).toBe(7);
    expect(setQty(cart, key, 0)).toHaveLength(0);
  });

  it('cotiza con quote() de core: descuento por nivel y anticipo', () => {
    const r = quoteCart(addLine([], matcha(12)), menu, settings);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.quote.subtotalCents).toBe(12 * 8500);
    expect(r.quote.discountPercent).toBe(10);
    expect(r.quote.totalCents).toBe(12 * 8500 - 10200);
    expect(r.quote.depositCents).toBe(r.quote.totalCents / 2);
  });

  it('explica el mínimo en español y no da total', () => {
    const r = quoteCart(addLine([], matcha(3)), menu, settings);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.messages[0]).toContain('mínimo es de 6 bebidas');
  });

  it('el siguiente nivel es solo un dato informativo', () => {
    const r = quoteCart(addLine([], matcha(10)), menu, settings);
    if (!r.ok) throw new Error('quote');
    expect(nextTierHint(r.quote)).toBe('Si agregas 2 bebidas, tu descuento sube a 10 %.');
  });
});

describe('anticipación según tamaño (24 → 25 bebidas)', () => {
  it('el mensaje cambia al pasar de 24 a 25', () => {
    expect(leadTimeMessage(24, settings)).not.toBe(leadTimeMessage(25, settings));
    expect(leadTimeMessage(25, settings)).toContain('7 días');
  });

  it('avisa que cambiaron las fechas al subir y al bajar de nivel', () => {
    const up = leadTimeChangeNotice(24, 25, settings);
    expect(up).toContain('cambiaron las fechas disponibles');
    expect(up).toContain('más anticipación');
    expect(up).toContain(leadTimeMessage(25, settings));
    const down = leadTimeChangeNotice(25, 24, settings);
    expect(down).toContain('menos anticipación');
    expect(down).toContain(leadTimeMessage(24, settings));
  });

  it('no avisa si el nivel no cambia o si es la primera carga', () => {
    expect(leadTimeChangeNotice(12, 24, settings)).toBeNull();
    expect(leadTimeChangeNotice(30, 25, settings)).toBeNull();
    expect(leadTimeChangeNotice(null, 25, settings)).toBeNull();
  });
});

describe('orden de los pasos', () => {
  const none: FlowProgress = { quoteOk: false, slot: null, customerValid: false, plan: null };
  const slot = { date: '2026-12-10', time: '10:00' };

  it('no pide datos antes de tener total y horario', () => {
    expect(canEnter('date', none)).toBe(false);
    expect(canEnter('data', { ...none, quoteOk: true })).toBe(false);
    expect(canEnter('data', { ...none, slot, customerValid: true })).toBe(false);
    expect(canEnter('data', { ...none, quoteOk: true, slot })).toBe(true);
  });

  it('no deja pasar al pago sin elegir plan', () => {
    const ready = { quoteOk: true, slot, customerValid: true, plan: null };
    expect(canEnter('review', ready)).toBe(true);
    expect(canEnter('payment', ready)).toBe(false);
    expect(canEnter('payment', { ...ready, plan: 'deposit' })).toBe(true);
    expect(furthestStep(ready)).toBe('review');
  });

  it('si el carrito deja de ser válido regresa al primer paso', () => {
    expect(furthestStep({ quoteOk: false, slot, customerValid: true, plan: 'full' })).toBe('build');
  });
});
