import { formatMXN, groupsFor, leadTimeMessage, type Menu, type Settings } from '@cuadrochico/core';
import { Totals } from '../components/Totals';
import { type CartLine, type CartQuote, cartProgress, drinkCount, setQty } from '../order/cart';
import { Sheet } from './Sheet';
import { Stepper } from './Stepper';
import { DrinkArt } from './visuals';

interface Props {
  menu: Menu;
  settings: Settings;
  cart: CartLine[];
  cartQuote: CartQuote;
  onCart: (cart: CartLine[]) => void;
  onCheckout: () => void;
  onClose: () => void;
}

export function lineText(menu: Menu, line: CartLine) {
  const item = menu.items.find((i) => i.id === line.itemId);
  const variant = item?.variants.find((v) => v.id === line.variantId);
  const name = item?.name ?? line.itemId;
  const details = [
    item && item.variants.length > 1 ? variant?.label : null,
    ...(item
      ? groupsFor(menu, item, line.variantId)
          .map((g) => g.options.find((o) => o.id === line.options[g.id]))
          .filter((o) => o && !o.id.startsWith('sin-'))
          .map((o) => o?.label)
      : []),
  ].filter(Boolean);
  return { item, name, detail: details.join(' · ') };
}

export function CartSheet({ menu, settings, cart, cartQuote, onCart, onCheckout, onClose }: Props) {
  const drinks = drinkCount(cart);
  const priced = cartQuote.ok ? cartQuote.quote.lines : [];
  return (
    <Sheet
      title="Tu pedido"
      onClose={onClose}
      footer={
        cart.length > 0 && (
          <>
            {!cartQuote.ok && (
              <p class="foot-note" role="status">
                {cartQuote.messages.join(' ')}
              </p>
            )}
            <button type="button" class="btn primary block" disabled={!cartQuote.ok} onClick={onCheckout}>
              {cartQuote.ok
                ? `Continuar · ${formatMXN(cartQuote.quote.totalCents)}`
                : cartProgress(drinks, settings).label}
            </button>
          </>
        )
      }
    >
      {cart.length === 0 ? (
        <p class="empty">Todavía no agregas bebidas.</p>
      ) : (
        <>
          <ul class="cart-list">
            {cart.map((l, i) => {
              const { item, name, detail } = lineText(menu, l);
              // Con una cotización válida, quote() devuelve las líneas en el mismo orden del carrito.
              const p = priced[i];
              return (
                <li key={l.key} class="cart-item">
                  {item && <DrinkArt item={item} size="thumb" />}
                  <div class="cart-item-text">
                    <strong>{name}</strong>
                    {detail && <span class="muted small">{detail}</span>}
                    {p && <span class="small">{formatMXN(p.lineTotalCents)}</span>}
                  </div>
                  <Stepper
                    size="small"
                    min={0}
                    value={l.qty}
                    label={detail ? `${name} (${detail})` : name}
                    onChange={(n) => onCart(setQty(cart, l.key, n))}
                  />
                </li>
              );
            })}
          </ul>
          {cartQuote.ok && <Totals quote={cartQuote.quote} depositPercent={settings.depositPercent} />}
          <p class="muted small">{leadTimeMessage(drinks, settings)}</p>
        </>
      )}
    </Sheet>
  );
}
