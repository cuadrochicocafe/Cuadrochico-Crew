import {
  groupsFor,
  leadTimeHoursFor,
  leadTimeMessage,
  type Menu,
  type MenuItem,
  type OrderLineInput,
  type PaymentPlan,
  type Quote,
  quote,
  quoteErrorMessage,
  type Settings,
} from '@cuadrochico/core';

/** Una línea del carrito: bebida + variante + opciones. Dos líneas con la misma configuración se juntan. */
export type CartLine = OrderLineInput & { key: string };

export const lineKey = (l: Pick<OrderLineInput, 'itemId' | 'variantId' | 'options'>) =>
  [
    l.itemId,
    l.variantId,
    ...Object.entries(l.options)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([g, o]) => `${g}=${o}`),
  ].join('|');

/** Opciones por defecto (la primera de cada grupo, como define core) para la variante dada. */
export function defaultOptions(menu: Menu, item: MenuItem, variantId: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const g of groupsFor(menu, item, variantId)) {
    const first = g.options[0];
    if (first) out[g.id] = first.id;
  }
  return out;
}

/** Deja solo los grupos que aplican a la variante; los que faltan toman su valor por defecto. */
export function normalizeOptions(
  menu: Menu,
  item: MenuItem,
  variantId: string,
  options: Record<string, string>,
): Record<string, string> {
  const out = defaultOptions(menu, item, variantId);
  for (const g of Object.keys(out)) {
    const chosen = options[g];
    if (chosen !== undefined) out[g] = chosen;
  }
  return out;
}

export function addLine(cart: readonly CartLine[], line: OrderLineInput): CartLine[] {
  const key = lineKey(line);
  const existing = cart.find((l) => l.key === key);
  if (existing) return cart.map((l) => (l.key === key ? { ...l, qty: l.qty + line.qty } : l));
  return [...cart, { ...line, key }];
}

/** Cambia la cantidad; 0 o menos quita la línea. */
export function setQty(cart: readonly CartLine[], key: string, qty: number): CartLine[] {
  if (!Number.isFinite(qty) || qty <= 0) return cart.filter((l) => l.key !== key);
  return cart.map((l) => (l.key === key ? { ...l, qty: Math.floor(qty) } : l));
}

export const drinkCount = (cart: readonly Pick<OrderLineInput, 'qty'>[]) =>
  cart.reduce((s, l) => s + l.qty, 0);

export const toOrderLines = (cart: readonly CartLine[]): OrderLineInput[] =>
  cart.map(({ itemId, variantId, options, qty }) => ({ itemId, variantId, options, qty }));

export type CartQuote = { ok: true; quote: Quote } | { ok: false; messages: string[] };

/** Cotización en vivo con `quote()` de core, con los errores ya en español. */
export function quoteCart(
  cart: readonly CartLine[],
  menu: Menu,
  settings: Settings,
  fulfillment: 'pickup' | 'delivery' = 'pickup',
  date?: string,
): CartQuote {
  const r = quote(toOrderLines(cart), { menu, settings, fulfillment, ...(date ? { date } : {}) });
  if (r.ok) return { ok: true, quote: r.value };
  return { ok: false, messages: [...new Set(r.errors.map((e) => quoteErrorMessage(e, menu)))] };
}

/** "Agrega N y obtén X %": solo informativo. */
export function nextTierHint(q: Pick<Quote, 'nextTier'>): string | null {
  if (!q.nextTier) return null;
  const n = q.nextTier.drinksNeeded;
  return `Si agregas ${n} ${n === 1 ? 'bebida' : 'bebidas'}, tu descuento sube a ${q.nextTier.percent} %.`;
}

/**
 * Si cambió la anticipación (p. ej. de 24 a 25 bebidas) desde la última vez que se cargaron las fechas,
 * explica por qué cambiaron las fechas disponibles. `null` si no hay nada que avisar.
 */
export function leadTimeChangeNotice(
  prevDrinks: number | null,
  drinks: number,
  settings: Settings,
): string | null {
  if (prevDrinks === null) return null;
  const before = leadTimeHoursFor(prevDrinks, settings);
  const after = leadTimeHoursFor(drinks, settings);
  if (before === after) return null;
  const direction = after > before ? 'más' : 'menos';
  return `Tu pedido ahora es de ${drinks} bebidas, así que necesitamos ${direction} anticipación y cambiaron las fechas disponibles. ${leadTimeMessage(drinks, settings)}`;
}

// ---------- Barra del carrito

export interface CartProgress {
  /** Texto corto para la barra: mínimo, siguiente descuento o descuento aplicado. */
  label: string;
  /** Avance hacia la siguiente meta (mínimo o siguiente nivel), de 0 a 1. */
  ratio: number;
}

/** Progreso hacia el mínimo y los niveles de descuento. Informativo: nunca presiona ni inventa urgencia. */
export function cartProgress(drinks: number, settings: Settings): CartProgress {
  const min = settings.minDrinks;
  if (drinks < min) {
    const n = min - drinks;
    return {
      label: `Te ${n === 1 ? 'falta 1 bebida' : `faltan ${n} bebidas`} para el mínimo de ${min}`,
      ratio: drinks / min,
    };
  }
  const tiers = [...settings.discountTiers].sort((a, b) => a.minDrinks - b.minDrinks);
  let current = 0;
  let from = min;
  for (const t of tiers)
    if (drinks >= t.minDrinks) {
      current = t.percent;
      from = t.minDrinks;
    }
  const next = tiers.find((t) => t.minDrinks > drinks && t.percent > current);
  if (next) {
    const n = next.minDrinks - drinks;
    const prefix = current ? `${current} % de descuento · ` : '';
    return {
      label: `${prefix}agrega ${n} y obtén ${next.percent} %`,
      ratio: (drinks - from) / (next.minDrinks - from),
    };
  }
  return { label: current ? `Tienes el ${current} % de descuento` : 'Listo para pedir', ratio: 1 };
}

// ---------- Checkout

export type CheckoutField = 'slot' | 'name' | 'phone' | 'email' | 'address' | 'plan' | 'method';

/** Lo que falta para poder pagar, en el orden en que aparece en la página. Nunca se paga sin elegir plan. */
export function checkoutIssues(p: {
  slot: { date: string; time: string } | null;
  customerErrors: Partial<Record<'name' | 'phone' | 'email' | 'address', string>>;
  plan: PaymentPlan | null;
  method: string | null;
}): CheckoutField[] {
  const out: CheckoutField[] = [];
  if (!p.slot) out.push('slot');
  for (const k of ['name', 'phone', 'email', 'address'] as const) if (p.customerErrors[k]) out.push(k);
  if (!p.plan) out.push('plan');
  if (!p.method) out.push('method');
  return out;
}
