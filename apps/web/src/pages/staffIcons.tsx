/** Íconos de línea con el mismo trazo que los de la app del equipo (viewBox 48, stroke 2.4). Decorativos: el texto siempre acompaña. */
import type { ComponentChildren } from 'preact';

function Icon({ children, size = 18 }: { children: ComponentChildren; size?: number }) {
  return (
    <svg
      class="s-ico"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      stroke-width="3.2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** Falta pagar: moneda. */
export const IconPay = () => (
  <Icon>
    <circle cx="24" cy="24" r="17" />
    <path d="M29 17.5c-1.2-1.6-3-2.5-5-2.5-3 0-5 1.8-5 4.2 0 5.6 10.5 3.2 10.5 9 0 2.5-2.3 4.3-5.5 4.3-2.3 0-4.3-1-5.5-2.7M24 11v4M24 33v4" />
  </Icon>
);
/** Por preparar: vaso. */
export const IconCup = () => (
  <Icon>
    <path d="M13 15h22l-3 27H16Z" />
    <path d="M11 9h26v6H11zM27 9l3-5M18 25h12" />
  </Icon>
);
/** Listo para entregar: bolsa. */
export const IconBag = () => (
  <Icon>
    <path d="M9 17h30l-2.5 25h-25Z" />
    <path d="M17 17v-3a7 7 0 0 1 14 0v3M18 30l4 4 8-8" />
  </Icon>
);
/** Entregado: palomita. */
export const IconCheck = () => (
  <Icon>
    <circle cx="24" cy="24" r="17" />
    <path d="M16 24.5l5.5 5.5L32 19" />
  </Icon>
);
/** Cancelado o vencido: tache. */
export const IconCancel = () => (
  <Icon>
    <circle cx="24" cy="24" r="17" />
    <path d="M18 18l12 12M30 18 18 30" />
  </Icon>
);
/** Lista completa. */
export const IconList = () => (
  <Icon>
    <path d="M18 13h20M18 24h20M18 35h20M10 13h.01M10 24h.01M10 35h.01" />
  </Icon>
);
export const IconClock = () => (
  <Icon>
    <circle cx="24" cy="24" r="17" />
    <path d="M24 14v10l6 4" />
  </Icon>
);
export const IconPhone = () => (
  <Icon size={16}>
    <path d="M14 7h-4a3 3 0 0 0-3 3c0 17 14 31 31 31a3 3 0 0 0 3-3v-4l-8-4-4 4c-5-2-9-6-11-11l4-4Z" />
  </Icon>
);
export const IconNote = () => (
  <Icon size={16}>
    <path d="M12 6h18l8 8v28H12Z" />
    <path d="M30 6v8h8M18 24h14M18 32h10" />
  </Icon>
);
export const IconAlert = () => (
  <Icon size={16}>
    <path d="M24 7 43 40H5Z" />
    <path d="M24 19v10M24 34h.01" />
  </Icon>
);
