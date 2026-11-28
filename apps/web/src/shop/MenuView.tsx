import {
  formatMXN,
  isItemAvailable,
  leadTimeHoursFor,
  type Menu,
  type MenuItem,
  type Settings,
} from '@cuadrochico/core';
import { useEffect, useRef, useState } from 'preact/hooks';
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
  const ids = categories.map((c) => c.id);
  const [active, setActive] = useState(ids[0] ?? '');
  const tabs = useRef<HTMLElement>(null);

  // La pestaña activa sigue al scroll: es la última sección cuyo título ya pasó debajo de las pestañas.
  useEffect(() => {
    if (ids.length < 2) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const line = (tabs.current?.getBoundingClientRect().bottom ?? 0) + 24;
        let current = ids[0] ?? '';
        for (const id of ids) {
          const top =
            document.getElementById(`cat-${id}`)?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY;
          if (top <= line) current = id;
        }
        // Al llegar al final, la última categoría cuenta aunque su título no alcance la línea.
        if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4)
          current = ids[ids.length - 1] ?? current;
        setActive(current);
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
    };
  }, [ids.join()]);

  // Que la pestaña activa siempre se vea en la barra (en celular la barra se desliza de lado).
  // Solo se mueve la barra: un scrollIntoView cortaría el desplazamiento de la página.
  useEffect(() => {
    const bar = tabs.current;
    const tab = bar?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!bar || !tab) return;
    const left = tab.offsetLeft - bar.offsetLeft;
    if (left < bar.scrollLeft || left + tab.offsetWidth > bar.scrollLeft + bar.clientWidth)
      bar.scrollLeft = left - 16;
  }, [active]);

  const goTo = (id: string) => {
    setActive(id);
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    document
      .getElementById(`cat-${id}`)
      ?.scrollIntoView?.({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  };

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
        <nav class="cat-tabs" aria-label="Categorías" ref={tabs}>
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-current={active === c.id ? 'true' : undefined}
              onClick={() => goTo(c.id)}
            >
              {c.name}
            </button>
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
