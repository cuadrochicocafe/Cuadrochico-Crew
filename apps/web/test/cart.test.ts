import { leadTimeMessage, defaultMenu as menu, defaultSettings as settings } from '@cuadrochico/core';
import { describe, expect, it } from 'vitest';
import {
  addLine,
  cartProgress,
  checkoutIssues,
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

describe('barra del carrito', () => {
  it('cuenta lo que falta para el mínimo', () => {
    expect(cartProgress(4, settings)).toEqual({
      label: 'Te faltan 2 bebidas para el mínimo de 6',
      ratio: 4 / 6,
    });
    expect(cartProgress(5, settings).label).toBe('Te falta 1 bebida para el mínimo de 6');
  });

  it('informa el siguiente descuento y el que ya tienes', () => {
    expect(cartProgress(6, settings).label).toBe('5 % de descuento · agrega 6 y obtén 10 %');
    expect(cartProgress(23, settings).label).toBe('10 % de descuento · agrega 1 y obtén 15 %');
    expect(cartProgress(30, settings)).toEqual({ label: 'Tienes el 15 % de descuento', ratio: 1 });
  });
});

describe('qué falta para pagar', () => {
  const slot = { date: '2026-12-10', time: '10:00' };
  const ok = { slot, customerErrors: {}, plan: 'deposit' as const, method: 'transfer' };

  it('lista lo pendiente en el orden de la página', () => {
    expect(
      checkoutIssues({ slot: null, customerErrors: { phone: 'x', name: 'y' }, plan: null, method: null }),
    ).toEqual(['slot', 'name', 'phone', 'plan', 'method']);
  });

  it('nunca deja pagar sin elegir plan', () => {
    expect(checkoutIssues({ ...ok, plan: null })).toEqual(['plan']);
    expect(checkoutIssues(ok)).toEqual([]);
  });
});
