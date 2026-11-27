import { cancellationPolicyText, type Settings } from '@cuadrochico/core';

/** La política sale siempre de `cancellationPolicyText()`: idéntica antes de pagar y en la página del pedido. */
export function CancellationPolicy({ settings }: { settings: Settings }) {
  return (
    <section class="policy" aria-labelledby="policy-title">
      <h3 id="policy-title">Política de cancelación y reembolso</h3>
      <p data-testid="cancellation-policy">{cancellationPolicyText(settings)}</p>
    </section>
  );
}
