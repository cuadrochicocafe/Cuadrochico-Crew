import type { MenuItem } from '@cuadrochico/core';

/**
 * Colores de cada bebida para la tarjeta mientras no haya fotos (`item.image`).
 * Solo decoración: el nombre siempre va en texto.
 */
const PALETTE: Record<string, [string, string]> = {
  'cinnamon-banana-latte': ['#f1d9a8', '#c48a4f'],
  'matcha-latte': ['#cfe2b0', '#6f9a48'],
  'chai-latte': ['#ecd0ad', '#a8693a'],
  'cold-brew': ['#b08f74', '#3b271b'],
  'cold-brew-jamaica': ['#f0a3ae', '#97243f'],
  'cold-brew-tonic': ['#e3eef0', '#7a5640'],
  'cold-brew-lemonade': ['#f6e7a1', '#8a6a45'],
};
const FALLBACK: [string, string] = ['#e9e1d3', '#13293d'];

export function DrinkArt({ item, size = 'card' }: { item: MenuItem; size?: 'card' | 'sheet' | 'thumb' }) {
  const [light, dark] = PALETTE[item.id] ?? FALLBACK;
  if (item.image)
    return <img class={`art art-${size}`} src={item.image} alt="" loading="lazy" decoding="async" />;
  return (
    <div
      class={`art art-${size}`}
      style={{ background: `linear-gradient(160deg, ${light} 0%, ${dark} 100%)` }}
      aria-hidden="true"
    >
      <img src="/logo_vaso.svg" alt="" width={56} height={72} />
      <span class="ice" />
    </div>
  );
}
