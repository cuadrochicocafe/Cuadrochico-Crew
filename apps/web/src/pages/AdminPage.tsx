import {
  type AdminOrder,
  type AdminUpdateOrderRequest,
  addDays,
  chargeFor,
  formatMXN,
  localDate,
  type OrderStatus,
  type Settings,
  type StaffListResponse,
  type StaffRole,
} from '@cuadrochico/core';
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { ApiRequestError, adminApi, apiErrorMessage, staffApi, toApiError } from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { formatLocalDate, plural } from '../lib';
import {
  IconAlert,
  IconBag,
  IconCancel,
  IconCheck,
  IconCup,
  IconList,
  IconNote,
  IconPay,
  IconPhone,
} from './staffIcons';

const TOKEN_KEY = 'cc-admin-token';

export interface AdminSession {
  token: string;
  name: string;
  role: StaffRole;
}

/**
 * Datos de la sesión para la interfaz. El token de empleado es `s.<payload>.<firma>`: aquí solo se lee
 * el payload (nombre, rol, vencimiento); quien valida la firma es el servidor. Otro token = ADMIN_TOKEN.
 */
export function sessionFrom(token: string, now = new Date()): AdminSession | null {
  if (!token) return null;
  if (!token.startsWith('s.')) return { token, name: 'admin', role: 'manager' };
  try {
    const b64 = (token.split('.')[1] ?? '').replace(/-/g, '+').replace(/_/g, '/');
    const p = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))) as {
      name: string;
      role: StaffRole;
      exp: string;
    };
    return p.exp > now.toISOString() ? { token, name: p.name, role: p.role } : null;
  } catch {
    return null;
  }
}

/** La app interna abre `/admin#sesion=<token>` ya con sesión; si no, se usa la guardada en este dispositivo. */
function readToken(): string {
  const fromHash = new URLSearchParams(location.hash.slice(1)).get('sesion');
  if (fromHash) {
    history.replaceState(history.state, '', location.pathname + location.search);
    saveToken(fromHash);
    return fromHash;
  }
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveToken(t: string) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Sin almacenamiento (modo privado o dentro de otra app): la sesión vive solo en memoria.
  }
}

/** Dentro de la app del equipo (iframe) no se repiten logo, nombre ni "Salir": ya los muestra la app. */
const embedded = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();

/** `highlight`: código que llega en `/admin?pedido=CODE` (enlace del evento de Google Calendar). */
export function AdminPage({ settings, highlight = null }: { settings: Settings; highlight?: string | null }) {
  const [session, setSession] = useState(() => sessionFrom(readToken()));

  // Mismo look que las herramientas internas del equipo, no el de la tienda.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('staff');
    root.classList.toggle('embedded', embedded);
    return () => root.classList.remove('staff', 'embedded');
  }, []);

  const logout = () => {
    saveToken('');
    setSession(null);
  };

  if (!session)
    return (
      <Login
        onToken={(t) => {
          saveToken(t);
          setSession(sessionFrom(t));
        }}
      />
    );

  return (
    <div class="s-app">
      {!embedded && (
        <>
          <div class="s-top">
            <img class="s-logo" src="/logo_cuadrochico.svg" alt="Cuadrochico" width={130} height={34} />
            <div class="s-who">
              {session.name} · {session.role === 'manager' ? 'gerente' : 'barista'}
              <br />
              <button type="button" class="s-link" onClick={logout}>
                Salir
              </button>
            </div>
          </div>
          <h1 class="s-title">Pedidos de mayoreo</h1>
        </>
      )}
      <Orders
        token={session.token}
        manager={session.role === 'manager'}
        settings={settings}
        highlight={highlight}
        onUnauthorized={logout}
      />
    </div>
  );
}

function Login({ onToken }: { onToken: (t: string) => void }) {
  const [staff, setStaff] = useState<StaffListResponse['staff'] | null>(null);
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [adminToken, setAdminToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    staffApi
      .list()
      .then((r) => setStaff(r.staff))
      .catch(() => setStaff([]));
  }, []);

  const submit = async (e: Event) => {
    e.preventDefault();
    setError(null);
    if (!name || !pin) {
      setError('Elige tu nombre y escribe tu PIN.');
      return;
    }
    setBusy(true);
    try {
      onToken((await staffApi.login(name, pin)).token);
    } catch (err) {
      const apiErr = toApiError(err);
      setError(apiErr.error === 'unauthorized' ? 'Nombre o PIN incorrecto.' : apiErrorMessage(apiErr));
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="s-app">
      <img
        class="s-logo s-logo-big"
        src="/logo_vaso.svg"
        alt="Cuadrochico · Barra de café"
        width={200}
        height={200}
      />
      <h1 class="s-title s-center">Pedidos de mayoreo</h1>
      <form class="s-login" onSubmit={submit}>
        <label>
          Nombre
          <select value={name} onChange={(e) => setName((e.target as HTMLSelectElement).value)}>
            <option value="">{staff === null ? 'Cargando…' : 'Escoge tu usuario'}</option>
            {staff?.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          PIN
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            value={pin}
            onInput={(e) => setPin((e.target as HTMLInputElement).value)}
          />
        </label>
        {error && (
          <p class="s-banner warn" role="alert">
            {error}
          </p>
        )}
        <button type="submit" class="s-btn" disabled={busy}>
          Entrar
        </button>
      </form>
      <details class="s-more">
        <summary>Entrar con el token de administrador</summary>
        <form
          class="s-login"
          onSubmit={(e) => {
            e.preventDefault();
            if (adminToken.trim()) onToken(adminToken.trim());
          }}
        >
          <label>
            Token de acceso
            <input
              type="password"
              autoComplete="off"
              value={adminToken}
              onInput={(e) => setAdminToken((e.target as HTMLInputElement).value)}
            />
          </label>
          <button type="submit" class="s-btn sec">
            Entrar con token
          </button>
        </form>
      </details>
    </div>
  );
}

// ---------- Estados y filtros

/** Cómo lo dice el equipo (la página del cliente usa otras palabras). */
const STAFF_STATUS: Record<OrderStatus, { label: string; icon: () => JSX.Element }> = {
  pending_payment: { label: 'Falta pagar', icon: IconPay },
  confirmed: { label: 'Por preparar', icon: IconCup },
  ready: { label: 'Listo para entregar', icon: IconBag },
  completed: { label: 'Entregado', icon: IconCheck },
  cancelled: { label: 'Cancelado', icon: IconCancel },
  expired: { label: 'Venció sin pago', icon: IconCancel },
};

const CLOSED: readonly OrderStatus[] = ['completed', 'cancelled', 'expired'];
const owes = (o: AdminOrder) =>
  o.status !== 'cancelled' && o.status !== 'expired' && o.paidCents < o.quote.totalCents;

type Filter = 'active' | 'owes' | 'confirmed' | 'ready' | 'completed' | 'cancelled' | 'all';

const FILTERS: {
  id: Filter;
  label: string;
  tone: string;
  icon: () => JSX.Element;
  match: (o: AdminOrder) => boolean;
}[] = [
  {
    id: 'active',
    label: 'Pendientes',
    tone: 'acc',
    icon: IconList,
    match: (o) => !CLOSED.includes(o.status),
  },
  { id: 'owes', label: 'Falta pagar', tone: 'owe', icon: IconPay, match: owes },
  {
    id: 'confirmed',
    label: 'Por preparar',
    tone: 'confirmed',
    icon: IconCup,
    match: (o) => o.status === 'confirmed',
  },
  { id: 'ready', label: 'Listos', tone: 'ready', icon: IconBag, match: (o) => o.status === 'ready' },
  {
    id: 'completed',
    label: 'Entregados',
    tone: 'completed',
    icon: IconCheck,
    match: (o) => o.status === 'completed',
  },
  {
    id: 'cancelled',
    label: 'Cancelados',
    tone: 'cancelled',
    icon: IconCancel,
    match: (o) => o.status === 'cancelled' || o.status === 'expired',
  },
  { id: 'all', label: 'Todos', tone: 'acc', icon: IconList, match: () => true },
];

interface OrdersProps {
  token: string;
  manager: boolean;
  settings: Settings;
  highlight: string | null;
  onUnauthorized: () => void;
}

function Orders({ token, manager, settings, highlight, onUnauthorized }: OrdersProps) {
  const today = localDate(new Date(), settings.timezone);
  // Una semana hacia atrás (para ver lo entregado) y todo lo que se puede pedir hacia adelante.
  const [from, setFrom] = useState(addDays(today, highlight ? -30 : -7));
  const [to, setTo] = useState(addDays(today, settings.maxDaysAhead));
  const [filter, setFilter] = useState<Filter>(highlight ? 'all' : 'active');
  const [orders, setOrders] = useState<AdminOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<AdminOrder | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = (e: unknown) => {
    const err = toApiError(e);
    if (err.error === 'unauthorized') onUnauthorized();
    else setError(apiErrorMessage(err));
  };

  const load = (clearError = true) => {
    if (clearError) setError(null);
    adminApi
      .orders(token, from, to)
      .then((r) => setOrders(r.orders))
      .catch(fail);
  };

  useEffect(() => load(), [from, to]);

  const found = !!highlight && !!orders?.some((o) => o.code === highlight);
  useEffect(() => {
    if (found && highlight) {
      const el = document.getElementById(`order-${highlight}`);
      el?.scrollIntoView?.({ block: 'center' });
      el?.focus();
    }
  }, [found]);

  const update = async (code: string, body: AdminUpdateOrderRequest) => {
    setBusy(true);
    try {
      const { order } = await adminApi.update(token, code, body);
      setOrders((list) => list?.map((o) => (o.code === order.code ? order : o)) ?? list);
    } catch (e) {
      fail(e);
      // 409: alguien más cambió el pedido; se muestra el mensaje y se recarga la lista.
      if (e instanceof ApiRequestError && e.status === 409) load(false);
    } finally {
      setBusy(false);
    }
  };

  const all = orders ?? [];
  const current = FILTERS.find((f) => f.id === filter) ?? FILTERS[0];
  const shown = all
    .filter((o) => current?.match(o))
    .sort((a, b) => `${a.slot.date} ${a.slot.time}`.localeCompare(`${b.slot.date} ${b.slot.time}`));
  const byDate = new Map<string, AdminOrder[]>();
  for (const o of shown) byDate.set(o.slot.date, [...(byDate.get(o.slot.date) ?? []), o]);

  return (
    <section aria-label="Pedidos">
      <fieldset class="s-chips">
        <legend class="sr-only">Mostrar</legend>
        {FILTERS.map((f) => {
          const n = all.filter(f.match).length;
          const Ico = f.icon;
          return (
            <button
              key={f.id}
              type="button"
              class={`s-chip tone-${f.tone}`}
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
            >
              <Ico />
              {f.label}
              <span class="s-count">{n}</span>
            </button>
          );
        })}
      </fieldset>

      <div class="s-range">
        <details>
          <summary>
            Del {formatLocalDate(from, { weekday: undefined })} al{' '}
            {formatLocalDate(to, { weekday: undefined })}
          </summary>
          <div class="s-range-fields">
            <label>
              Desde
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom((e.target as HTMLInputElement).value)}
              />
            </label>
            <label>
              Hasta
              <input type="date" value={to} onChange={(e) => setTo((e.target as HTMLInputElement).value)} />
            </label>
          </div>
        </details>
        <button type="button" class="s-btn sec small" onClick={() => load()}>
          Actualizar
        </button>
      </div>

      {error && (
        <p class="s-banner warn" role="alert">
          {error}
        </p>
      )}
      {orders === null && !error && (
        <p class="s-mut" aria-live="polite">
          Cargando pedidos…
        </p>
      )}
      {orders && shown.length === 0 && (
        <p class="s-empty">
          {all.length ? `No hay pedidos en "${current?.label}".` : 'No hay pedidos en esas fechas.'}
        </p>
      )}
      {highlight && orders && !found && (
        <p class="s-banner">
          El pedido {highlight} no está entre estas fechas. Ajusta el rango para encontrarlo.
        </p>
      )}

      {[...byDate].map(([date, list]) => (
        <section key={date} class={date === today ? 's-day today' : 's-day'} aria-labelledby={`d-${date}`}>
          <h2 id={`d-${date}`}>
            <span>
              {dayName(date, today)}
              {date !== today && date !== addDays(today, 1) && date !== addDays(today, -1) ? (
                ''
              ) : (
                <small> · {formatLocalDate(date, { weekday: 'long', month: 'long' })}</small>
              )}
            </span>
            <small>
              {plural(list.length, 'pedido', 'pedidos')} ·{' '}
              {plural(
                list.reduce((n, o) => n + o.quote.drinks, 0),
                'bebida',
                'bebidas',
              )}
            </small>
          </h2>
          <ul class="admin-orders">
            {list.map((o) => (
              <li
                key={o.code}
                id={`order-${o.code}`}
                tabIndex={-1}
                class={o.code === highlight ? 'highlight' : undefined}
                aria-current={o.code === highlight ? 'true' : undefined}
              >
                <OrderCard
                  order={o}
                  overdue={date < today && (o.status === 'confirmed' || o.status === 'ready')}
                  manager={manager}
                  busy={busy}
                  onUpdate={update}
                  onCancel={() => setCancelling(o)}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}

      {cancelling && (
        <ConfirmDialog
          title={`¿Cancelar el pedido ${cancelling.code}?`}
          confirmLabel="Sí, cancelar"
          cancelLabel="No"
          busy={busy}
          onConfirm={async () => {
            await update(cancelling.code, { status: 'cancelled' });
            setCancelling(null);
          }}
          onClose={() => setCancelling(null)}
        >
          <p>
            El pedido libera su horario. Cancelar desde aquí no reembolsa solo: si corresponde, devuélvelo a
            mano.
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}

function dayName(date: string, today: string): string {
  if (date === today) return 'Hoy';
  if (date === addDays(today, 1)) return 'Mañana';
  if (date === addDays(today, -1)) return 'Ayer';
  const d = formatLocalDate(date);
  return d.charAt(0).toUpperCase() + d.slice(1);
}

/** Mercado Pago se reembolsa solo al cancelar; la transferencia, o un reembolso que falló, se devuelve a mano. */
function refundStatus(o: AdminOrder): string {
  const types = o.events.map((e) => e.type);
  if (types.includes('mp_refund')) return 'Reembolsado automáticamente por Mercado Pago';
  if (types.includes('mp_refund_error'))
    return 'Falló el reembolso automático: devolver a mano desde Mercado Pago';
  return o.paymentMethod === 'transfer' ? 'Devolver a mano por transferencia' : 'Devolver a mano';
}

function payment(o: AdminOrder): { tone: 'paid' | 'partial' | 'none'; text: string } {
  const total = o.quote.totalCents;
  if (o.paidCents >= total) return { tone: 'paid', text: `Pagado completo · ${formatMXN(total)}` };
  if (o.paidCents > 0)
    return {
      tone: 'partial',
      text: `Pagó ${formatMXN(o.paidCents)} · falta ${formatMXN(total - o.paidCents)}`,
    };
  const due = chargeFor(o.quote, o.paymentPlan).dueNowCents;
  return {
    tone: 'none',
    text:
      o.paymentPlan === 'full'
        ? `Sin pago · debe liquidar ${formatMXN(total)}`
        : `Sin pago · anticipo de ${formatMXN(due)} de ${formatMXN(total)}`,
  };
}

function OrderCard({
  order: o,
  overdue,
  manager,
  busy,
  onUpdate,
  onCancel,
}: {
  order: AdminOrder;
  overdue: boolean;
  /** Un barista solo ve "Marcar listo" y "Marcar entregado". */
  manager: boolean;
  busy: boolean;
  onUpdate: (code: string, body: AdminUpdateOrderRequest) => void;
  onCancel: () => void;
}) {
  const st = STAFF_STATUS[o.status];
  const StatusIcon = st.icon;
  const due = chargeFor(o.quote, o.paymentPlan).dueNowCents;
  const pay = payment(o);
  const closed = o.status === 'cancelled' || o.status === 'expired';
  return (
    <article class={`s-order st-${o.status}`}>
      <header class="s-order-head">
        <span class="s-time">{o.slot.time}</span>
        <span class="s-pill">
          <StatusIcon />
          {st.label}
        </span>
        {overdue && (
          <span class="s-pill alert">
            <IconAlert />
            Atrasado
          </span>
        )}
      </header>

      <p class="s-cust">
        <strong>{o.customerName}</strong>{' '}
        <a href={`tel:${o.customerPhone}`}>
          <IconPhone />
          {o.customerPhone}
        </a>
        <span class="s-code">{o.code}</span>
      </p>

      <ul class="s-drinks" aria-label={`${o.quote.drinks} bebidas`}>
        {o.quote.lines.map((l) => (
          <li key={`${l.itemId}-${l.variantId}-${l.options.map((x) => x.optionId).join()}`}>
            <span class="q">{l.qty}×</span>
            <span>
              {l.name}
              {l.variantLabel !== 'Regular' && ` ${l.variantLabel}`}
              {l.options.length > 0 && <span class="opt"> · {l.options.map((x) => x.label).join(', ')}</span>}
            </span>
          </li>
        ))}
        <li class="s-drinks-total">{plural(o.quote.drinks, 'bebida', 'bebidas')}</li>
      </ul>

      {!closed && (
        <p class={`s-pay ${pay.tone}`}>
          <IconPay />
          <span>
            {pay.text}
            <span class="s-meth"> · {o.paymentMethod === 'transfer' ? 'Transferencia' : 'Mercado Pago'}</span>
          </span>
        </p>
      )}

      {o.notes && (
        <p class="s-note">
          <IconNote />
          <span>{o.notes}</span>
        </p>
      )}

      {o.status === 'cancelled' && (
        <dl class="s-refund">
          <div>
            <dt>Monto a devolver</dt>
            <dd>{o.refundCents === null ? 'No aplica' : formatMXN(o.refundCents)}</dd>
          </div>
          {o.refundCents !== null && (
            <div>
              <dt>Reembolso</dt>
              <dd>{refundStatus(o)}</dd>
            </div>
          )}
          <div>
            <dt>Comisión de Mercado Pago</dt>
            <dd>{o.providerFeeCents === null ? 'Aún no se sabe' : formatMXN(o.providerFeeCents)}</dd>
          </div>
        </dl>
      )}

      <div class="s-actions">
        {manager && o.status === 'pending_payment' && (
          <button
            type="button"
            class="s-btn"
            disabled={busy}
            onClick={() => onUpdate(o.code, { status: 'confirmed', paidCents: due })}
          >
            Marcar pagado ({formatMXN(due)})
          </button>
        )}
        {o.status === 'confirmed' && (
          <button
            type="button"
            class="s-btn"
            disabled={busy}
            onClick={() => onUpdate(o.code, { status: 'ready' })}
          >
            Marcar listo
          </button>
        )}
        {(o.status === 'confirmed' || o.status === 'ready') && (
          <button
            type="button"
            class={o.status === 'ready' ? 's-btn' : 's-btn sec'}
            disabled={busy}
            onClick={() => onUpdate(o.code, { status: 'completed', paidCents: o.quote.totalCents })}
          >
            Marcar entregado y liquidado
          </button>
        )}
        {manager && (o.status === 'pending_payment' || o.status === 'confirmed' || o.status === 'ready') && (
          <button type="button" class="s-btn warn" disabled={busy} onClick={onCancel}>
            Cancelar
          </button>
        )}
      </div>
    </article>
  );
}
