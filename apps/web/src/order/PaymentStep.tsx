import {
  type ApiError,
  chargeFor,
  formatMXN,
  nonRefundableNotice,
  type PaymentMethod,
  type PaymentPlan,
  type Quote,
  type Settings,
} from '@cuadrochico/core';
import { useEffect, useRef, useState } from 'preact/hooks';
import { apiErrorMessage } from '../api';
import { contactLink, focusSoon } from '../lib';
import { mountTurnstile, TURNSTILE_SITE_KEY } from '../turnstile';

interface Props {
  settings: Settings;
  quote: Quote;
  plan: PaymentPlan;
  slot: { date: string; time: string };
  method: PaymentMethod | null;
  onMethod: (m: PaymentMethod) => void;
  submitting: boolean;
  error: ApiError | null;
  onSubmit: (captchaToken: string | undefined) => void;
  onEdit: (step: 'build' | 'date') => void;
  onBack: () => void;
  now?: Date;
}

const METHOD_TEXT: Record<PaymentMethod, { title: string; detail: string }> = {
  transfer: {
    title: 'Transferencia SPEI',
    detail: 'Te damos la CLABE y el concepto al confirmar. El equipo revisa el pago a mano.',
  },
  mercadopago: {
    title: 'Mercado Pago',
    detail: 'Tarjeta, OXXO o SPEI. Te llevamos a Mercado Pago para pagar.',
  },
};

export function PaymentStep(props: Props) {
  const { settings, quote, plan, slot, method, onMethod, submitting, error, onSubmit, onEdit, onBack, now } =
    props;
  const [localError, setLocalError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [captchaFailed, setCaptchaFailed] = useState(false);
  const widget = useRef<HTMLDivElement>(null);
  const charge = chargeFor(quote, plan);
  const notice = nonRefundableNotice(slot, now ?? new Date(), settings);
  const methods = (['transfer', 'mercadopago'] as const).filter((m) => settings.payments[m].enabled);
  const contact = contactLink(settings);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !widget.current) return;
    return mountTurnstile(widget.current, setToken, () => setCaptchaFailed(true));
  }, []);

  useEffect(() => {
    if (error) focusSoon('payment-error');
  }, [error]);

  const submit = () => {
    if (!method) {
      setLocalError('Elige cómo quieres pagar.');
      focusSoon('method-error');
      return;
    }
    if (TURNSTILE_SITE_KEY && !token) {
      setLocalError(
        captchaFailed
          ? 'No pudimos verificar que no eres un robot.'
          : 'Estamos verificando la conexión; inténtalo en unos segundos.',
      );
      focusSoon('method-error');
      return;
    }
    setLocalError(null);
    onSubmit(token ?? undefined);
  };

  const showContact = captchaFailed || error?.error === 'captcha';

  // Sin formas de pago configuradas (faltan secretos en el servidor): se ofrece pedir por chat.
  if (methods.length === 0)
    return (
      <>
        <p class="notice" role="status">
          Por ahora no podemos recibir pagos en línea. Escríbenos y terminamos tu pedido por chat:{' '}
          <a href={contact.href} target="_blank" rel="noopener noreferrer">
            {contact.label}
            <span class="sr-only"> (se abre en otra pestaña)</span>
          </a>
        </p>
        <div class="nav">
          <button type="button" class="btn" onClick={onBack}>
            Atrás
          </button>
        </div>
      </>
    );

  return (
    <>
      <section class="card" aria-labelledby="pay-amount">
        <h3 id="pay-amount">Pagas ahora {formatMXN(charge.dueNowCents)}</h3>
        <p class="muted">
          Total {formatMXN(quote.totalCents)}.{' '}
          {charge.balanceCents > 0
            ? `Resto al recoger: ${formatMXN(charge.balanceCents)}.`
            : 'No queda nada por pagar al recoger.'}
        </p>
        {notice && (
          <p class="warning" role="note">
            <strong>{notice}</strong>
          </p>
        )}
      </section>

      <fieldset class="card" aria-describedby={localError ? 'method-error' : undefined}>
        <legend>Forma de pago</legend>
        {methods.map((m) => (
          <label class="choice" key={m}>
            <input type="radio" name="method" value={m} checked={method === m} onChange={() => onMethod(m)} />
            <span>
              <strong>{METHOD_TEXT[m].title}</strong>
              <br />
              <span class="muted">{METHOD_TEXT[m].detail}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div ref={widget} class="turnstile" />

      {localError && (
        <p id="method-error" class="error" role="alert" tabIndex={-1}>
          {localError}
        </p>
      )}
      {error && (
        <div id="payment-error" class="error" role="alert" tabIndex={-1}>
          <p>{apiErrorMessage(error)}</p>
          {error.error === 'slot' && (
            <button type="button" class="btn" onClick={() => onEdit('date')}>
              Elegir otro horario
            </button>
          )}
          {error.error === 'quote' && (
            <button type="button" class="btn" onClick={() => onEdit('build')}>
              Revisar bebidas
            </button>
          )}
        </div>
      )}
      {showContact && (
        <p>
          Si no puedes terminar aquí, también tomamos tu pedido por chat:{' '}
          <a href={contact.href} target="_blank" rel="noopener noreferrer">
            {contact.label}
            <span class="sr-only"> (se abre en otra pestaña)</span>
          </a>
        </p>
      )}

      <div class="nav">
        <button type="button" class="btn" onClick={onBack} disabled={submitting}>
          Atrás
        </button>
        <button
          type="button"
          class="btn primary"
          onClick={submit}
          disabled={submitting}
          aria-busy={submitting}
        >
          {submitting ? 'Enviando…' : `Confirmar y pagar ${formatMXN(charge.dueNowCents)}`}
        </button>
      </div>
    </>
  );
}
