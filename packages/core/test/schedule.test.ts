import { describe, expect, it } from 'vitest';
import {
  addDays,
  checkSlot,
  dayAvailability,
  defaultSettings,
  firstOrderableDate,
  localDate,
  type Settings,
  slotsFor,
  weekdayOf,
  zonedToUtc,
} from '../src';

const settings: Settings = structuredClone(defaultSettings);
// Viernes 27 de noviembre de 2026, 12:00 en Monterrey (UTC-6).
const now = new Date('2026-11-27T18:00:00Z');

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

  it('respeta la capacidad por horario y por día', () => {
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
    expect(checkSlot('2026-11-30', '10:00', 49, now, settings)).toBe('slot_full');
  });
});

describe('firstOrderableDate', () => {
  it('es el primer día con algún horario después de las 48 h', () => {
    expect(firstOrderableDate(now, settings)).toBe('2026-11-29');
  });
});
