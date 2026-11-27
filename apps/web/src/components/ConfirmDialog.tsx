import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

interface Props {
  title: string;
  children: ComponentChildren;
  confirmLabel: string;
  cancelLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Diálogo modal accesible sin `<dialog>` (no existe en Safari viejo):
 * enfoca el botón seguro, atrapa Tab, cierra con Esc y devuelve el foco a quien lo abrió.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  cancelLabel,
  busy,
  onConfirm,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => opener?.focus();
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !busy) {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !ref.current) return;
    const focusable = [...ref.current.querySelectorAll<HTMLElement>('button:not([disabled])')];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
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
    <div class="dialog-backdrop">
      <div
        ref={ref}
        class="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby="dialog-body"
        onKeyDown={onKeyDown}
      >
        <h2 id="dialog-title">{title}</h2>
        <div id="dialog-body">{children}</div>
        <div class="actions">
          <button type="button" ref={cancelRef} class="btn" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </button>
          <button type="button" class="btn danger" onClick={onConfirm} disabled={busy} aria-busy={busy}>
            {busy ? 'Cancelando…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
