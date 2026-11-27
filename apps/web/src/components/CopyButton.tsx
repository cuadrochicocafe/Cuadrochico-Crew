import { useState } from 'preact/hooks';

/** Copia un dato (CLABE, concepto) para pegarlo en la app del banco. Si el navegador no deja, no muestra nada. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  if (typeof navigator === 'undefined' || !navigator.clipboard) return null;
  return (
    <button
      type="button"
      class="copy"
      onClick={() =>
        navigator.clipboard.writeText(value).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          },
          () => setCopied(false),
        )
      }
    >
      {copied ? 'Copiado' : 'Copiar'}
      <span class="sr-only"> {label}</span>
    </button>
  );
}
