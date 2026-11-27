import type { ApiError, Menu, PaymentMethod, PaymentPlan, Settings } from '@cuadrochico/core';
import { useEffect, useRef, useState } from 'preact/hooks';
import { api, toApiError } from '../api';
import { navigate } from '../router';
import { BuildStep } from './BuildStep';
import {
  type CartLine,
  canEnter,
  drinkCount,
  furthestStep,
  leadTimeChangeNotice,
  quoteCart,
  STEP_TITLES,
  STEPS,
  type Step,
  toOrderLines,
} from './cart';
import { type CustomerDraft, DataStep, EMPTY_CUSTOMER, validateCustomer } from './DataStep';
import { type AvailabilityState, DateStep } from './DateStep';
import { PaymentStep } from './PaymentStep';
import { ReviewStep } from './ReviewStep';

type Slot = { date: string; time: string };

/** Borrador del pedido en esta pestaña: sobrevive a una recarga y se borra al cerrar la pestaña o al pedir. */
export const DRAFT_KEY = 'cc:pedido-borrador';
interface SavedDraft {
  cart: CartLine[];
  slot: Slot | null;
  draft: CustomerDraft;
  plan: PaymentPlan | null;
  method: PaymentMethod | null;
}
function loadDraft(): Partial<SavedDraft> {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    const v: unknown = raw ? JSON.parse(raw) : null;
    return v && typeof v === 'object' ? (v as Partial<SavedDraft>) : {};
  } catch {
    return {};
  }
}
function saveDraft(d: SavedDraft | null): void {
  try {
    if (d) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Sin almacenamiento (modo privado, bloqueado): el pedido funciona igual, solo no se recupera al recargar.
  }
}

const isStep = (v: unknown): v is Step => typeof v === 'string' && (STEPS as readonly string[]).includes(v);

export function OrderFlow({ menu, settings }: { menu: Menu; settings: Settings }) {
  const [saved] = useState(loadDraft);
  const [step, setStep] = useState<Step>(() => {
    const s: unknown = (history.state as { step?: unknown } | null)?.step;
    return isStep(s) ? s : 'build';
  });
  const [cart, setCart] = useState<CartLine[]>(() => (Array.isArray(saved.cart) ? saved.cart : []));
  const [slot, setSlot] = useState<Slot | null>(saved.slot ?? null);
  const [draft, setDraft] = useState<CustomerDraft>({ ...EMPTY_CUSTOMER, ...(saved.draft ?? {}) });
  const [plan, setPlan] = useState<PaymentPlan | null>(saved.plan ?? null);
  const [method, setMethod] = useState<PaymentMethod | null>(saved.method ?? null);
  const [availability, setAvailability] = useState<AvailabilityState>({ status: 'loading' });
  /** Número de bebidas con el que se cargaron las fechas; si cambia, se vuelven a pedir. */
  const [availDrinks, setAvailDrinks] = useState<number | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<ApiError | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const slotRef = useRef(slot);
  slotRef.current = slot;

  const drinks = drinkCount(cart);
  const cartQuote = quoteCart(cart, menu, settings, draft.fulfillment);
  const fullQuote = slot ? quoteCart(cart, menu, settings, draft.fulfillment, slot.date) : cartQuote;
  const progress = {
    quoteOk: cartQuote.ok,
    slot,
    customerValid: Object.keys(validateCustomer(draft)).length === 0,
    plan,
  };
  // Nunca se muestra un paso cuyos requisitos no se cumplen (p. ej. datos sin total, o pago sin plan).
  const current: Step = canEnter(step, progress) ? step : furthestStep(progress);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    window.scrollTo(0, 0);
    heading.current?.focus();
  }, [current]);

  const loadAvailability = (count: number, previous: number | null) => {
    setAvailability({ status: 'loading' });
    api
      .availability(count)
      .then(({ days }) => {
        const found: string[] = [];
        const change = leadTimeChangeNotice(previous, count, settings);
        if (change) found.push(change);
        const s = slotRef.current;
        if (s && !days.find((d) => d.date === s.date)?.slots.find((x) => x.time === s.time)?.available) {
          found.push(
            'El horario que habías elegido ya no está disponible para un pedido de este tamaño. Elige otro.',
          );
          setSlot(null);
        }
        setNotices(found);
        setAvailability({ status: 'ready', days });
        setAvailDrinks(count);
      })
      .catch((e: unknown) => {
        const err = toApiError(e);
        setAvailability({
          status: 'error',
          message: 'message' in err ? err.message : 'No pudimos cargar las fechas.',
        });
      });
  };

  useEffect(() => {
    if (current === 'date' && availDrinks !== drinks) loadAvailability(drinks, availDrinks);
  }, [current, drinks]);

  useEffect(() => {
    if (!submitting) saveDraft({ cart, slot, draft, plan, method });
  }, [cart, slot, draft, plan, method, submitting]);

  // Cada paso queda en el historial: el botón "atrás" del navegador regresa al paso anterior.
  useEffect(() => {
    if (!isStep((history.state as { step?: unknown } | null)?.step))
      history.replaceState({ step: current }, '', location.href);
    const onPop = (e: PopStateEvent) => {
      const s: unknown = (e.state as { step?: unknown } | null)?.step;
      setSubmitError(null);
      setStep(isStep(s) ? s : 'build');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const go = (s: Step) => {
    setSubmitError(null);
    if (s !== current) history.pushState({ step: s }, '', location.href);
    setStep(s);
  };
  const back = () => {
    if (STEPS.indexOf(current) > 0 && isStep((history.state as { step?: unknown } | null)?.step))
      history.back();
    else go(STEPS[Math.max(0, STEPS.indexOf(current) - 1)] ?? 'build');
  };

  const submit = async (captchaToken: string | undefined) => {
    if (!slot || !plan || !method) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await api.createOrder({
        customer: { name: draft.name, phone: draft.phone, email: draft.email },
        fulfillment:
          draft.fulfillment === 'delivery'
            ? { type: 'delivery', address: draft.address, references: draft.references }
            : { type: 'pickup' },
        slot,
        lines: toOrderLines(cart),
        paymentMethod: method,
        paymentPlan: plan,
        notes: draft.notes,
        ...(captchaToken ? { captchaToken } : {}),
      });
      saveDraft(null);
      const url = `/pedido/${encodeURIComponent(res.order.code)}?t=${encodeURIComponent(res.accessToken)}`;
      if (res.payment.method === 'mercadopago') {
        // La página del pedido queda en el historial para regresar después de pagar.
        history.replaceState(null, '', url);
        window.location.assign(res.payment.checkoutUrl);
        return;
      }
      navigate(url, { replace: true });
    } catch (e) {
      const err = toApiError(e);
      if (err.error === 'slot') setAvailDrinks(null);
      setSubmitError(err);
      setSubmitting(false);
    }
  };

  const index = STEPS.indexOf(current);

  return (
    <div class="flow">
      <ol class="progress" aria-label="Pasos del pedido">
        {STEPS.map((s, i) => (
          <li
            key={s}
            class={i === index ? 'now' : i < index ? 'done' : ''}
            aria-current={i === index ? 'step' : undefined}
          >
            <span class="sr-only">{i < index ? 'Completado: ' : ''}</span>
            {STEP_TITLES[s]}
          </li>
        ))}
      </ol>
      <h2 ref={heading} tabIndex={-1} class="step-title">
        <span class="muted small">
          Paso {index + 1} de {STEPS.length}
        </span>{' '}
        {STEP_TITLES[current]}
      </h2>

      {current === 'build' && (
        <BuildStep
          menu={menu}
          settings={settings}
          cart={cart}
          cartQuote={cartQuote}
          onCart={setCart}
          onContinue={() => go('date')}
        />
      )}
      {current === 'date' && (
        <DateStep
          settings={settings}
          drinks={drinks}
          availability={availability}
          notices={notices}
          slot={slot}
          onSlot={setSlot}
          onRetry={() => loadAvailability(drinks, availDrinks)}
          onBack={back}
          onContinue={() => go('data')}
        />
      )}
      {current === 'data' && (
        <DataStep
          settings={settings}
          draft={draft}
          onDraft={setDraft}
          onBack={back}
          onContinue={() => go('review')}
        />
      )}
      {(current === 'review' || current === 'payment') && slot && !fullQuote.ok && (
        <div class="error" role="alert">
          <p>{fullQuote.messages.join(' ')}</p>
          <button type="button" class="btn" onClick={() => go('build')}>
            Revisar bebidas
          </button>
        </div>
      )}
      {current === 'review' && slot && fullQuote.ok && (
        <ReviewStep
          settings={settings}
          quote={fullQuote.quote}
          slot={slot}
          draft={draft}
          plan={plan}
          onPlan={setPlan}
          onEdit={go}
          onBack={back}
          onContinue={() => go('payment')}
        />
      )}
      {current === 'payment' && slot && plan && fullQuote.ok && (
        <PaymentStep
          settings={settings}
          quote={fullQuote.quote}
          plan={plan}
          slot={slot}
          method={method}
          onMethod={setMethod}
          submitting={submitting}
          error={submitError}
          onSubmit={submit}
          onEdit={go}
          onBack={back}
        />
      )}
    </div>
  );
}
