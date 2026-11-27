import { formatMXN, type Settings } from '@cuadrochico/core';
import { plural } from '../lib';
import { type CartQuote, cartProgress } from '../order/cart';

interface Props {
  settings: Settings;
  drinks: number;
  cartQuote: CartQuote;
  subtotalCents: number;
  onOpen: () => void;
}

/** Barra fija abajo: cuántas bebidas, total y avance al mínimo o al siguiente descuento. */
export function CartBar({ settings, drinks, cartQuote, subtotalCents, onOpen }: Props) {
  if (drinks === 0) return null;
  const progress = cartProgress(drinks, settings);
  const total = cartQuote.ok ? cartQuote.quote.totalCents : subtotalCents;
  return (
    <div class="cart-bar">
      <div class="cart-bar-progress" aria-hidden="true">
        <span style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
      </div>
      <p class="cart-bar-hint" aria-live="polite">
        {progress.label}
      </p>
      <button type="button" class="cart-bar-btn" onClick={onOpen}>
        <span class="count">{drinks}</span>
        <span class="label">Ver pedido</span>
        <span class="sum">{formatMXN(total)}</span>
        <span class="sr-only">, {plural(drinks, 'bebida', 'bebidas')}</span>
      </button>
    </div>
  );
}
