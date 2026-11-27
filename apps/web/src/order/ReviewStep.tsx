import { chargeFor, formatMXN, nonRefundableNotice, type PaymentPlan, type Quote, type Settings } from '@cuadrochico/core';
import { useState } from 'preact/hooks';
import { CancellationPolicy } from '../components/CancellationPolicy';
import { Lines } from '../components/Lines';
import { Totals } from '../components/Totals';
import { focusSoon, formatLocalDate } from '../lib';
import type { CustomerDraft } from './DataStep';

interface Props {
  settings: Settings;
  quote: Quote;
  slot: { date: string; time: string };
  draft: CustomerDraft;
  plan: PaymentPlan | null;
  onPlan: (p: PaymentPlan) => void;
  /** Regresa a un paso anterior para corregirlo. */
  onEdit: (step: 'build' | 'date' | 'data') => void;
  /** Instante de referencia para el aviso de no reembolsable (inyectable en pruebas). */
  now?: Date;
  onBack: () => void;
  onContinue: () => void;
}

export function ReviewStep({ settings, quote, slot, draft, plan, onPlan, onEdit, now, onBack, onContinue }: Props) {
  const [error, setError] = useState<string | null>(null);
  const notice = nonRefundableNotice(slot, now ?? new Date(), settings);
  const deposit = chargeFor(quote, 'deposit');
  const full = chargeFor(quote, 'full');

  const next = () => {
    if (!plan) {
      setError('Elige si dejas anticipo o liquidas el total para continuar.');
      focusSoon('plan-error');
      return;
    }
    onContinue();
  };

  return (
    <>
      {notice && (
        <p class="warning" role="note" data-testid="non-refundable">
          <strong>{notice}</strong> Lo pides con menos de {settings.cancellationHours} horas de anticipación.
        </p>
      )}

      <section class="card" aria-labelledby="review-order">
        <h3 id="review-order">Bebidas</h3>
        <Lines lines={quote.lines} />
        <Totals quote={quote} depositPercent={settings.depositPercent} plan={plan} />
        <button type="button" class="btn link" onClick={() => onEdit('build')}>
          Cambiar bebidas
        </button>
      </section>

      <section class="card" aria-labelledby="review-when">
        <h3 id="review-when">Entrega</h3>
        <p>
          {formatLocalDate(slot.date)} a las {slot.time}.
          <br />
          {draft.fulfillment === 'delivery'
            ? `Envío a: ${draft.address}`
            : `Recoges en ${settings.fulfillment.pickup.address}`}
        </p>
        <p>
          A nombre de <strong>{draft.name.trim()}</strong> · {draft.phone}
          {draft.email ? ` · ${draft.email}` : ''}
        </p>
        {draft.notes.trim() && <p class="muted">Notas: {draft.notes.trim()}</p>}
        <div class="edit-links">
          <button type="button" class="btn link" onClick={() => onEdit('date')}>
            Cambiar fecha u hora
          </button>
          <button type="button" class="btn link" onClick={() => onEdit('data')}>
            Cambiar datos
          </button>
        </div>
      </section>

      <fieldset class="card plans" aria-describedby={error ? 'plan-error' : undefined}>
        <legend>¿Cuánto quieres pagar ahora?</legend>
        <label class="choice">
          <input type="radio" name="plan" value="deposit" checked={plan === 'deposit'} onChange={() => onPlan('deposit')} />
          <span>
            <strong>Anticipo del {settings.depositPercent} %</strong>: pagas {formatMXN(deposit.dueNowCents)} ahora y{' '}
            {formatMXN(deposit.balanceCents)} al recoger.
          </span>
        </label>
        <label class="choice">
          <input type="radio" name="plan" value="full" checked={plan === 'full'} onChange={() => onPlan('full')} />
          <span>
            <strong>Liquidar el 100 %</strong>: pagas {formatMXN(full.dueNowCents)} ahora y nada al recoger.
          </span>
        </label>
      </fieldset>
      {error && (
        <p id="plan-error" class="error" role="alert" tabIndex={-1}>
          {error}
        </p>
      )}

      <CancellationPolicy settings={settings} />

      <div class="nav">
        <button type="button" class="btn" onClick={onBack}>
          Atrás
        </button>
        <button type="button" class="btn primary" onClick={next}>
          Ir al pago
        </button>
      </div>
    </>
  );
}
