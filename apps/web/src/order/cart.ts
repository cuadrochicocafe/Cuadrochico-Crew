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

// ---------- Pasos del flujo

export const STEPS = ['build', 'date', 'data', 'review', 'payment'] as const;
export type Step = (typeof STEPS)[number];

export const STEP_TITLES: Record<Step, string> = {
  build: 'Arma tu pedido',
  date: 'Fecha y hora',
  data: 'Tus datos',
  review: 'Revisa tu pedido',
  payment: 'Pago',
};

export interface FlowProgress {
  quoteOk: boolean;
  slot: { date: string; time: string } | null;
  customerValid: boolean;
  plan: PaymentPlan | null;
}

/**
 * Se puede entrar a un paso solo si los anteriores están completos:
 * nunca se piden datos sin haber visto el total, ni se paga sin elegir plan.
 */
export function canEnter(step: Step, p: FlowProgress): boolean {
  switch (step) {
    case 'build':
      return true;
    case 'date':
      return p.quoteOk;
    case 'data':
      return p.quoteOk && p.slot !== null;
    case 'review':
      return p.quoteOk && p.slot !== null && p.customerValid;
    case 'payment':
      return p.quoteOk && p.slot !== null && p.customerValid && p.plan !== null;
  }
}

/** El paso más avanzado al que se puede llegar; sirve para regresar si algo se invalidó. */
export function furthestStep(p: FlowProgress): Step {
  let last: Step = 'build';
  for (const s of STEPS) if (canEnter(s, p)) last = s;
  return last;
}
