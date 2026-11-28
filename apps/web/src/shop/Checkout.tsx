import {
  type ApiError,
  chargeFor,
  type DayAvailability,
  formatMXN,
  leadTimeMessage,
  nonRefundableNotice,
  type PaymentMethod,
  type PaymentPlan,
  type Quote,
  type Settings,
  type SlotProblem,
  slotProblemMessage,
} from '@cuadrochico/core';
import { useEffect, useRef, useState } from 'preact/hooks';
import { apiErrorMessage } from '../api';
import { CancellationPolicy } from '../components/CancellationPolicy';
import { Lines } from '../components/Lines';
import { Totals } from '../components/Totals';
import { contactLink, focusSoon, formatLocalDate, plural } from '../lib';
import { type CheckoutField, checkoutIssues } from '../order/cart';
import { mountTurnstile, TURNSTILE_SITE_KEY } from '../turnstile';
import { type CustomerDraft, validateCustomer } from './customer';
import { DateCalendar } from './DateCalendar';

export type AvailabilityState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; days: DayAvailability[] };

type Slot = { date: string; time: string };

interface Props {
  settings: Settings;
  quote: Quote;
  drinks: number;
  availability: AvailabilityState;
  notices: string[];
  onRetryAvailability: () => void;
  slot: Slot | null;
  onSlot: (s: Slot | null) => void;
  draft: CustomerDraft;
  onDraft: (d: CustomerDraft) => void;
  plan: PaymentPlan | null;
  onPlan: (p: PaymentPlan) => void;
  method: PaymentMethod | null;
  onMethod: (m: PaymentMethod) => void;
  submitting: boolean;
  submitError: ApiError | null;
  onSubmit: (captchaToken: string | undefined) => void;
  onEditCart: () => void;
  onBack: () => void;
  /** Instante de referencia para el aviso de no reembolsable (inyectable en pruebas). */
  now?: Date;
}

const METHOD_TEXT: Record<PaymentMethod, { title: string; detail: string }> = {
  transfer: { title: 'Transferencia SPEI', detail: 'Te damos la CLABE al confirmar. Sin comisión.' },
  mercadopago: { title: 'Mercado Pago', detail: 'Tarjeta, OXXO o SPEI.' },
};

const FIELD_ID: Record<CheckoutField, string> = {
  slot: 'sec-when',
  name: 'f-name',
  phone: 'f-phone',
  email: 'f-email',
  address: 'f-address',
  plan: 'sec-plan',
  method: 'sec-method',
};

/** Razones neutrales y sin repetir. La anticipación ya se explica arriba, así que no se repite aquí. */
function reasons(problems: (SlotProblem | undefined)[], settings: Settings, drinks: number): string[] {
  const set = new Set(problems.filter((p): p is SlotProblem => !!p && p !== 'too_soon'));
  return [...set].map((p) => slotProblemMessage(p, settings, drinks));
}

export function Checkout(props: Props) {
  const { settings, quote, drinks, availability, slot, draft, plan, method, submitting, submitError, now } =
    props;
  const [tried, setTried] = useState(false);
  const [pickedDate, setPickedDate] = useState<string | null>(slot?.date ?? null);
  const [token, setToken] = useState<string | null>(null);
  const [captchaFailed, setCaptchaFailed] = useState(false);
  const [captchaMsg, setCaptchaMsg] = useState<string | null>(null);
  const widget = useRef<HTMLDivElement>(null);

  const days = availability.status === 'ready' ? availability.days : [];
  const day = days.find((d) => d.date === pickedDate && !d.problem);
  const customerErrors = validateCustomer(draft);
  const methods = (['transfer', 'mercadopago'] as const).filter((m) => settings.payments[m].enabled);
  const issues = checkoutIssues({ slot, customerErrors, plan, method });
  const show = (f: CheckoutField) => tried && issues.includes(f);
  const charge = plan ? chargeFor(quote, plan) : null;
  const notice = slot ? nonRefundableNotice(slot, now ?? new Date(), settings) : null;
  const contact = contactLink(settings);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !widget.current) return;
    return mountTurnstile(widget.current, setToken, () => setCaptchaFailed(true));
  }, []);
  useEffect(() => {
    if (submitError) focusSoon('submit-error');
  }, [submitError]);
  // Con una sola forma de pago activa no hay nada que elegir; con varias, nada viene preseleccionado.
  const only = methods.length === 1 ? methods[0] : undefined;
  useEffect(() => {
    if (only && method !== only) props.onMethod(only);
  }, [only]);

  const pickDate = (date: string) => {
    setPickedDate(date);
    const keep = days.find((x) => x.date === date)?.slots.find((s) => s.time === slot?.time && s.available);
    props.onSlot(keep ? { date, time: keep.time } : null);
  };

  const set = (k: keyof CustomerDraft) => (e: Event) =>
    props.onDraft({ ...draft, [k]: (e.target as HTMLInputElement).value });

  const submit = () => {
    setTried(true);
    const first = issues[0];
    if (first) {
      focusSoon(FIELD_ID[first]);
      return;
    }
    if (TURNSTILE_SITE_KEY && !token) {
      setCaptchaMsg(
        captchaFailed
          ? 'No pudimos verificar que no eres un robot.'
          : 'Estamos verificando la conexión; inténtalo en unos segundos.',
      );
      focusSoon('submit-error');
      return;
    }
    setCaptchaMsg(null);
    props.onSubmit(token ?? undefined);
  };

  const field = (
    k: 'name' | 'phone' | 'email',
    label: string,
    attrs: Record<string, unknown>,
    hint?: string,
  ) => {
    const err = show(k) ? customerErrors[k] : undefined;
    return (
      <div class="field">
        <label for={`f-${k}`}>{label}</label>
        <input
          id={`f-${k}`}
          value={draft[k]}
          onInput={set(k)}
          aria-invalid={err ? true : undefined}
          aria-describedby={
            [hint ? `f-${k}-hint` : '', err ? `f-${k}-error` : ''].join(' ').trim() || undefined
          }
          {...attrs}
        />
        {hint && (
          <p id={`f-${k}-hint`} class="muted small">
            {hint}
          </p>
        )}
        {err && (
          <p id={`f-${k}-error`} class="field-error">
            {err}
          </p>
        )}
      </div>
    );
  };

  return (
    <div class="checkout">
      <div class="checkout-top">
        <button type="button" class="back" onClick={props.onBack}>
          ‹ Seguir comprando
        </button>
        <h2>Finaliza tu pedido</h2>
        <button type="button" class="summary-pill" onClick={props.onEditCart}>
          {plural(drinks, 'bebida', 'bebidas')} · {formatMXN(quote.totalCents)} <span>Editar</span>
        </button>
      </div>

      {/* 1. Cuándo */}
      <section class="block" id="sec-when" tabIndex={-1} aria-labelledby="when-title">
        <h3 id="when-title">
          <span class="num">1</span> ¿Cuándo lo recoges?
        </h3>
        <p class="muted small" id="lead-time">
          {leadTimeMessage(drinks, settings)}
        </p>
        {props.notices.map((n) => (
          <p key={n} class="notice" role="status">
            {n}
          </p>
        ))}
        {availability.status === 'loading' && <p aria-live="polite">Cargando fechas…</p>}
        {availability.status === 'error' && (
          <div role="alert" class="error">
            <p>{availability.message}</p>
            <button type="button" class="btn small" onClick={props.onRetryAvailability}>
              Intentar de nuevo
            </button>
          </div>
        )}
        {availability.status === 'ready' && (
          <>
            <fieldset class="bare" aria-describedby="lead-time date-reasons">
              <legend class="sr-only">Fecha</legend>
              <DateCalendar
                days={days}
                picked={pickedDate}
                onPick={pickDate}
                note={(visible) => (
                  <ul id="date-reasons" class="reasons">
                    {reasons(
                      visible.map((d) => d.problem),
                      settings,
                      drinks,
                    ).map((r) => (
                      <li key={r}>Días sin elegir: {r}</li>
                    ))}
                  </ul>
                )}
              />
            </fieldset>
            {day && (
              <fieldset class="bare" aria-describedby="time-reasons">
                <legend class="sub">Hora · {formatLocalDate(day.date)}</legend>
                <div class="time-grid">
                  {day.slots.map((s) => (
                    <label key={s.time} class={s.available ? 'time' : 'time off'}>
                      <input
                        type="radio"
                        name="time"
                        value={s.time}
                        disabled={!s.available}
                        checked={slot?.time === s.time && slot.date === day.date}
                        onChange={() => props.onSlot({ date: day.date, time: s.time })}
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
                    <li key={r}>Horarios sin elegir: {r}</li>
                  ))}
                </ul>
              </fieldset>
            )}
          </>
        )}
        <p class="pickup small">
          Recoges en <strong>{settings.fulfillment.pickup.address}</strong>{' '}
          <a href={settings.fulfillment.pickup.mapsUrl} target="_blank" rel="noopener noreferrer">
            Ver mapa<span class="sr-only"> (se abre en otra pestaña)</span>
          </a>
        </p>
        {show('slot') && (
          <p class="field-error">{pickedDate ? 'Elige una hora.' : 'Elige el día y la hora.'}</p>
        )}
      </section>

      {/* 2. Datos */}
      <section class="block" aria-labelledby="data-title">
        <h3 id="data-title">
          <span class="num">2</span> Tus datos
        </h3>
        {field('name', 'Nombre', { autoComplete: 'name', maxLength: 80 })}
        {field(
          'phone',
          'Teléfono (WhatsApp)',
          { type: 'tel', inputMode: 'tel', autoComplete: 'tel' },
          'Te escribimos solo sobre este pedido.',
        )}
        {field('email', 'Correo (opcional)', { type: 'email', autoComplete: 'email' })}
        <details class="notes" open={!!draft.notes}>
          <summary>Agregar una nota para el equipo</summary>
          <label class="sr-only" for="f-notes">
            Nota para el equipo
          </label>
          <textarea id="f-notes" value={draft.notes} onInput={set('notes')} maxLength={500} rows={3} />
        </details>
      </section>

      {/* 3. Pago */}
      <section class="block" aria-labelledby="pay-title">
        <h3 id="pay-title">
          <span class="num">3</span> ¿Cómo quieres pagar?
        </h3>
        {methods.length === 0 ? (
          <p class="notice" role="status">
            Por ahora no podemos recibir pagos en línea. Escríbenos y terminamos tu pedido por chat:{' '}
            <a href={contact.href} target="_blank" rel="noopener noreferrer">
              {contact.label}
              <span class="sr-only"> (se abre en otra pestaña)</span>
            </a>
          </p>
        ) : (
          <>
            <fieldset class="bare" id="sec-plan" tabIndex={-1}>
              <legend class="sub">¿Cuánto pagas ahora?</legend>
              <div class="cards">
                {(['deposit', 'full'] as const).map((p) => {
                  const c = chargeFor(quote, p);
                  return (
                    <label key={p} class="option">
                      <input type="radio" name="plan" checked={plan === p} onChange={() => props.onPlan(p)} />
                      <span>
                        <strong>
                          {p === 'full' ? 'Liquidar todo' : `Anticipo ${settings.depositPercent} %`}
                        </strong>
                        <span class="big">{formatMXN(c.dueNowCents)}</span>
                        <span class="muted small">
                          {c.balanceCents > 0 ? `${formatMXN(c.balanceCents)} al recoger` : 'Nada al recoger'}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
              {show('plan') && <p class="field-error">Elige anticipo o liquidar todo.</p>}
            </fieldset>
            <fieldset class="bare" id="sec-method" tabIndex={-1}>
              <legend class="sub">Forma de pago</legend>
              <div class="cards">
                {methods.map((m) => (
                  <label key={m} class="option">
                    <input
                      type="radio"
                      name="method"
                      checked={method === m}
                      onChange={() => props.onMethod(m)}
                    />
                    <span>
                      <strong>{METHOD_TEXT[m].title}</strong>
                      <span class="muted small">{METHOD_TEXT[m].detail}</span>
                    </span>
                  </label>
                ))}
              </div>
              {show('method') && <p class="field-error">Elige cómo quieres pagar.</p>}
            </fieldset>
          </>
        )}
      </section>

      {/* Resumen */}
      <section class="block" aria-labelledby="sum-title">
        <h3 id="sum-title">Resumen</h3>
        <Lines lines={quote.lines} />
        <Totals quote={quote} depositPercent={settings.depositPercent} plan={plan} />
        {notice && (
          <p class="warning" role="note" data-testid="non-refundable">
            <strong>{notice}</strong> Lo pides con menos de {settings.cancellationHours} horas de
            anticipación.
          </p>
        )}
        <CancellationPolicy settings={settings} />
      </section>

      <div ref={widget} class="turnstile" />

      {(submitError || captchaMsg) && (
        <div id="submit-error" class="error" role="alert" tabIndex={-1}>
          <p>{captchaMsg ?? (submitError && apiErrorMessage(submitError))}</p>
          {submitError?.error === 'slot' && (
            <button type="button" class="btn small" onClick={() => focusSoon('sec-when')}>
              Elegir otro horario
            </button>
          )}
          {submitError?.error === 'quote' && (
            <button type="button" class="btn small" onClick={props.onEditCart}>
              Revisar bebidas
            </button>
          )}
          {(captchaFailed || submitError?.error === 'captcha') && (
            <p>
              También tomamos tu pedido por chat:{' '}
              <a href={contact.href} target="_blank" rel="noopener noreferrer">
                {contact.label}
              </a>
            </p>
          )}
        </div>
      )}

      {methods.length > 0 && (
        <div class="pay-bar">
          <div class="pay-bar-text">
            <span class="muted small">{charge ? 'Pagas ahora' : 'Total'}</span>
            <strong>{formatMXN(charge ? charge.dueNowCents : quote.totalCents)}</strong>
          </div>
          <button
            type="button"
            class="btn primary"
            onClick={submit}
            disabled={submitting}
            aria-busy={submitting}
          >
            {submitting ? 'Enviando…' : 'Confirmar pedido'}
          </button>
        </div>
      )}
      {tried && issues.length > 0 && (
        <p class="sr-only" role="alert">
          Falta completar {issues.length === 1 ? 'un dato' : `${issues.length} datos`} antes de confirmar.
        </p>
      )}
    </div>
  );
}
