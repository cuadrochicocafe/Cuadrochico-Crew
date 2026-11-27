import { describe, expect, it } from 'vitest';
import {
  defaultSettings,
  discountFor,
  formatMXN,
  defaultMenu as menu,
  nextTierFor,
  type OrderLineInput,
  quote,
  type Settings,
} from '../src';

const settings: Settings = structuredClone(defaultSettings);
const ctx = { menu, settings, fulfillment: 'pickup' as const };
const line = (
  itemId: string,
  qty: number,
  variantId = 'regular',
  options: Record<string, string> = {},
): OrderLineInput => ({
  itemId,
  variantId,
  qty,
  options,
});

describe('discountFor', () => {
  const tiers = settings.discountTiers;
  it.each([
    [5, 0],
    [6, 5],
    [11, 5],
    [12, 10],
    [23, 10],
    [24, 15],
    [200, 15],
  ])('%i bebidas → %i %%', (drinks, pct) => expect(discountFor(drinks, tiers)).toBe(pct));
});

describe('nextTierFor', () => {
  it('indica cuántas faltan para el siguiente nivel', () => {
    expect(nextTierFor(8, settings.discountTiers)).toEqual({ drinksNeeded: 4, percent: 10 });
    expect(nextTierFor(30, settings.discountTiers)).toBeNull();
  });
});

describe('quote', () => {
  it('cotiza 6 cold brew negros con 5 % y anticipo del 50 %', () => {
    const r = quote([line('cold-brew', 6, 'negro')], ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const q = r.value;
    expect(q.drinks).toBe(6);
    expect(q.subtotalCents).toBe(6 * 7500); // $450
    expect(q.discountPercent).toBe(5);
    expect(q.discountCents).toBe(2300); // 5 % de $450 = $22.50 → $23
    expect(q.totalCents).toBe(42700);
    expect(q.depositCents).toBe(21400); // mitad redondeada hacia arriba al peso
    expect(q.balanceCents).toBe(q.totalCents - q.depositCents);
  });

  it('suma jarabe (+$5) y usa la leche por defecto si no se eligió', () => {
    const r = quote([line('matcha-latte', 12, 'regular', { jarabe: 'vainilla' })], ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const l = r.value.lines[0];
    expect(l?.unitPriceCents).toBe(8500 + 500);
    expect(l?.options.map((o) => o.optionId)).toEqual(['entera', 'vainilla']);
    expect(r.value.discountPercent).toBe(10);
  });

  it('el cold brew latte acepta leche; el negro no', () => {
    expect(quote([line('cold-brew', 6, 'latte', { leche: 'avena' })], ctx).ok).toBe(true);
    const r = quote([line('cold-brew', 6, 'negro', { leche: 'avena' })], ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatchObject({ code: 'unexpected_option', groupId: 'leche' });
  });

  it('el descuento se calcula sobre el total de bebidas de todas las líneas', () => {
    const r = quote([line('chai-latte', 7), line('cold-brew-tonic', 6)], ctx);
    expect(r.ok && r.value.discountPercent).toBe(10);
  });

  it('rechaza pedidos bajo el mínimo', () => {
    const r = quote([line('chai-latte', 5)], ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContainEqual({ code: 'below_minimum', drinks: 5, minimum: 6 });
  });

  it('rechaza bebidas, variantes y opciones que no existen', () => {
    const r = quote(
      [
        line('espresso', 6),
        line('chai-latte', 6, 'grande'),
        line('chai-latte', 6, 'regular', { leche: 'coco' }),
      ],
      ctx,
    );
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.errors.map((e) => e.code)).toEqual(['unknown_item', 'unknown_variant', 'invalid_option']);
  });

  it('respeta las fechas de temporada', () => {
    const m = structuredClone(menu);
    const chai = m.items.find((i) => i.id === 'chai-latte');
    if (chai) Object.assign(chai, { availableFrom: '2026-12-01', availableUntil: '2026-12-31' });
    expect(quote([line('chai-latte', 6)], { ...ctx, menu: m, date: '2026-11-30' }).ok).toBe(false);
    expect(quote([line('chai-latte', 6)], { ...ctx, menu: m, date: '2026-12-15' }).ok).toBe(true);
  });

  it('el envío a domicilio respeta si está activo, su mínimo y su costo', () => {
    expect(quote([line('chai-latte', 12)], { ...ctx, fulfillment: 'delivery' }).ok).toBe(false);
    const s = structuredClone(settings);
    s.fulfillment.delivery = { ...s.fulfillment.delivery, enabled: true, feeCents: 8000, minDrinks: 12 };
    expect(quote([line('chai-latte', 6)], { ...ctx, settings: s, fulfillment: 'delivery' }).ok).toBe(false);
    const r = quote([line('chai-latte', 12)], { ...ctx, settings: s, fulfillment: 'delivery' });
    expect(r.ok && r.value.totalCents).toBe(12 * 8000 - 9600 + 8000);
  });
});

describe('formatMXN', () => {
  it('omite centavos cuando son cero', () => {
    expect(formatMXN(42700)).toBe('$427');
    expect(formatMXN(2350)).toBe('$23.50');
  });
});
