import type { DayAvailability } from '@cuadrochico/core';
import { useState } from 'preact/hooks';
import { formatLocalDate } from '../lib';

const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

const monthOf = (date: string) => date.slice(0, 7);

/** Días del mes "YYYY-MM" como "YYYY-MM-DD", más cuántas celdas vacías van antes (semana empieza en lunes). */
function monthGrid(month: string): { blanks: number; dates: string[] } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1, 1));
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dates = Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
  return { blanks: (first.getUTCDay() + 6) % 7, dates };
}

interface Props {
  days: DayAvailability[];
  picked: string | null;
  onPick: (date: string) => void;
}

/** Calendario de un mes con flechas. Cada día elegible es un radio `name="date"`. */
export function DateCalendar({ days, picked, onPick }: Props) {
  const months = [...new Set(days.map((d) => monthOf(d.date)))];
  const firstOpen = days.find((d) => !d.problem)?.date;
  const [month, setMonth] = useState(
    () => (picked && monthOf(picked)) ?? (firstOpen && monthOf(firstOpen)) ?? months[0] ?? '',
  );
  const i = months.indexOf(month);
  if (!month || i < 0) return null;

  const byDate = new Map(days.map((d) => [d.date, d]));
  const { blanks, dates } = monthGrid(month);
  const title = `${formatLocalDate(`${month}-01`, { weekday: undefined, day: undefined })} ${month.slice(0, 4)}`;

  return (
    <div class="cal">
      <div class="cal-head">
        <button
          type="button"
          class="cal-nav"
          aria-label="Mes anterior"
          disabled={i === 0}
          onClick={() => setMonth(months[i - 1] ?? month)}
        >
          ‹
        </button>
        <p class="cal-title" aria-live="polite">
          {title}
        </p>
        <button
          type="button"
          class="cal-nav"
          aria-label="Mes siguiente"
          disabled={i === months.length - 1}
          onClick={() => setMonth(months[i + 1] ?? month)}
        >
          ›
        </button>
      </div>
      <div class="cal-grid">
        {WEEKDAYS.map((w, k) => (
          <span key={`w${k}`} class="cal-dow" aria-hidden="true">
            {w}
          </span>
        ))}
        {Array.from({ length: blanks }, (_, k) => (
          <span key={`b${k}`} />
        ))}
        {dates.map((date) => {
          const d = byDate.get(date);
          const n = Number(date.slice(8));
          if (!d)
            return (
              <span key={date} class="cal-day out" aria-hidden="true">
                {n}
              </span>
            );
          return (
            <label key={date} class={d.problem ? 'cal-day off' : 'cal-day'}>
              <input
                type="radio"
                name="date"
                value={date}
                disabled={!!d.problem}
                checked={picked === date}
                onChange={() => onPick(date)}
              />
              <span aria-hidden="true">{n}</span>
              <span class="sr-only">{formatLocalDate(date)}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
