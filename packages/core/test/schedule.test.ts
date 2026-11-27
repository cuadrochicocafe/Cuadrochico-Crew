import { describe, expect, it } from 'vitest';
import {
  addDays,
  checkSlot,
  dayAvailability,
  defaultSettings,
  firstOrderableDate,
  leadTimeHoursFor,
  leadTimeMessage,
  localDate,
  type Settings,
  SettingsSchema,
  slotProblemMessage,
  slotsFor,
  weekdayOf,
  zonedToUtc,
} from '../src';

const settings: Settings = structuredClone(defaultSettings);
// Viernes 27 de noviembre de 2026, 12:00 en Monterrey (UTC-6).
const now = new Date('2026-11-27T18:00:00Z');
const limited = { drinksPerSlot: 48, drinksPerDay: 150 };

describe('zonas horarias', () => {
  it('convierte hora local de Monterrey a UTC', () => {
    expect(zonedToUtc('2026-11-29', '12:00', 'America/Monterrey').toISOString()).toBe(
      '2026-11-29T18:00:00.000Z',
    );
  });
  it('obtiene la fecha local aunque en UTC ya sea otro día', () => {
    expect(localDate(new Date('2026-11-28T05:30:00Z'), 'America/Monterrey')).toBe('2026-11-27');
  });
  it('suma días cruzando meses y años', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(weekdayOf('2026-11-29')).toBe('sun');
  });
});

describe('slotsFor', () => {
  it('genera horarios cada 30 min; el último empieza media hora antes del cierre', () => {
    const s = slotsFor('2026-11-30', settings); // lunes 08:00–21:00
    expect(s[0]).toBe('08:00');
    expect(s.at(-1)).toBe('20:30');
    expect(s).toHaveLength(26);
  });
  it('no hay horarios en días cerrados', () => {
    expect(slotsFor('2026-12-25', settings)).toEqual([]);
  });
});

describe('dayAvailability', () => {
  it('bloquea lo que está a menos de 48 h', () => {
    const d = dayAvailability('2026-11-29', now, settings);
    expect(d.problem).toBeUndefined();
    expect(d.slots.find((s) => s.time === '11:30')).toMatchObject({ available: false, problem: 'too_soon' });
    expect(d.slots.find((s) => s.time === '12:00')).toMatchObject({ available: true });
    expect(dayAvailability('2026-11-28', now, settings).problem).toBe('too_soon');
  });

  it('sin capacidad configurada no hay límite de producción', () => {
    expect(settings.capacity).toBeNull();
    const d = dayAvailability('2026-11-30', now, settings, { perSlot: { '12:00': 900 }, perDay: 5000 }, 20);
    expect(d.slots.find((s) => s.time === '12:00')).toMatchObject({ available: true, remaining: null });
  });

  it('respeta la capacidad por horario y por día si se configura', () => {
    const settings: Settings = { ...structuredClone(defaultSettings), capacity: limited };
    const booked = { perSlot: { '12:00': 40 }, perDay: 100 };
    const d = dayAvailability('2026-11-30', now, settings, booked, 10);
    expect(d.slots.find((s) => s.time === '12:00')).toMatchObject({
      available: false,
      problem: 'slot_full',
      remaining: 8,
    });
    expect(d.slots.find((s) => s.time === '13:00')).toMatchObject({ available: true, remaining: 48 });
    const lleno = dayAvailability('2026-11-30', now, settings, { perSlot: {}, perDay: 145 }, 10);
    expect(lleno.problem).toBe('day_full');
  });

  it('no acepta fechas más allá del horizonte', () => {
    expect(dayAvailability(addDays('2026-11-27', 61), now, settings).problem).toBe('too_far');
  });
});

describe('checkSlot', () => {
  it('valida el horario exacto que elige el cliente', () => {
    expect(checkSlot('2026-11-30', '10:00', 12, now, settings)).toBeNull();
    expect(checkSlot('2026-11-30', '10:15', 12, now, settings)).toBe('invalid_slot');
    expect(checkSlot('2026-11-30', '21:00', 12, now, settings)).toBe('invalid_slot');
    expect(checkSlot('2026-12-25', '10:00', 12, now, settings)).toBe('closed');
    expect(checkSlot('2026-11-28', '10:00', 12, now, settings)).toBe('too_soon');
    const conLimite: Settings = { ...structuredClone(defaultSettings), capacity: limited };
    expect(checkSlot('2026-12-07', '10:00', 49, now, conLimite)).toBe('slot_full');
  });
});

describe('anticipación según tamaño del pedido', () => {
  it('24 bebidas piden 48 h; 25 piden una semana', () => {
    expect(leadTimeHoursFor(0, settings)).toBe(48);
    expect(leadTimeHoursFor(24, settings)).toBe(48);
    expect(leadTimeHoursFor(25, settings)).toBe(168);
  });

  it('checkSlot usa el nivel que corresponde a las bebidas del pedido', () => {
    expect(checkSlot('2026-11-29', '12:00', 24, now, settings)).toBeNull();
    expect(checkSlot('2026-11-29', '12:00', 25, now, settings)).toBe('too_soon');
    expect(checkSlot('2026-12-04', '11:30', 25, now, settings)).toBe('too_soon');
    expect(checkSlot('2026-12-04', '12:00', 25, now, settings)).toBeNull();
  });

  it('dayAvailability y firstOrderableDate también cambian al pasar de 24 bebidas', () => {
    expect(dayAvailability('2026-11-30', now, settings, undefined, 24).problem).toBeUndefined();
    expect(dayAvailability('2026-11-30', now, settings, undefined, 25).problem).toBe('too_soon');
    expect(firstOrderableDate(now, settings)).toBe('2026-11-29');
    expect(firstOrderableDate(now, settings, 24)).toBe('2026-11-29');
    expect(firstOrderableDate(now, settings, 25)).toBe('2026-12-04');
  });

  it('explica por qué cambian las fechas', () => {
    expect(leadTimeMessage(24, settings)).toBe(
      'Para tu pedido necesitamos al menos 2 días de anticipación. A partir de 25 bebidas necesitamos 7 días.',
    );
    expect(leadTimeMessage(25, settings)).toBe(
      'Para pedidos de 25 bebidas o más necesitamos al menos 7 días de anticipación.',
    );
    expect(slotProblemMessage('too_soon', settings, 25)).toBe(leadTimeMessage(25, settings));
  });

  it('el primer nivel debe empezar en 1 bebida y los niveles ir en orden', () => {
    const base = structuredClone(defaultSettings);
    expect(SettingsSchema.safeParse({ ...base, leadTimeTiers: [{ minDrinks: 6, hours: 48 }] }).success).toBe(
      false,
    );
    expect(
      SettingsSchema.safeParse({
        ...base,
        leadTimeTiers: [
          { minDrinks: 1, hours: 48 },
          { minDrinks: 1, hours: 168 },
        ],
      }).success,
    ).toBe(false);
  });
});

describe('firstOrderableDate', () => {
  it('es el primer día con algún horario después de las 48 h', () => {
    expect(firstOrderableDate(now, settings)).toBe('2026-11-29');
  });
});
