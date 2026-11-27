import type { ApiError, Menu, PaymentMethod, PaymentPlan, Settings } from '@cuadrochico/core';
import { useEffect, useRef, useState } from 'preact/hooks';
import { api, toApiError } from '../api';
import {
  addLine,
  type CartLine,
  drinkCount,
  leadTimeChangeNotice,
  quoteCart,
  toOrderLines,
} from '../order/cart';
import { navigate } from '../router';
import { CartBar } from './CartBar';
import { CartSheet } from './CartSheet';
import { type AvailabilityState, Checkout } from './Checkout';
import { type CustomerDraft, EMPTY_CUSTOMER } from './customer';
import { MenuView } from './MenuView';
import { ProductSheet } from './ProductSheet';

type Slot = { date: string; time: string };
type View = 'menu' | 'checkout';
/** Hoja abierta: el carrito o una bebida (`item:<id>`). */
type SheetState = null | 'cart' | `item:${string}`;
interface NavState {
  view: View;
  sheet: SheetState;
}

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
    // Sin almacenamiento (modo privado): el pedido funciona igual, solo no se recupera al recargar.
  }
}

const readNav = (s: unknown): NavState | null => {
  const v = s as Partial<NavState> | null;
  return v && (v.view === 'menu' || v.view === 'checkout') ? { view: v.view, sheet: v.sheet ?? null } : null;
};

export function ShopFlow({ menu, settings }: { menu: Menu; settings: Settings }) {
  const [saved] = useState(loadDraft);
  const [nav, setNav] = useState<NavState>(() => readNav(history.state) ?? { view: 'menu', sheet: null });
  const [cart, setCart] = useState<CartLine[]>(() => (Array.isArray(saved.cart) ? saved.cart : []));
  const [slot, setSlot] = useState<Slot | null>(saved.slot ?? null);
  const [draft, setDraft] = useState<CustomerDraft>({ ...EMPTY_CUSTOMER, ...(saved.draft ?? {}) });
  const [plan, setPlan] = useState<PaymentPlan | null>(saved.plan ?? null);
  const [method, setMethod] = useState<PaymentMethod | null>(saved.method ?? null);
  const [availability, setAvailability] = useState<AvailabilityState>({ status: 'loading' });
  const [availDrinks, setAvailDrinks] = useState<number | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<ApiError | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const slotRef = useRef(slot);
  slotRef.current = slot;

  const drinks = drinkCount(cart);
  const cartQuote = quoteCart(cart, menu, settings, draft.fulfillment);
  const fullQuote = slot ? quoteCart(cart, menu, settings, draft.fulfillment, slot.date) : cartQuote;
  const subtotal = cart.reduce((s, l) => {
    const v = menu.items.find((i) => i.id === l.itemId)?.variants.find((x) => x.id === l.variantId);
    return s + (v?.priceCents ?? 0) * l.qty;
  }, 0);
  // Nunca se piden datos sin haber visto el total: el checkout solo existe con una cotización válida.
  const view: View = nav.view === 'checkout' && cartQuote.ok ? 'checkout' : 'menu';

  useEffect(() => {
    if (!submitting) saveDraft({ cart, slot, draft, plan, method });
  }, [cart, slot, draft, plan, method, submitting]);

  // Cada pantalla y cada hoja quedan en el historial: el botón "atrás" del navegador las cierra.
  useEffect(() => {
    if (!readNav(history.state)) history.replaceState(nav, '', location.href);
    const onPop = (e: PopStateEvent) => {
      setSubmitError(null);
      setNav(readNav(e.state) ?? { view: 'menu', sheet: null });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const push = (next: NavState) => {
    history.pushState(next, '', location.href);
    setNav(next);
  };
  const closeSheet = () => {
    if (readNav(history.state)?.sheet) history.back();
    else setNav({ ...nav, sheet: null });
  };
  const goCheckout = () => {
    // Reemplaza la hoja del carrito por el checkout, para que "atrás" regrese al menú.
    const next: NavState = { view: 'checkout', sheet: null };
    if (readNav(history.state)?.sheet) history.replaceState(next, '', location.href);
    else history.pushState(next, '', location.href);
    setNav(next);
    window.scrollTo(0, 0);
  };
  const goMenu = () => {
    if (readNav(history.state)?.view === 'checkout') history.back();
    else setNav({ view: 'menu', sheet: null });
  };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

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
    if (view === 'checkout' && availDrinks !== drinks) loadAvailability(drinks, availDrinks);
  }, [view, drinks]);

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

  const openItem = nav.sheet?.startsWith('item:')
    ? menu.items.find((i) => `item:${i.id}` === nav.sheet)
    : undefined;

  return (
    <>
      {view === 'menu' ? (
        <MenuView
          menu={menu}
          settings={settings}
          cart={cart}
          onOpen={(id) => push({ view: 'menu', sheet: `item:${id}` })}
        />
      ) : (
        cartQuote.ok && (
          <Checkout
            settings={settings}
            quote={fullQuote.ok ? fullQuote.quote : cartQuote.quote}
            drinks={drinks}
            availability={availability}
            notices={notices}
            onRetryAvailability={() => loadAvailability(drinks, availDrinks)}
            slot={slot}
            onSlot={setSlot}
            draft={draft}
            onDraft={setDraft}
            plan={plan}
            onPlan={setPlan}
            method={method}
            onMethod={setMethod}
            submitting={submitting}
            submitError={
              submitError ?? (fullQuote.ok ? null : { error: 'quote', messages: fullQuote.messages })
            }
            onSubmit={submit}
            onEditCart={() => push({ view: 'checkout', sheet: 'cart' })}
            onBack={goMenu}
          />
        )
      )}

      {view === 'menu' && (
        <CartBar
          settings={settings}
          drinks={drinks}
          cartQuote={cartQuote}
          subtotalCents={subtotal}
          onOpen={() => push({ view: 'menu', sheet: 'cart' })}
        />
      )}

      {openItem && (
        <ProductSheet
          menu={menu}
          settings={settings}
          item={openItem}
          cartDrinks={drinks}
          onAdd={(line) => {
            setCart(addLine(cart, line));
            setToast(`Agregaste ${line.qty} ${openItem.name}`);
            closeSheet();
          }}
          onClose={closeSheet}
        />
      )}
      {nav.sheet === 'cart' && (
        <CartSheet
          menu={menu}
          settings={settings}
          cart={cart}
          cartQuote={cartQuote}
          onCart={setCart}
          onCheckout={nav.view === 'checkout' ? closeSheet : goCheckout}
          onClose={closeSheet}
        />
      )}
      <p class={toast ? 'toast show' : 'toast'} role="status" aria-live="polite">
        {toast}
      </p>
    </>
  );
}
