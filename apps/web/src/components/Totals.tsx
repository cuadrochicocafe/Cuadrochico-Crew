import { chargeFor, formatMXN, type PaymentPlan, type Quote } from '@cuadrochico/core';
import { plural } from '../lib';

/** Total, descuento y opciones de pago. Se muestra desde el primer paso, antes de pedir cualquier dato. */
export function Totals({ quote, depositPercent, plan }: { quote: Quote; depositPercent: number; plan?: PaymentPlan | null }) {
  const deposit = chargeFor(quote, 'deposit');
  const chosen = plan ? chargeFor(quote, plan) : null;
  return (
    <dl class="totals">
      <div>
        <dt>{plural(quote.drinks, 'bebida', 'bebidas')}</dt>
        <dd>{formatMXN(quote.subtotalCents)}</dd>
      </div>
      {quote.discountCents > 0 && (
        <div>
          <dt>Descuento ({quote.discountPercent} %)</dt>
          <dd>−{formatMXN(quote.discountCents)}</dd>
        </div>
      )}
      {quote.deliveryFeeCents > 0 && (
        <div>
          <dt>Envío</dt>
          <dd>{formatMXN(quote.deliveryFeeCents)}</dd>
        </div>
      )}
      <div class="total">
        <dt>Total</dt>
        <dd>{formatMXN(quote.totalCents)}</dd>
      </div>
      {chosen ? (
        <div class="due">
          <dt>Pagas ahora</dt>
          <dd>{formatMXN(chosen.dueNowCents)}</dd>
          {chosen.balanceCents > 0 && (
            <dd class="muted">Resto al recoger: {formatMXN(chosen.balanceCents)}</dd>
          )}
        </div>
      ) : (
        <div class="muted">
          <dt>Anticipo del {depositPercent} %</dt>
          <dd>
            {formatMXN(deposit.dueNowCents)} ahora y {formatMXN(deposit.balanceCents)} al recoger, o liquidas el
            total. Tú eliges antes de pagar.
          </dd>
        </div>
      )}
    </dl>
  );
}
