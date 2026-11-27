import {
  formatMXN,
  isItemAvailable,
  leadTimeHoursFor,
  type Menu,
  type MenuItem,
  type Settings,
} from '@cuadrochico/core';
import type { CartLine } from '../order/cart';
import { DrinkArt } from './visuals';

const hoursText = (h: number) => (h % 24 === 0 ? `${h / 24} ${h === 24 ? 'día' : 'días'}` : `${h} horas`);

interface Props {
  menu: Menu;
  settings: Settings;
  cart: CartLine[];
  onOpen: (itemId: string) => void;
}

const fromPrice = (item: MenuItem) => Math.min(...item.variants.map((v) => v.priceCents));

export function MenuView({ menu, settings, cart, onOpen }: Props) {
  const inCart = (id: string) => cart.filter((l) => l.itemId === id).reduce((s, l) => s + l.qty, 0);
  const categories = menu.categories
    .map((c) => ({ ...c, items: menu.items.filter((i) => i.categoryId === c.id && isItemAvailable(i)) }))
    .filter((c) => c.items.length);

  return (
    <div class="shop">
      <section class="hero" aria-labelledby="hero-title">
        <h2 id="hero-title">
          Bebidas <span class="hand">bien frías</span> para tu evento
        </h2>
        <p class="hero-facts">
          <span>Desde {settings.minDrinks} bebidas</span>
          <span>Recoges en Av. Fundadores</span>
          <span>Pide con {hoursText(leadTimeHoursFor(1, settings))} de anticipación</span>
        </p>
        <ul class="tiers" aria-label="Descuentos por número de bebidas">
          {settings.discountTiers.map((t) => (
            <li key={t.minDrinks}>
              <strong>{t.percent} %</strong> desde {t.minDrinks}
            </li>
          ))}
        </ul>
      </section>

      {categories.length > 1 && (
        <nav class="cat-tabs" aria-label="Categorías">
          {categories.map((c) => (
            <a key={c.id} href={`#cat-${c.id}`}>
              {c.name}
            </a>
          ))}
        </nav>
      )}

      {categories.map((c) => (
        <section key={c.id} id={`cat-${c.id}`} class="cat-section" aria-labelledby={`cat-${c.id}-title`}>
          <h3 id={`cat-${c.id}-title`}>{c.name}</h3>
          <ul class="grid">
            {c.items.map((item) => {
              const n = inCart(item.id);
              return (
                <li key={item.id}>
                  <button type="button" class="product" onClick={() => onOpen(item.id)}>
                    <DrinkArt item={item} />
                    {n > 0 && (
                      <span class="badge" aria-hidden="true">
                        {n}
                      </span>
                    )}
                    <span class="product-info">
                      <span class="product-name">{item.name}</span>
                      <span class="product-desc">{item.description}</span>
                      <span class="product-price">
                        {item.variants.length > 1 ? 'desde ' : ''}
                        {formatMXN(fromPrice(item))}
                      </span>
                    </span>
                    <span class="add" aria-hidden="true">
                      +
                    </span>
                    {n > 0 && <span class="sr-only">, {n} en tu pedido</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
