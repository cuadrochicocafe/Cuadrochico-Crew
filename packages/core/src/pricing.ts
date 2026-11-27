import type { DiscountTier, Menu, MenuItem, ModifierGroup, OrderLineInput, Settings } from './schema';

export interface PricedOption {
  groupId: string;
  groupName: string;
  optionId: string;
  label: string;
  priceCents: number;
}

export interface PricedLine {
  itemId: string;
  variantId: string;
  name: string;
  variantLabel: string;
  options: PricedOption[];
  qty: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

export interface Quote {
  lines: PricedLine[];
  drinks: number;
  subtotalCents: number;
  discountPercent: number;
  discountCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  depositCents: number;
  balanceCents: number;
  /** Siguiente nivel de descuento, para mostrar "agrega N bebidas y obtén X %". Informativo, no presión. */
  nextTier: { drinksNeeded: number; percent: number } | null;
}

export type QuoteError =
  | { code: 'unknown_item'; itemId: string }
  | { code: 'unknown_variant'; itemId: string; variantId: string }
  | { code: 'item_unavailable'; itemId: string }
  | { code: 'invalid_option'; itemId: string; groupId: string; optionId: string }
  | { code: 'unexpected_option'; itemId: string; groupId: string }
  | { code: 'below_minimum'; drinks: number; minimum: number }
  | { code: 'above_maximum'; drinks: number; maximum: number }
  | { code: 'delivery_unavailable' }
  | { code: 'delivery_below_minimum'; drinks: number; minimum: number };

export type Result<T, E> = { ok: true; value: T } | { ok: false; errors: E[] };

/** Descuento aplicable al número de bebidas: el nivel más alto alcanzado. */
export function discountFor(drinks: number, tiers: readonly DiscountTier[]): number {
  let pct = 0;
  for (const t of tiers) if (drinks >= t.minDrinks) pct = Math.max(pct, t.percent);
  return pct;
}

export function nextTierFor(drinks: number, tiers: readonly DiscountTier[]): Quote['nextTier'] {
  const current = discountFor(drinks, tiers);
  const next = [...tiers]
    .sort((a, b) => a.minDrinks - b.minDrinks)
    .find((t) => t.minDrinks > drinks && t.percent > current);
  return next ? { drinksNeeded: next.minDrinks - drinks, percent: next.percent } : null;
}

/** Grupos de opciones que aplican a un artículo con la variante elegida, sin repetir. */
export function groupsFor(menu: Menu, item: MenuItem, variantId: string): ModifierGroup[] {
  const variant = item.variants.find((v) => v.id === variantId);
  const ids = [...new Set([...item.modifierGroupIds, ...(variant?.modifierGroupIds ?? [])])];
  return ids.map((id) => menu.modifierGroups.find((g) => g.id === id)).filter((g): g is ModifierGroup => !!g);
}

/** El artículo se puede pedir para la fecha dada (YYYY-MM-DD), considerando temporada. */
export function isItemAvailable(item: MenuItem, date?: string): boolean {
  if (!item.available) return false;
  if (!date) return true;
  if (item.availableFrom && date < item.availableFrom) return false;
  if (item.availableUntil && date > item.availableUntil) return false;
  return true;
}

/** Redondea a pesos completos (centavos múltiplos de 100). */
const toPesos = (cents: number) => Math.round(cents / 100) * 100;

export interface QuoteContext {
  menu: Menu;
  settings: Settings;
  fulfillment: 'pickup' | 'delivery';
  /** Fecha de entrega local (YYYY-MM-DD) para validar temporada. Opcional al cotizar desde el carrito. */
  date?: string;
}

/**
 * Cotiza un pedido. Es la única función que define cuánto se cobra:
 * la usan el navegador (cotización en vivo) y el servidor (cobro real), así nunca difieren.
 */
export function quote(lines: readonly OrderLineInput[], ctx: QuoteContext): Result<Quote, QuoteError> {
  const { menu, settings } = ctx;
  const errors: QuoteError[] = [];
  const priced: PricedLine[] = [];

  for (const line of lines) {
    const item = menu.items.find((i) => i.id === line.itemId);
    if (!item) {
      errors.push({ code: 'unknown_item', itemId: line.itemId });
      continue;
    }
    if (!isItemAvailable(item, ctx.date)) {
      errors.push({ code: 'item_unavailable', itemId: item.id });
      continue;
    }
    const variant = item.variants.find((v) => v.id === line.variantId);
    if (!variant) {
      errors.push({ code: 'unknown_variant', itemId: item.id, variantId: line.variantId });
      continue;
    }
    const groups = groupsFor(menu, item, variant.id);
    const options: PricedOption[] = [];
    let lineOk = true;
    for (const g of groups) {
      const chosen = line.options[g.id];
      const opt = chosen === undefined ? g.options[0] : g.options.find((o) => o.id === chosen);
      if (!opt) {
        errors.push({ code: 'invalid_option', itemId: item.id, groupId: g.id, optionId: String(chosen) });
        lineOk = false;
        continue;
      }
      options.push({
        groupId: g.id,
        groupName: g.name,
        optionId: opt.id,
        label: opt.label,
        priceCents: opt.priceCents,
      });
    }
    for (const gid of Object.keys(line.options))
      if (!groups.some((g) => g.id === gid)) {
        errors.push({ code: 'unexpected_option', itemId: item.id, groupId: gid });
        lineOk = false;
      }
    if (!lineOk) continue;

    const unit = variant.priceCents + options.reduce((s, o) => s + o.priceCents, 0);
    priced.push({
      itemId: item.id,
      variantId: variant.id,
      name: item.name,
      variantLabel: variant.label,
      options,
      qty: line.qty,
      unitPriceCents: unit,
      lineTotalCents: unit * line.qty,
    });
  }

  const drinks = lines.reduce((s, l) => s + l.qty, 0);
  if (drinks < settings.minDrinks)
    errors.push({ code: 'below_minimum', drinks, minimum: settings.minDrinks });
  if (drinks > settings.maxDrinks)
    errors.push({ code: 'above_maximum', drinks, maximum: settings.maxDrinks });

  const delivery = settings.fulfillment.delivery;
  if (ctx.fulfillment === 'delivery') {
    if (!delivery.enabled) errors.push({ code: 'delivery_unavailable' });
    else if (drinks < delivery.minDrinks)
      errors.push({ code: 'delivery_below_minimum', drinks, minimum: delivery.minDrinks });
  }

  if (errors.length) return { ok: false, errors };

  const subtotalCents = priced.reduce((s, l) => s + l.lineTotalCents, 0);
  const discountPercent = discountFor(drinks, settings.discountTiers);
  const discountCents = toPesos((subtotalCents * discountPercent) / 100);
  const deliveryFeeCents = ctx.fulfillment === 'delivery' ? delivery.feeCents : 0;
  const totalCents = subtotalCents - discountCents + deliveryFeeCents;
  const depositCents = Math.min(
    totalCents,
    Math.ceil((totalCents * settings.depositPercent) / 100 / 100) * 100,
  );

  return {
    ok: true,
    value: {
      lines: priced,
      drinks,
      subtotalCents,
      discountPercent,
      discountCents,
      deliveryFeeCents,
      totalCents,
      depositCents,
      balanceCents: totalCents - depositCents,
      nextTier: nextTierFor(drinks, settings.discountTiers),
    },
  };
}

/** Mensaje en español para cada error de cotización, listo para mostrar al cliente. */
export function quoteErrorMessage(e: QuoteError, menu?: Menu): string {
  const name = (id: string) => menu?.items.find((i) => i.id === id)?.name ?? id;
  switch (e.code) {
    case 'unknown_item':
      return 'Una de las bebidas ya no está en el menú. Quítala del pedido.';
    case 'unknown_variant':
      return `La presentación elegida de ${name(e.itemId)} ya no existe. Elígela de nuevo.`;
    case 'item_unavailable':
      return `${name(e.itemId)} no está disponible para esa fecha.`;
    case 'invalid_option':
    case 'unexpected_option':
      return `Revisa las opciones de ${name(e.itemId)}.`;
    case 'below_minimum':
      return `El pedido mínimo es de ${e.minimum} bebidas; llevas ${e.drinks}.`;
    case 'above_maximum':
      return `Para más de ${e.maximum} bebidas escríbenos por WhatsApp y lo organizamos contigo.`;
    case 'delivery_unavailable':
      return 'Por ahora solo puedes recoger tu pedido en la cafetería.';
    case 'delivery_below_minimum':
      return `El envío a domicilio es a partir de ${e.minimum} bebidas.`;
  }
}

export function formatMXN(cents: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}
