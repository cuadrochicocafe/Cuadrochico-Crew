import type { OrderStatus, PublicSettings, Settings } from '@cuadrochico/core';

/**
 * Las funciones de core piden `Settings`, pero el catálogo público no trae datos bancarios.
 * Ninguna regla que usa la web lee `payments.transfer.*` salvo `enabled`, así que se rellenan vacíos.
 */
export function toCoreSettings(s: PublicSettings): Settings {
  return {
    ...s,
    payments: {
      transfer: { enabled: s.payments.transfer.enabled, bank: '', beneficiary: '', clabe: '' },
      mercadopago: { enabled: s.payments.mercadopago.enabled },
    },
  };
}

/** "sábado 12 de diciembre" a partir de una fecha local YYYY-MM-DD. */
export function formatLocalDate(date: string, opts: Intl.DateTimeFormatOptions = {}): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...opts,
  }).format(new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1, 12)));
}

/** Instante ISO en la zona del negocio: "martes 8 de diciembre, 14:30". */
export function formatInstant(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

/** Enfoca un elemento después del próximo render (p. ej. un mensaje de error recién mostrado). */
export function focusSoon(id: string): void {
  setTimeout(() => document.getElementById(id)?.focus());
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const STATUS_LABEL: Record<OrderStatus, string> = {
  pending_payment: 'Esperando tu pago',
  confirmed: 'Pago recibido · en preparación',
  ready: 'Listo para recoger',
  completed: 'Entregado',
  cancelled: 'Cancelado',
  expired: 'Vencido: no recibimos el pago a tiempo',
};

/** Enlace de respaldo para pedir por chat: WhatsApp si está configurado; si no, Instagram. */
export function contactLink(s: Pick<Settings, 'contact'>): { href: string; label: string } {
  const wa = s.contact.whatsapp.replace(/\D/g, '');
  if (wa) {
    const number = wa.length === 10 ? `52${wa}` : wa;
    return { href: `https://wa.me/${number}`, label: 'Escríbenos por WhatsApp' };
  }
  return {
    href: `https://instagram.com/${s.contact.instagram}`,
    label: `Escríbenos por Instagram (@${s.contact.instagram})`,
  };
}
