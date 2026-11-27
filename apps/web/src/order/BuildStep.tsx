import {
  formatMXN,
  groupsFor,
  isItemAvailable,
  leadTimeMessage,
  type Menu,
  type MenuItem,
  type Settings,
} from '@cuadrochico/core';
import { useState } from 'preact/hooks';
import { Totals } from '../components/Totals';
import { focusSoon } from '../lib';
import { type CartLine, type CartQuote, addLine, defaultOptions, drinkCount, nextTierHint, normalizeOptions, setQty } from './cart';

interface Props {
  menu: Menu;
  settings: Settings;
  cart: CartLine[];
  cartQuote: CartQuote;
  onCart: (cart: CartLine[]) => void;
  onContinue: () => void;
}

export function BuildStep({ menu, settings, cart, cartQuote, onCart, onContinue }: Props) {
  const [error, setError] = useState<string | null>(null);
  const drinks = drinkCount(cart);

  const next = () => {
    if (!cartQuote.ok) {
      setError(cartQuote.messages.join(' ') || 'Agrega bebidas a tu pedido.');
      focusSoon('build-error');
      return;
    }
    setError(null);
    onContinue();
  };

  return (
    <>
      <p class="lead">
        Todas nuestras bebidas se entregan <span class="hand">bien frías</span>. Mínimo {settings.minDrinks} bebidas;
        entre más pidas, más descuento.
      </p>
      <ul class="discounts" aria-label="Descuentos por número de bebidas">
        {settings.discountTiers.map((t) => (
          <li key={t.minDrinks}>
            {t.minDrinks}+ bebidas: <strong>{t.percent} %</strong>
          </li>
        ))}
      </ul>

      {menu.categories.map((cat) => {
        const items = menu.items.filter((i) => i.categoryId === cat.id && isItemAvailable(i));
        if (!items.length) return null;
        return (
          <section key={cat.id} aria-labelledby={`cat-${cat.id}`}>
            <h3 id={`cat-${cat.id}`} class="cat">
              {cat.name}
            </h3>
            <ul class="menu">
              {items.map((item) => (
                <li key={item.id}>
                  <ItemCard menu={menu} item={item} onAdd={(line) => onCart(addLine(cart, line))} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <section class="card cart" aria-labelledby="cart-title">
        <h3 id="cart-title">Tu pedido</h3>
        {cart.length === 0 ? (
          <p class="muted">Todavía no agregas bebidas.</p>
        ) : (
          <ul class="cart-lines">
            {cart.map((l) => (
              <CartRow key={l.key} menu={menu} line={l} onQty={(qty) => onCart(setQty(cart, l.key, qty))} />
            ))}
          </ul>
        )}

        <div aria-live="polite">
          {cartQuote.ok ? (
            <>
              <Totals quote={cartQuote.quote} depositPercent={settings.depositPercent} />
              {nextTierHint(cartQuote.quote) && <p class="hint">{nextTierHint(cartQuote.quote)}</p>}
              <p class="muted">{leadTimeMessage(drinks, settings)}</p>
            </>
          ) : (
            drinks > 0 && <p class="muted">{cartQuote.messages.join(' ')}</p>
          )}
        </div>
      </section>

      {error && (
        <p id="build-error" class="error" role="alert" tabIndex={-1}>
          {error}
        </p>
      )}
      <div class="nav">
        <button type="button" class="btn primary" onClick={next}>
          Elegir fecha y hora
        </button>
      </div>
    </>
  );
}

function ItemCard({ menu, item, onAdd }: { menu: Menu; item: MenuItem; onAdd: (l: Omit<CartLine, 'key'>) => void }) {
  const firstVariant = item.variants[0]?.id ?? '';
  const [variantId, setVariantId] = useState(firstVariant);
  const [options, setOptions] = useState(() => defaultOptions(menu, item, firstVariant));
  const [qty, setQtyState] = useState(1);
  const [added, setAdded] = useState<string | null>(null);
  const groups = groupsFor(menu, item, variantId);
  const variant = item.variants.find((v) => v.id === variantId);
  const unit =
    (variant?.priceCents ?? 0) +
    groups.reduce((s, g) => s + (g.options.find((o) => o.id === options[g.id])?.priceCents ?? 0), 0);
  const base = `item-${item.id}`;

  const add = () => {
    const n = Math.max(1, Math.floor(qty) || 1);
    onAdd({ itemId: item.id, variantId, options: normalizeOptions(menu, item, variantId, options), qty: n });
    setAdded(`Agregaste ${n} ${item.name}.`);
  };

  return (
    <article class="card item" aria-labelledby={`${base}-name`}>
      <h4 id={`${base}-name`}>{item.name}</h4>
      {item.description && <p class="muted">{item.description}</p>}
      <p class="price">{formatMXN(unit)} c/u</p>

      {item.variants.length > 1 && (
        <fieldset class="chips">
          <legend>Presentación</legend>
          {item.variants.map((v) => (
            <label key={v.id}>
              <input
                type="radio"
                name={`${base}-variant`}
                value={v.id}
                checked={v.id === variantId}
                onChange={() => {
                  setVariantId(v.id);
                  setOptions((o) => normalizeOptions(menu, item, v.id, o));
                }}
              />
              <span>
                {v.label} · {formatMXN(v.priceCents)}
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {groups.map((g) => (
        <div class="field" key={g.id}>
          <label for={`${base}-${g.id}`}>{g.name}</label>
          <select
            id={`${base}-${g.id}`}
            value={options[g.id]}
            onChange={(e) => setOptions({ ...options, [g.id]: (e.target as HTMLSelectElement).value })}
          >
            {g.options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
                {o.priceCents ? ` (+${formatMXN(o.priceCents)})` : ''}
              </option>
            ))}
          </select>
        </div>
      ))}

      <div class="add-row">
        <div class="field qty">
          <label for={`${base}-qty`}>Cantidad</label>
          <input
            id={`${base}-qty`}
            type="number"
            inputMode="numeric"
            min={1}
            max={1000}
            value={qty}
            onInput={(e) => setQtyState(Number((e.target as HTMLInputElement).value))}
          />
        </div>
        <button type="button" class="btn" onClick={add}>
          Agregar
        </button>
      </div>
      <p class="sr-only" aria-live="polite">
        {added}
      </p>
    </article>
  );
}

function CartRow({ menu, line, onQty }: { menu: Menu; line: CartLine; onQty: (qty: number) => void }) {
  const item = menu.items.find((i) => i.id === line.itemId);
  const variant = item?.variants.find((v) => v.id === line.variantId);
  const optionLabels = item
    ? groupsFor(menu, item, line.variantId)
        .map((g) => g.options.find((o) => o.id === line.options[g.id])?.label)
        .filter(Boolean)
    : [];
  const name = [item?.name ?? line.itemId, item && item.variants.length > 1 ? variant?.label : null]
    .filter(Boolean)
    .join(' ');
  const detail = optionLabels.join(', ');
  const label = detail ? `${name} (${detail})` : name;
  const id = `qty-${line.key.replace(/[^a-z0-9]/gi, '-')}`;
  return (
    <li class="cart-line">
      <div>
        <strong>{name}</strong>
        {detail && <span class="muted"> · {detail}</span>}
      </div>
      <div class="stepper">
        <button type="button" class="btn small" aria-label={`Quitar una: ${label}`} onClick={() => onQty(line.qty - 1)}>
          −
        </button>
        <label class="sr-only" for={id}>
          Cantidad de {label}
        </label>
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={0}
          max={1000}
          value={line.qty}
          onChange={(e) => onQty(Number((e.target as HTMLInputElement).value))}
        />
        <button type="button" class="btn small" aria-label={`Agregar una: ${label}`} onClick={() => onQty(line.qty + 1)}>
          +
        </button>
        <button type="button" class="btn small link" onClick={() => onQty(0)}>
          Quitar<span class="sr-only"> {label}</span>
        </button>
      </div>
    </li>
  );
}
