import {
  cancellationPolicyText,
  leadTimeMessage,
  defaultMenu as menu,
  NON_REFUNDABLE_NOTICE,
  type PublicOrder,
  type Quote,
  defaultSettings as settings,
} from '@cuadrochico/core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addLine, quoteCart } from '../src/order/cart';
import { EMPTY_CUSTOMER } from '../src/order/DataStep';
import { DateStep } from '../src/order/DateStep';
import { OrderFlow } from '../src/order/OrderFlow';
import { ReviewStep } from '../src/order/ReviewStep';
import { OrderView } from '../src/pages/OrderPage';

afterEach(cleanup);

function makeQuote(qty = 12): Quote {
  const r = quoteCart(
    addLine([], { itemId: 'cold-brew-tonic', variantId: 'regular', options: {}, qty }),
    menu,
    settings,
  );
  if (!r.ok) throw new Error(r.messages.join());
  return r.quote;
}

const now = new Date('2026-12-01T12:00:00-06:00');
const farSlot = { date: '2026-12-15', time: '10:00' };
const nearSlot = { date: '2026-12-03', time: '18:00' };
const draft = { ...EMPTY_CUSTOMER, name: 'Ana López', phone: '8112345678' };

function renderReview(slot = farSlot, onContinue = vi.fn()) {
  return render(
    <ReviewStep
      settings={settings}
      quote={makeQuote()}
      slot={slot}
      draft={draft}
      plan={null}
      onPlan={vi.fn()}
      onEdit={vi.fn()}
      onBack={vi.fn()}
      onContinue={onContinue}
      now={now}
    />,
  );
}

function order(
  cancellation: PublicOrder['cancellation'],
  status: PublicOrder['status'] = 'confirmed',
): PublicOrder {
  const quote = makeQuote();
  return {
    code: 'CC-7K3Q',
    status,
    createdAt: '2026-12-01T18:00:00Z',
    expiresAt: null,
    slot: farSlot,
    fulfillment: { type: 'pickup' },
    customerName: 'Ana López',
    paymentMethod: 'transfer',
    paymentPlan: 'deposit',
    quote,
    paidCents: quote.depositCents,
    notes: '',
    cancellation,
  };
}

const cancellable = { refundable: true, deadline: '2026-12-12T16:00:00Z', canCancelNow: true };

describe('revisión antes de pagar', () => {
  it('muestra la política con el texto de core', () => {
    renderReview();
    expect(screen.getByTestId('cancellation-policy').textContent).toBe(cancellationPolicyText(settings));
  });

  it('avisa que no es reembolsable si falta menos de 72 h', () => {
    renderReview(nearSlot);
    expect(screen.getByTestId('non-refundable').textContent).toContain(NON_REFUNDABLE_NOTICE);
  });

  it('no muestra el aviso si hay tiempo para cancelar', () => {
    renderReview(farSlot);
    expect(screen.queryByTestId('non-refundable')).toBeNull();
  });

  it('no deja continuar sin elegir anticipo o liquidación, y nada viene marcado', () => {
    const onContinue = vi.fn();
    renderReview(farSlot, onContinue);
    for (const r of screen.getAllByRole('radio')) expect((r as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Ir al pago' }));
    expect(onContinue).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('anticipo');
  });
});

describe('página del pedido', () => {
  it('la política es idéntica a la de la revisión', () => {
    const review = renderReview();
    const reviewText = review.getByTestId('cancellation-policy').textContent;
    cleanup();
    render(<OrderView settings={settings} order={order(cancellable)} payment={null} onCancel={vi.fn()} />);
    expect(screen.getByTestId('cancellation-policy').textContent).toBe(reviewText);
  });

  it('muestra "Cancelar pedido" solo si canCancelNow', () => {
    render(<OrderView settings={settings} order={order(cancellable)} payment={null} onCancel={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Cancelar pedido' })).toBeTruthy();
    cleanup();
    render(
      <OrderView
        settings={settings}
        order={order({ ...cancellable, canCancelNow: false })}
        payment={null}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Cancelar pedido' })).toBeNull();
  });

  it('un pedido no reembolsable lo dice y no ofrece cancelar', () => {
    render(
      <OrderView
        settings={settings}
        order={order({ refundable: false, deadline: null, canCancelNow: false })}
        payment={null}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(NON_REFUNDABLE_NOTICE)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancelar pedido' })).toBeNull();
  });

  it('confirma en un diálogo accesible y muestra el error not_cancellable', async () => {
    const onCancel = vi.fn(async () => ({
      error: 'not_cancellable' as const,
      problem: 'deadline_passed' as const,
      message: 'El plazo para cancelar terminó 72 horas antes de la entrega.',
    }));
    render(<OrderView settings={settings} order={order(cancellable)} payment={null} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar pedido' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.textContent).toContain('a mano');
    expect(dialog.textContent).toContain('Puedes cancelar hasta');
    expect(document.activeElement?.textContent).toBe('No, conservarlo');
    fireEvent.click(screen.getByRole('button', { name: 'Sí, cancelar pedido' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('El plazo para cancelar terminó'),
    );
    expect(onCancel).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Esc cierra el diálogo sin cancelar', () => {
    const onCancel = vi.fn(async () => null);
    render(<OrderView settings={settings} order={order(cancellable)} payment={null} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar pedido' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe('fecha y hora', () => {
  const props = {
    settings,
    availability: {
      status: 'ready' as const,
      days: [
        { date: '2026-12-02', slots: [], problem: 'too_soon' as const },
        { date: '2026-12-10', slots: [{ time: '10:00', remaining: null, available: true }] },
      ],
    },
    slot: null,
    onSlot: vi.fn(),
    onRetry: vi.fn(),
    onBack: vi.fn(),
    onContinue: vi.fn(),
  };

  it('muestra la anticipación según el tamaño y el aviso de cambio', () => {
    const { rerender } = render(<DateStep {...props} drinks={24} notices={[]} />);
    expect(screen.getByText(leadTimeMessage(24, settings))).toBeTruthy();
    rerender(<DateStep {...props} drinks={25} notices={['Cambiaron las fechas disponibles.']} />);
    expect(screen.getAllByText(leadTimeMessage(25, settings)).length).toBeGreaterThan(0);
    expect(screen.getByRole('status').textContent).toBe('Cambiaron las fechas disponibles.');
  });

  it('las fechas no disponibles se ven deshabilitadas con su razón y sin urgencia', () => {
    render(<DateStep {...props} drinks={12} notices={[]} />);
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios[0]?.disabled).toBe(true);
    expect(radios[1]?.disabled).toBe(false);
    expect(document.body.textContent).not.toMatch(/quedan/i);
  });
});

describe('flujo del pedido', () => {
  it('no avanza sin bebidas suficientes y muestra el total antes de pedir datos', async () => {
    render(<OrderFlow menu={menu} settings={settings} />);
    fireEvent.click(screen.getByRole('button', { name: 'Elegir fecha y hora' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBeTruthy());
    expect(screen.getByRole('heading', { level: 2 }).textContent).toContain('Arma tu pedido');
    expect(screen.queryByLabelText('Nombre')).toBeNull();

    const qty = screen.getAllByLabelText('Cantidad')[0] as HTMLInputElement;
    fireEvent.input(qty, { target: { value: '6' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Agregar' })[0] as HTMLElement);
    await waitFor(() => expect(screen.getByText('Total')).toBeTruthy());
    expect(screen.getByText(/Anticipo del 50 %/)).toBeTruthy();
  });
});
