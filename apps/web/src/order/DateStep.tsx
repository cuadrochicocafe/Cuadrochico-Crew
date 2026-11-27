import {
  type DayAvailability,
  leadTimeMessage,
  type Settings,
  type SlotProblem,
  slotProblemMessage,
} from '@cuadrochico/core';
import { useState } from 'preact/hooks';
import { focusSoon, formatLocalDate } from '../lib';

export type AvailabilityState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; days: DayAvailability[] };

interface Props {
  settings: Settings;
  drinks: number;
  availability: AvailabilityState;
  /** Aviso cuando cambió la anticipación (p. ej. de 24 a 25 bebidas) o el horario elegido dejó de servir. */
  notices: string[];
  slot: { date: string; time: string } | null;
  onSlot: (slot: { date: string; time: string } | null) => void;
  onRetry: () => void;
  onBack: () => void;
  onContinue: () => void;
}

/** Explicaciones neutrales y sin repetir de por qué no se pueden elegir algunas opciones. */
function reasons(problems: (SlotProblem | undefined)[], settings: Settings, drinks: number): string[] {
  const set = new Set(problems.filter((p): p is SlotProblem => !!p));
  return [...set].map((p) => slotProblemMessage(p, settings, drinks));
}

export function DateStep({
  settings,
  drinks,
  availability,
  notices,
  slot,
  onSlot,
  onRetry,
  onBack,
  onContinue,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [pickedDate, setPickedDate] = useState<string | null>(slot?.date ?? null);
  const days = availability.status === 'ready' ? availability.days : [];
  const day = days.find((d) => d.date === pickedDate && !d.problem);

  const next = () => {
    if (!slot) {
      setError(day ? 'Elige una hora de entrega.' : 'Elige la fecha y la hora de entrega.');
      focusSoon('date-error');
      return;
    }
    onContinue();
  };

  const pickDate = (date: string) => {
    setPickedDate(date);
    const keep = days.find((x) => x.date === date)?.slots.find((s) => s.time === slot?.time && s.available);
    onSlot(keep ? { date, time: keep.time } : null);
    setError(null);
  };

  return (
    <>
      <p class="info" id="lead-time">
        {leadTimeMessage(drinks, settings)}
      </p>
      {notices.map((n) => (
        <p key={n} class="notice" role="status">
          {n}
        </p>
      ))}

      {availability.status === 'loading' && <p aria-live="polite">Cargando fechas disponibles…</p>}
      {availability.status === 'error' && (
        <div role="alert" class="error">
          <p>{availability.message}</p>
          <button type="button" class="btn" onClick={onRetry}>
            Intentar de nuevo
          </button>
        </div>
      )}

      {availability.status === 'ready' && (
        <>
          <fieldset class="dates" aria-describedby="lead-time date-reasons">
            <legend>Fecha de entrega</legend>
            <div class="date-grid">
              {days.map((d) => {
                const open = !d.problem;
                return (
                  <label key={d.date} class={open ? 'date' : 'date off'}>
                    <input
                      type="radio"
                      name="date"
                      value={d.date}
                      disabled={!open}
                      checked={pickedDate === d.date}
                      onChange={() => pickDate(d.date)}
                    />
                    <span>
                      <span class="dow">{formatLocalDate(d.date, { day: undefined, month: undefined })}</span>{' '}
                      <span class="dnum">
                        {formatLocalDate(d.date, { weekday: undefined, month: 'short' })}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
            <ul id="date-reasons" class="reasons">
              {reasons(
                days.map((d) => d.problem),
                settings,
                drinks,
              ).map((r) => (
                <li key={r}>Algunas fechas no se pueden elegir: {r}</li>
              ))}
            </ul>
          </fieldset>

          {day && (
            <fieldset class="times" aria-describedby="time-reasons">
              <legend>Hora de entrega el {formatLocalDate(day.date)}</legend>
              <div class="time-grid">
                {day.slots.map((s) => (
                  <label key={s.time} class={s.available ? 'time' : 'time off'}>
                    <input
                      type="radio"
                      name="time"
                      value={s.time}
                      disabled={!s.available}
                      checked={slot?.time === s.time}
                      onChange={() => {
                        onSlot({ date: day.date, time: s.time });
                        setError(null);
                      }}
                    />
                    <span>{s.time}</span>
                  </label>
                ))}
              </div>
              <ul id="time-reasons" class="reasons">
                {reasons(
                  day.slots.map((s) => s.problem),
                  settings,
                  drinks,
                ).map((r) => (
                  <li key={r}>Algunos horarios no se pueden elegir: {r}</li>
                ))}
              </ul>
            </fieldset>
          )}
        </>
      )}

      {error && (
        <p id="date-error" class="error" role="alert" tabIndex={-1}>
          {error}
        </p>
      )}
      <div class="nav">
        <button type="button" class="btn" onClick={onBack}>
          Atrás
        </button>
        <button type="button" class="btn primary" onClick={next}>
          Continuar
        </button>
      </div>
    </>
  );
}
