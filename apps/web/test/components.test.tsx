import {
  cancellationPolicyText,
  leadTimeMessage,
  defaultMenu as menu,
  NON_REFUNDABLE_NOTICE,
  type PublicOrder,
  type Quote,
  type Settings,
  defaultSettings as settings,
} from '@cuadrochico/core';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addLine, quoteCart } from '../src/order/cart';
import { AdminPage } from '../src/pages/AdminPage';
import { OrderView } from '../src/pages/OrderPage';
import { Checkout } from '../src/shop/Checkout';
import { EMPTY_CUSTOMER } from '../src/shop/customer';
import { DRAFT_KEY, ShopFlow } from '../src/shop/ShopFlow';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
  history.replaceState(null, '', '/');
});

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
const days = [
  { date: '2026-12-02', slots: [], problem: 'too_soon' as const },
  { date: '2026-12-03', slots: [{ time: '18:00', remaining: null, available: true }] },
  { date: '2026-12-15', slots: [{ time: '10:00', remaining: null, available: true }] },
  { date: '2026-12-25', slots: [], problem: 'closed' as const },
];

function renderCheckout(over: Partial<Parameters<typeof Checkout>[0]> = {}) {
  const props: Parameters<typeof Checkout>[0] = {
    settings,
    quote: makeQuote(),
    drinks: 12,
    availability: { status: 'ready', days },
    notices: [],
    onRetryAvailability: vi.fn(),
    slot: farSlot,
    onSlot: vi.fn(),
    draft,
    onDraft: vi.fn(),
    plan: null,
    onPlan: vi.fn(),
    method: null,
    onMethod: vi.fn(),
    submitting: false,
    submitError: null,
    onSubmit: vi.fn(),
    onEditCart: vi.fn(),
    onBack: vi.fn(),
    now,
    ...over,
  };
  return { ...render(<Checkout {...props} />), props };
}

const withPayments = (transfer: boolean, mercadopago: boolean): Settings => ({
  ...settings,
  payments: {
    transfer: { ...settings.payments.transfer, enabled: transfer },
    mercadopago: { enabled: mercadopago },
  },
});

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

describe('checkout', () => {
  it('muestra la política completa con el texto de core', () => {
    renderCheckout();
    expect(screen.getByTestId('cancellation-policy').textContent).toBe(cancellationPolicyText(settings));
  });

  it('avisa que no es reembolsable si falta menos de 72 h, y no si hay tiempo', () => {
    renderCheckout({ slot: nearSlot });
    expect(screen.getByTestId('non-refundable').textContent).toContain(NON_REFUNDABLE_NOTICE);
    cleanup();
    renderCheckout({ slot: farSlot });
    expect(screen.queryByTestId('non-refundable')).toBeNull();
  });

  it('no preselecciona plan ni forma de pago y no deja confirmar sin plan', () => {
    const { props } = renderCheckout();
    for (const name of [/Anticipo/, /Liquidar todo/, /Transferencia/, /Mercado Pago/])
      expect((screen.getByRole('radio', { name }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar pedido' }));
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Elige anticipo o liquidar todo.')).toBeTruthy();
    expect(screen.getByText('Elige cómo quieres pagar.')).toBeTruthy();
  });

  it('con todo completo envía el pedido y muestra lo que se paga ahora', () => {
    const quote = makeQuote();
    const { props } = renderCheckout({ quote, plan: 'full', method: 'transfer' });
    expect(document.querySelector('.pay-bar')?.textContent).toContain('Pagas ahora');
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar pedido' }));
    expect(props.onSubmit).toHaveBeenCalledOnce();
  });

  it('pide los datos con los mismos mensajes de core', () => {
    const { props } = renderCheckout({ draft: EMPTY_CUSTOMER, plan: 'deposit', method: 'transfer' });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar pedido' }));
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Nombre').getAttribute('aria-invalid')).toBe('true');
  });

  it('muestra la anticipación según el tamaño y el aviso de cambio', () => {
    renderCheckout({ drinks: 24 });
    expect(screen.getByText(leadTimeMessage(24, settings))).toBeTruthy();
    cleanup();
    renderCheckout({ drinks: 25, notices: ['Cambiaron las fechas disponibles.'] });
    expect(screen.getByText(leadTimeMessage(25, settings))).toBeTruthy();
    expect(screen.getByText('Cambiaron las fechas disponibles.').getAttribute('role')).toBe('status');
  });

  it('las fechas no disponibles se ven deshabilitadas con su razón y sin urgencia', () => {
    renderCheckout({ slot: null });
    const dates = screen
      .getAllByRole('radio')
      .filter((r) => (r as HTMLInputElement).name === 'date') as HTMLInputElement[];
    expect(dates[0]?.disabled).toBe(true);
    expect(dates[1]?.disabled).toBe(false);
    expect(document.body.textContent).toContain('Días sin elegir: Ese día no hacemos entregas.');
    // La anticipación se explica una sola vez, no también como razón de cada día.
    expect(screen.getAllByText(leadTimeMessage(12, settings))).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(/quedan/i);
  });

  it('oculta las formas de pago desactivadas', () => {
    renderCheckout({ settings: withPayments(true, false) });
    expect(screen.getByRole('radio', { name: /Transferencia/ })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: /Mercado Pago/ })).toBeNull();
  });

  it('sin formas de pago ofrece pedir por chat en lugar de pagar', () => {
    renderCheckout({ settings: withPayments(false, false) });
    expect(screen.queryByRole('button', { name: 'Confirmar pedido' })).toBeNull();
    expect(document.body.innerHTML).toContain('instagram.com');
  });
});

describe('tienda', () => {
  const addTonic = async () => {
    fireEvent.click(screen.getByRole('button', { name: /^Cold Brew Tonic/ }));
    const sheet = screen.getByRole('dialog');
    // Sin nada en el carrito, el contador empieza en el mínimo.
    fireEvent.click(within(sheet).getByRole('button', { name: /^Agregar 6/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  };

  it('muestra el catálogo, agrega desde la hoja y el total aparece antes de pedir datos', async () => {
    render(<ShopFlow menu={menu} settings={settings} />);
    expect(screen.queryByRole('button', { name: /Ver pedido/ })).toBeNull();
    await addTonic();
    const bar = screen.getByRole('button', { name: /Ver pedido/ });
    expect(bar.textContent).toContain('$');
    expect(screen.queryByLabelText('Nombre')).toBeNull();
    expect(document.body.textContent).toContain('agrega 6 y obtén 10 %');
  });

  it('el carrito no deja continuar debajo del mínimo', async () => {
    render(<ShopFlow menu={menu} settings={settings} />);
    fireEvent.click(screen.getByRole('button', { name: /^Cold Brew Tonic/ }));
    const sheet = screen.getByRole('dialog');
    fireEvent.click(within(sheet).getByRole('button', { name: /Una menos/ }));
    fireEvent.click(within(sheet).getByRole('button', { name: /^Agregar 5/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /Ver pedido/ }));
    const cart = screen.getByRole('dialog');
    const go = within(cart).getByRole('button', { name: /mínimo/ }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
  });

  it('el borrador sobrevive a una recarga de la pestaña', async () => {
    const first = render(<ShopFlow menu={menu} settings={settings} />);
    await addTonic();
    expect(sessionStorage.getItem(DRAFT_KEY)).toContain('"qty":6');
    first.unmount();
    render(<ShopFlow menu={menu} settings={settings} />);
    expect(screen.getByRole('button', { name: /Ver pedido/ })).toBeTruthy();
  });

  it('el botón atrás del navegador cierra la hoja abierta', async () => {
    render(<ShopFlow menu={menu} settings={settings} />);
    fireEvent.click(screen.getByRole('button', { name: /^Matcha Latte/ }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect((history.state as { sheet: string }).sheet).toBe('item:matcha-latte');
    window.dispatchEvent(new PopStateEvent('popstate', { state: { view: 'menu', sheet: null } }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('del carrito pasa al checkout en una sola página', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ days }), { headers: { 'content-type': 'application/json' } }),
      ),
    );
    render(<ShopFlow menu={menu} settings={settings} />);
    await addTonic();
    fireEvent.click(screen.getByRole('button', { name: /Ver pedido/ }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Continuar/ }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Finaliza tu pedido' })).toBeTruthy());
    expect(screen.getByLabelText('Nombre')).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Anticipo/ })).toBeTruthy();
  });
});

describe('página del pedido', () => {
  it('la política es idéntica a la del checkout', () => {
    renderCheckout();
    const checkoutText = screen.getByTestId('cancellation-policy').textContent;
    cleanup();
    render(<OrderView settings={settings} order={order(cancellable)} payment={null} onCancel={vi.fn()} />);
    expect(screen.getByTestId('cancellation-policy').textContent).toBe(checkoutText);
  });

  it('muestra el avance del pedido', () => {
    render(
      <OrderView settings={settings} order={order(cancellable, 'ready')} payment={null} onCancel={vi.fn()} />,
    );
    const steps = within(screen.getByRole('list', { name: 'Avance del pedido' })).getAllByRole('listitem');
    expect(steps.map((s) => s.className)).toEqual(['done', 'done', 'done', 'next']);
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
    expect(dialog.textContent).toContain('el reembolso es automático');
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

describe('admin', () => {
  const adminOrder = (code: string, status: PublicOrder['status'] = 'confirmed') => ({
    ...order(cancellable, status),
    code,
    customerPhone: '8112345678',
    customerEmail: '',
    updatedAt: '2026-12-01T18:00:00Z',
    events: [],
    providerFeeCents: null,
    refundCents: null,
  });
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  it('resalta el pedido de /admin?pedido=CODE', async () => {
    localStorage.setItem('cc-admin-token', 'secreto');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(200, { orders: [adminOrder('CC-AAAA'), adminOrder('CC-BBBB')] })),
    );
    render(<AdminPage settings={settings} highlight="CC-BBBB" />);
    await waitFor(() => expect(document.getElementById('order-CC-BBBB')).toBeTruthy());
    expect(document.getElementById('order-CC-BBBB')?.className).toContain('highlight');
    expect(document.getElementById('order-CC-AAAA')?.className).not.toContain('highlight');
  });

  it('muestra cancelados con monto a devolver y comisión', async () => {
    localStorage.setItem('cc-admin-token', 'secreto');
    const cancelled = { ...adminOrder('CC-CCCC', 'cancelled'), refundCents: 50000, providerFeeCents: 2100 };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(200, { orders: [cancelled] })),
    );
    render(<AdminPage settings={settings} />);
    await waitFor(() => expect(screen.getByText('Monto a devolver')).toBeTruthy());
    expect(document.body.textContent).toContain('$500');
    expect(document.body.textContent).toContain('$21');
    expect(document.body.textContent).toContain('Devolver a mano');
  });

  it('un 409 muestra el mensaje y recarga la lista', async () => {
    localStorage.setItem('cc-admin-token', 'secreto');
    const f = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'PATCH'
        ? json(409, { error: 'internal', message: 'Alguien más cambió este pedido.' })
        : json(200, { orders: [adminOrder('CC-AAAA')] }),
    );
    vi.stubGlobal('fetch', f);
    render(<AdminPage settings={settings} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Marcar listo' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Marcar listo' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('Alguien más cambió este pedido.'),
    );
    await waitFor(() => expect(f.mock.calls.filter(([, i]) => !i?.method).length).toBe(2));
    expect(screen.getByRole('alert').textContent).toBe('Alguien más cambió este pedido.');
  });
  /** Token de empleado como lo firma el servidor (la firma aquí no importa: la valida el servidor). */
  const staffToken = (name: string, role: 'manager' | 'barista') => {
    const utf8 = new TextEncoder().encode(JSON.stringify({ name, role, exp: '2099-01-01T00:00:00.000Z' }));
    return `s.${btoa(String.fromCharCode(...utf8))}.firma`;
  };

  it('entra con nombre y PIN; un barista no ve confirmar pago ni cancelar', async () => {
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/staff')
        return json(200, {
          staff: [
            { name: 'Sofía', role: 'barista' },
            { name: 'Rudy', role: 'manager' },
          ],
        });
      if (url === '/api/staff/login')
        return JSON.parse(String(init?.body)).pin === '5678'
          ? json(200, {
              token: staffToken('Sofía', 'barista'),
              name: 'Sofía',
              role: 'barista',
              expiresAt: '2099-01-01T00:00:00.000Z',
            })
          : json(401, { error: 'unauthorized' });
      return json(200, { orders: [adminOrder('CC-AAAA', 'pending_payment'), adminOrder('CC-BBBB')] });
    });
    vi.stubGlobal('fetch', f);
    render(<AdminPage settings={settings} />);
    await waitFor(() => expect(screen.getByRole('option', { name: 'Sofía' })).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Sofía' } });
    fireEvent.input(screen.getByLabelText('PIN'), { target: { value: '0000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Nombre o PIN incorrecto.'));

    fireEvent.input(screen.getByLabelText('PIN'), { target: { value: '5678' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Marcar listo' })).toBeTruthy());
    expect(document.body.textContent).toContain('Sofía · barista');
    expect(screen.queryByRole('button', { name: /Marcar pagado/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull();
    expect(localStorage.getItem('cc-admin-token')).toBe(staffToken('Sofía', 'barista'));
  });

  it('toma la sesión de #sesion= (app interna) y la quita de la URL', async () => {
    history.replaceState(null, '', `/admin#sesion=${staffToken('Rudy', 'manager')}`);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(200, { orders: [adminOrder('CC-AAAA', 'pending_payment')] })),
    );
    render(<AdminPage settings={settings} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Marcar pagado/ })).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeTruthy();
    expect(location.hash).toBe('');
    expect(document.body.textContent).toContain('Rudy · gerente');
  });

  it('una sesión vencida pide entrar de nuevo', () => {
    const expired = `s.${btoa(JSON.stringify({ name: 'Rudy', role: 'manager', exp: '2020-01-01T00:00:00.000Z' }))}.x`;
    localStorage.setItem('cc-admin-token', expired);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(200, { staff: [] })),
    );
    render(<AdminPage settings={settings} />);
    expect(screen.getByLabelText('PIN')).toBeTruthy();
  });
});
