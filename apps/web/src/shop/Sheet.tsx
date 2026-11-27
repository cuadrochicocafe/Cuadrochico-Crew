import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

interface Props {
  title: string;
  /** Oculta el título visualmente (p. ej. cuando la hoja ya lo muestra en otro lugar). */
  hideTitle?: boolean;
  children: ComponentChildren;
  /** Barra fija al pie de la hoja (botón principal). */
  footer?: ComponentChildren;
  onClose: () => void;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Hoja modal que sube desde abajo, como en las apps de pedidos.
 * Atrapa el foco, cierra con Esc o tocando afuera, bloquea el scroll de atrás y devuelve el foco al cerrar.
 */
export function Sheet({ title, hideTitle, children, footer, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('.sheet-close')?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
      opener?.focus?.();
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !ref.current) return;
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div class="sheet-backdrop">
      {/* Tocar afuera cierra la hoja; con teclado se cierra con Esc o con el botón ×. */}
      <button type="button" class="sheet-scrim" tabIndex={-1} aria-hidden="true" onClick={onClose} />
      <div
        ref={ref}
        class="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        onKeyDown={onKeyDown}
      >
        <div class="sheet-head">
          <h2 id="sheet-title" class={hideTitle ? 'sr-only' : undefined}>
            {title}
          </h2>
          <button type="button" class="sheet-close" aria-label="Cerrar" onClick={onClose}>
            ×
          </button>
        </div>
        <div class="sheet-body">{children}</div>
        {footer && <div class="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}
