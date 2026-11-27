import {
  type ApiError,
  cancelProblemMessage,
  formatMXN,
  type OrderResponse,
  type PaymentInstructions,
  type PublicOrder,
  type Settings,
} from '@cuadrochico/core';
import { useEffect, useState } from 'preact/hooks';
import { api, apiErrorMessage, toApiError } from '../api';
import { CancellationPolicy } from '../components/CancellationPolicy';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { CopyButton } from '../components/CopyButton';
import { Lines } from '../components/Lines';
import { contactLink, formatInstant, formatLocalDate, STATUS_LABEL } from '../lib';

export function OrderPage({ settings, code, token }: { settings: Settings; code: string; token: string }) {
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'error'; error: ApiError } | { status: 'ready'; data: OrderResponse }
  >({ status: 'loading' });

  useEffect(() => {
    api
      .order(code, token)
      .then((data) => setState({ status: 'ready', data }))
      .catch((e: unknown) => setState({ status: 'error', error: toApiError(e) }));
  }, [code, token]);

  if (state.status === 'loading') return <p aria-live="polite">Cargando tu pedido…</p>;
  if (state.status === 'error')
    return (
      <div role="alert" class="error">
        <p>{apiErrorMessage(state.error)}</p>
      </div>
    );

  const cancel = async (): Promise<ApiError | null> => {
    try {
      const data = await api.cancelOrder(code, token);
      setState({ status: 'ready', data });
      return null;
    } catch (e) {
      return toApiError(e);
    }
  };

  return (
    <OrderView settings={settings} order={state.data.order} payment={state.data.payment} onCancel={cancel} />
  );
}

const HEADLINE: Record<PublicOrder['status'], string> = {
  pending_payment: '¡Ya casi! Falta tu pago',
  confirmed: '¡Listo! Ya estamos en ello',
  ready: 'Tu pedido está listo',
  completed: 'Pedido entregado. ¡Gracias!',
  cancelled: 'Pedido cancelado',
  expired: 'El pedido venció',
};

const TRACK = [
  { label: 'Pedido recibido', statuses: ['pending_payment', 'confirmed', 'ready', 'completed'] },
  { label: 'Pago confirmado', statuses: ['confirmed', 'ready', 'completed'] },
  { label: 'Listo para recoger', statuses: ['ready', 'completed'] },
  { label: 'Entregado', statuses: ['completed'] },
] as const;

/** Seguimiento del pedido. Cancelados y vencidos no lo muestran: ahí la página lo explica en texto. */
function Tracker({ status }: { status: PublicOrder['status'] }) {
  if (status === 'cancelled' || status === 'expired') return null;
  const done = TRACK.filter((s) => (s.statuses as readonly string[]).includes(status)).length;
  return (
    <ol class="tracker" aria-label="Avance del pedido">
      {TRACK.map((s, i) => {
        const state = i < done ? 'done' : i === done ? 'next' : '';
        return (
          <li key={s.label} class={state} aria-current={i === done - 1 ? 'step' : undefined}>
            <span class="dot" aria-hidden="true" />
            <span>
              {s.label}
              {i < done && <span class="sr-only"> (hecho)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

interface ViewProps {
  settings: Settings;
  order: PublicOrder;
  payment: PaymentInstructions | null;
  onCancel: () => Promise<ApiError | null>;
}

export function OrderView({ settings, order, payment, onCancel }: ViewProps) {
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const balance = Math.max(0, order.quote.totalCents - order.paidCents);
  const when = `${formatLocalDate(order.slot.date)} a las ${order.slot.time}`;
  const where =
    order.fulfillment.type === 'delivery'
      ? `en ${order.fulfillment.address}`
      : `en ${settings.fulfillment.pickup.address}`;
  const deadline = order.cancellation.deadline
    ? formatInstant(order.cancellation.deadline, settings.timezone)
    : null;
  const contact = contactLink(settings);

  const confirmCancel = async () => {
    setBusy(true);
    const err = await onCancel();
    setBusy(false);
    setDialog(false);
    setCancelError(err ? apiErrorMessage(err) : null);
  };

  return (
    <article class="order" aria-labelledby="order-title">
      <p class="eyebrow">Pedido {order.code}</p>
      <h2 id="order-title" tabIndex={-1}>
        {HEADLINE[order.status]}
      </h2>
      <p class="status sr-only" role="status">
        {STATUS_LABEL[order.status]}
      </p>
      <Tracker status={order.status} />
      <p class="muted small">Guarda este enlace: con él puedes consultar tu pedido cuando quieras.</p>

      {order.status === 'pending_payment' && payment && (
        <section class="card" aria-labelledby="pay-title">
          <h3 id="pay-title">Cómo pagar {formatMXN(payment.amountCents)}</h3>
          {payment.method === 'transfer' ? (
            <dl class="bank">
              <div>
                <dt>Banco</dt>
                <dd>{payment.bank}</dd>
              </div>
              <div>
                <dt>Titular</dt>
                <dd>{payment.beneficiary}</dd>
              </div>
              <div>
                <dt>CLABE</dt>
                <dd class="mono">
                  {payment.clabe} <CopyButton value={payment.clabe} label="CLABE" />
                </dd>
              </div>
              <div>
                <dt>Concepto</dt>
                <dd class="mono">
                  {payment.reference} <CopyButton value={payment.reference} label="concepto" />
                </dd>
              </div>
              <div>
                <dt>Monto</dt>
                <dd>{formatMXN(payment.amountCents)}</dd>
              </div>
            </dl>
          ) : (
            <a class="btn primary" href={payment.checkoutUrl}>
              Pagar con Mercado Pago
            </a>
          )}
          {payment.method === 'transfer' && (
            <p class="muted small">
              Cuando recibamos tu transferencia, el equipo confirma tu pedido aquí mismo.
            </p>
          )}
          {order.expiresAt && (
            <p>Apartamos tu horario hasta el {formatInstant(order.expiresAt, settings.timezone)}.</p>
          )}
        </section>
      )}

      {(order.status === 'confirmed' || order.status === 'ready') && (
        <p>
          Te esperamos el {when} {where}.{balance > 0 && ` Al recoger pagas ${formatMXN(balance)}.`}
        </p>
      )}
      {order.status === 'cancelled' && (
        <p>
          Cancelamos tu pedido. Si te corresponde reembolso, el equipo te lo devuelve a mano; si tienes dudas,{' '}
          <a href={contact.href} target="_blank" rel="noopener noreferrer">
            {contact.label.toLowerCase()}
          </a>
          .
        </p>
      )}
      {order.status === 'expired' && (
        <p>
          No recibimos el pago a tiempo y se liberó el horario. Puedes hacer un pedido nuevo o{' '}
          <a href={contact.href} target="_blank" rel="noopener noreferrer">
            {contact.label.toLowerCase()}
          </a>
          .
        </p>
      )}

      <section class="card" aria-labelledby="detail-title">
        <h3 id="detail-title">Detalle</h3>
        <p>
          Entrega: {when} {where}. A nombre de {order.customerName}.
        </p>
        <Lines lines={order.quote.lines} />
        <dl class="totals">
          {order.quote.discountCents > 0 && (
            <div>
              <dt>Descuento ({order.quote.discountPercent} %)</dt>
              <dd>−{formatMXN(order.quote.discountCents)}</dd>
            </div>
          )}
          <div class="total">
            <dt>Total</dt>
            <dd>{formatMXN(order.quote.totalCents)}</dd>
          </div>
          <div>
            <dt>Pagado</dt>
            <dd>{formatMXN(order.paidCents)}</dd>
          </div>
          <div>
            <dt>Por pagar</dt>
            <dd>{formatMXN(balance)}</dd>
          </div>
        </dl>
        <p class="muted small">
          Plan elegido:{' '}
          {order.paymentPlan === 'full' ? 'liquidar el 100 %' : `anticipo del ${settings.depositPercent} %`}.
        </p>
      </section>

      {!order.cancellation.refundable && (
        <p class="warning" role="note">
          <strong>{cancelProblemMessage('not_refundable_order', settings)}</strong>
        </p>
      )}
      {order.cancellation.refundable && deadline && order.cancellation.canCancelNow && (
        <p>Puedes cancelar hasta el {deadline}.</p>
      )}

      <CancellationPolicy settings={settings} />

      {cancelError && (
        <p class="error" role="alert">
          {cancelError}
        </p>
      )}
      {order.cancellation.canCancelNow && (
        <button type="button" class="btn danger" onClick={() => setDialog(true)}>
          Cancelar pedido
        </button>
      )}

      {dialog && (
        <ConfirmDialog
          title="¿Cancelar tu pedido?"
          confirmLabel="Sí, cancelar pedido"
          cancelLabel="No, conservarlo"
          busy={busy}
          onConfirm={confirmCancel}
          onClose={() => setDialog(false)}
        >
          {deadline && <p>Puedes cancelar hasta el {deadline}.</p>}
          <p>
            El reembolso lo hace el equipo a mano: las transferencias se devuelven completas y los pagos con
            Mercado Pago, menos la comisión que cobra Mercado Pago.
          </p>
          <p>Esta acción no se puede deshacer.</p>
        </ConfirmDialog>
      )}
    </article>
  );
}
