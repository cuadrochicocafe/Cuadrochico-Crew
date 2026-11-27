import { formatMXN, groupsFor, type Menu, type MenuItem, type Settings } from '@cuadrochico/core';
import { useState } from 'preact/hooks';
import { type CartLine, defaultOptions, normalizeOptions } from '../order/cart';
import { Sheet } from './Sheet';
import { Stepper } from './Stepper';
import { DrinkArt } from './visuals';

interface Props {
  menu: Menu;
  settings: Settings;
  item: MenuItem;
  /** Bebidas que ya hay en el carrito: si faltan para el mínimo, el contador empieza en lo que falta. */
  cartDrinks: number;
  onAdd: (line: Omit<CartLine, 'key'>) => void;
  onClose: () => void;
}

export function ProductSheet({ menu, settings, item, cartDrinks, onAdd, onClose }: Props) {
  const firstVariant = item.variants[0]?.id ?? '';
  const [variantId, setVariantId] = useState(firstVariant);
  const [options, setOptions] = useState(() => defaultOptions(menu, item, firstVariant));
  const [qty, setQty] = useState(Math.max(1, settings.minDrinks - cartDrinks));
  const groups = groupsFor(menu, item, variantId);
  const variant = item.variants.find((v) => v.id === variantId);
  const unit =
    (variant?.priceCents ?? 0) +
    groups.reduce((s, g) => s + (g.options.find((o) => o.id === options[g.id])?.priceCents ?? 0), 0);
  const base = `p-${item.id}`;

  const add = () =>
    onAdd({ itemId: item.id, variantId, options: normalizeOptions(menu, item, variantId, options), qty });

  return (
    <Sheet
      title={item.name}
      onClose={onClose}
      footer={
        <button type="button" class="btn primary block" onClick={add}>
          Agregar {qty} · {formatMXN(unit * qty)}
        </button>
      }
    >
      <DrinkArt item={item} size="sheet" />
      <p class="sheet-price">{formatMXN(unit)} c/u</p>
      {item.description && <p class="muted">{item.description}</p>}

      {item.variants.length > 1 && (
        <fieldset class="pills">
          <legend>Presentación</legend>
          {item.variants.map((v) => (
            <label key={v.id} class="pill">
              <input
                type="radio"
                name={`${base}-variant`}
                checked={v.id === variantId}
                onChange={() => {
                  setVariantId(v.id);
                  setOptions((o) => normalizeOptions(menu, item, v.id, o));
                }}
              />
              <span>
                {v.label} <small>{formatMXN(v.priceCents)}</small>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {groups.map((g) => (
        <fieldset key={g.id} class="pills">
          <legend>{g.name}</legend>
          {g.options.map((o) => (
            <label key={o.id} class="pill">
              <input
                type="radio"
                name={`${base}-${g.id}`}
                checked={options[g.id] === o.id}
                onChange={() => setOptions({ ...options, [g.id]: o.id })}
              />
              <span>
                {o.label}
                {o.priceCents > 0 && <small> +{formatMXN(o.priceCents)}</small>}
              </span>
            </label>
          ))}
        </fieldset>
      ))}

      <div class="qty-row">
        <span class="qty-label">Cantidad</span>
        <Stepper value={qty} label={item.name} onChange={setQty} />
      </div>
      <fieldset class="quick">
        <legend class="sr-only">Cantidades rápidas</legend>
        {[6, 12, 24].map((n) => (
          <button
            key={n}
            type="button"
            class={qty === n ? 'chip on' : 'chip'}
            aria-pressed={qty === n}
            onClick={() => setQty(n)}
          >
            {n}
          </button>
        ))}
      </fieldset>
    </Sheet>
  );
}
