import { MAX_DRINKS_PER_ORDER } from '@cuadrochico/core';

interface Props {
  value: number;
  /** Mínimo del contador; en el carrito es 0 (quita la bebida). */
  min?: number;
  /** Nombre de lo que se cuenta, para lectores de pantalla ("Matcha Latte"). */
  label: string;
  onChange: (n: number) => void;
  size?: 'large' | 'small';
}

/** Contador − n +. El número también se puede escribir para cantidades grandes. */
export function Stepper({ value, min = 1, label, onChange, size = 'large' }: Props) {
  const set = (n: number) => onChange(Math.min(MAX_DRINKS_PER_ORDER, Math.max(min, Math.floor(n) || 0)));
  return (
    <fieldset class={`stepper stepper-${size}`}>
      <legend class="sr-only">Cantidad de {label}</legend>
      <button
        type="button"
        aria-label={value - 1 < 1 && min === 0 ? `Quitar ${label}` : `Una menos de ${label}`}
        disabled={value <= min}
        onClick={() => set(value - 1)}
      >
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        aria-label={`Cantidad de ${label}`}
        min={min}
        max={MAX_DRINKS_PER_ORDER}
        value={value}
        onChange={(e) => set(Number((e.target as HTMLInputElement).value))}
      />
      <button type="button" aria-label={`Una más de ${label}`} onClick={() => set(value + 1)}>
        +
      </button>
    </fieldset>
  );
}
