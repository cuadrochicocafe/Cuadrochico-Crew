import type { Settings, Weekday } from './schema';

/*
 * Fechas "locales" (YYYY-MM-DD) y horas (HH:MM) siempre en la zona del negocio.
 * Los instantes reales (Date / ISO UTC) solo se usan para comparar contra "ahora" y para guardar.
 */

const WEEKDAYS: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const pad = (n: number) => String(n).padStart(2, '0');

function parseDate(date: string): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number);
  return [y ?? 0, m ?? 0, d ?? 0];
}

/** Partes de un instante en una zona horaria. */
function zonedParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return {
    y: get('year'),
    m: get('month'),
    d: get('day'),
    h: get('hour'),
    min: get('minute'),
    s: get('second'),
  };
}

/** Minutos que la zona está adelante de UTC en ese instante (Monterrey: -360). */
function offsetMinutes(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

/** Convierte fecha y hora locales del negocio al instante UTC correspondiente. */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = parseDate(date);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh ?? 0, mm ?? 0);
  // Dos pasadas por si el offset cambia justo en esa fecha (horario de verano en otras zonas).
  let t = guess - offsetMinutes(new Date(guess), timeZone) * 60000;
  t = guess - offsetMinutes(new Date(t), timeZone) * 60000;
  return new Date(t);
}

/** Fecha local (YYYY-MM-DD) de un instante en la zona del negocio. */
export function localDate(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = parseDate(date);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function weekdayOf(date: string): Weekday {
  const [y, m, d] = parseDate(date);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] as Weekday;
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
const fromMin = (n: number) => `${pad(Math.floor(n / 60))}:${pad(n % 60)}`;

/** Horarios de entrega posibles de un día según las ventanas de atención, sin considerar ocupación. */
export function slotsFor(date: string, settings: Settings): string[] {
  if (settings.closedDates.includes(date)) return [];
  const windows = settings.hours[weekdayOf(date)] ?? [];
  const out: string[] = [];
  for (const [open, close] of windows)
    for (let t = toMin(open); t + settings.slotMinutes <= toMin(close); t += settings.slotMinutes)
      out.push(fromMin(t));
  return out;
}

/** Bebidas ya comprometidas en una fecha: por horario (HH:MM) y total del día. */
export interface Booked {
  perSlot: Record<string, number>;
  perDay: number;
}

export const NO_BOOKINGS: Booked = { perSlot: {}, perDay: 0 };

export type SlotProblem = 'invalid_slot' | 'closed' | 'too_soon' | 'too_far' | 'slot_full' | 'day_full';

export interface SlotInfo {
  time: string;
  /** Bebidas que todavía caben en ese horario. */
  remaining: number;
  available: boolean;
  problem?: SlotProblem;
}

export interface DayAvailability {
  date: string;
  slots: SlotInfo[];
  /** Si el día completo no se puede elegir, por qué. */
  problem?: SlotProblem;
}

function earliestInstant(now: Date, settings: Settings): number {
  return now.getTime() + settings.leadTimeHours * 3600_000;
}

function lastDate(now: Date, settings: Settings): string {
  return addDays(localDate(now, settings.timezone), settings.maxDaysAhead);
}

/** Disponibilidad de un día para un pedido de `drinks` bebidas. */
export function dayAvailability(
  date: string,
  now: Date,
  settings: Settings,
  booked: Booked = NO_BOOKINGS,
  drinks = 0,
): DayAvailability {
  if (date > lastDate(now, settings)) return { date, slots: [], problem: 'too_far' };
  const times = slotsFor(date, settings);
  if (!times.length) return { date, slots: [], problem: 'closed' };

  const earliest = earliestInstant(now, settings);
  const dayLeft = settings.capacity.drinksPerDay - booked.perDay;
  const slots = times.map((time): SlotInfo => {
    const remaining = Math.max(
      0,
      Math.min(settings.capacity.drinksPerSlot - (booked.perSlot[time] ?? 0), dayLeft),
    );
    let problem: SlotProblem | undefined;
    if (zonedToUtc(date, time, settings.timezone).getTime() < earliest) problem = 'too_soon';
    else if (dayLeft < Math.max(drinks, 1)) problem = 'day_full';
    else if (remaining < Math.max(drinks, 1)) problem = 'slot_full';
    return problem ? { time, remaining, available: false, problem } : { time, remaining, available: true };
  });

  if (slots.some((s) => s.available)) return { date, slots };
  const problem = slots.every((s) => s.problem === 'too_soon')
    ? 'too_soon'
    : slots.some((s) => s.problem === 'day_full')
      ? 'day_full'
      : 'slot_full';
  return { date, slots, problem };
}

/** Valida el horario exacto que eligió el cliente. `null` si está bien. */
export function checkSlot(
  date: string,
  time: string,
  drinks: number,
  now: Date,
  settings: Settings,
  booked: Booked = NO_BOOKINGS,
): SlotProblem | null {
  const day = dayAvailability(date, now, settings, booked, drinks);
  if (day.problem === 'too_far' || day.problem === 'closed') return day.problem;
  const slot = day.slots.find((s) => s.time === time);
  if (!slot) return 'invalid_slot';
  return slot.available ? null : (slot.problem ?? 'invalid_slot');
}

/** Primera fecha local en la que podría haber algún horario disponible (ignorando ocupación). */
export function firstOrderableDate(now: Date, settings: Settings): string | null {
  const end = lastDate(now, settings);
  for (let d = localDate(now, settings.timezone); d <= end; d = addDays(d, 1)) {
    const day = dayAvailability(d, now, settings);
    if (!day.problem) return d;
  }
  return null;
}

export function slotProblemMessage(p: SlotProblem, settings: Settings): string {
  switch (p) {
    case 'invalid_slot':
      return 'Ese horario no existe. Elige otro de la lista.';
    case 'closed':
      return 'Ese día no hacemos entregas. Elige otra fecha.';
    case 'too_soon':
      return `Necesitamos al menos ${settings.leadTimeHours} horas para preparar tu pedido.`;
    case 'too_far':
      return `Solo tomamos pedidos con hasta ${settings.maxDaysAhead} días de anticipación.`;
    case 'slot_full':
      return 'Ese horario ya no tiene lugar para tantas bebidas. Prueba otro horario.';
    case 'day_full':
      return 'Ese día ya llegamos a nuestra capacidad de preparación. Prueba otra fecha.';
  }
}
