import { formatMXN, type PricedLine } from '@cuadrochico/core';

/** Líneas cotizadas por core (nombre, opciones y subtotal). */
export function Lines({ lines }: { lines: PricedLine[] }) {
  return (
    <ul class="lines">
      {lines.map((l) => {
        const opts = l.options.map((o) => o.label).join(', ');
        return (
          <li key={`${l.itemId}-${l.variantId}-${opts}`}>
            <span>
              {l.qty} × {l.name}
              {l.variantLabel && l.variantLabel !== 'Regular' ? ` ${l.variantLabel}` : ''}
              {opts && <span class="muted"> · {opts}</span>}
            </span>
            <span>{formatMXN(l.lineTotalCents)}</span>
          </li>
        );
      })}
    </ul>
  );
}
