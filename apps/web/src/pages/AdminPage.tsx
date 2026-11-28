import {
  type AdminOrder,
  type AdminUpdateOrderRequest,
  addDays,
  chargeFor,
  formatMXN,
  localDate,
  type PrepResponse,
  type Settings,
  type StaffListResponse,
  type StaffRole,
} from '@cuadrochico/core';
import { useEffect, useState } from 'preact/hooks';
import { ApiRequestError, adminApi, apiErrorMessage, staffApi, toApiError } from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { formatLocalDate, STATUS_LABEL } from '../lib';

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

/** `highlight`: código que llega en `/admin?pedido=CODE` (enlace del evento de Google Calendar). */
export function AdminPage({ settings, highlight = null }: { settings: Settings; highlight?: string | null }) {
  const [session, setSession] = useState(() => sessionFrom(readToken()));
  const [tab, setTab] = useState<'orders' | 'prep'>('orders');

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

  const token = session.token;
  return (
    <div class="admin">
      <div class="admin-bar">
        <h2>Panel del equipo</h2>
        <p class="muted small">
          {session.name} · {session.role === 'manager' ? 'gerente' : 'barista'}
        </p>
        <button type="button" class="btn small" onClick={logout}>
          Salir
        </button>
      </div>
      <div class="tabs">
        <button
          type="button"
          class={tab === 'orders' ? 'btn primary' : 'btn'}
          aria-pressed={tab === 'orders'}
          onClick={() => setTab('orders')}
        >
          Pedidos
        </button>
        <button
          type="button"
          class={tab === 'prep' ? 'btn primary' : 'btn'}
          aria-pressed={tab === 'prep'}
          onClick={() => setTab('prep')}
        >
          Producción del día
        </button>
      </div>
      {tab === 'orders' ? (
        <Orders
          token={token}
          manager={session.role === 'manager'}
          settings={settings}
          highlight={highlight}
          onUnauthorized={logout}
        />
      ) : (
        <Prep token={token} settings={settings} onUnauthorized={logout} />
      )}
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
    <div class="card">
      <h2>Panel del equipo</h2>
      <form onSubmit={submit}>
        <div class="field">
          <label for="staff-name">Nombre</label>
          <select
            id="staff-name"
            value={name}
            onChange={(e) => setName((e.target as HTMLSelectElement).value)}
          >
            <option value="">{staff === null ? 'Cargando…' : 'Elige tu nombre'}</option>
            {staff?.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div class="field">
          <label for="staff-pin">PIN</label>
          <input
            id="staff-pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            value={pin}
            onInput={(e) => setPin((e.target as HTMLInputElement).value)}
          />
        </div>
        {error && (
          <p class="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" class="btn primary" disabled={busy}>
          Entrar
        </button>
      </form>
      <details class="small">
        <summary>Entrar con el token de administrador</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (adminToken.trim()) onToken(adminToken.trim());
          }}
        >
          <div class="field">
            <label for="admin-token">Token de acceso</label>
            <input
              id="admin-token"
              type="password"
              autoComplete="off"
              value={adminToken}
              onInput={(e) => setAdminToken((e.target as HTMLInputElement).value)}
            />
          </div>
          <button type="submit" class="btn">
            Entrar con token
          </button>
        </form>
      </details>
    </div>
  );
}

interface TabProps {
  token: string;
  settings: Settings;
  onUnauthorized: () => void;
}

function Orders({
  token,
  manager,
  settings,
  highlight,
  onUnauthorized,
}: TabProps & { highlight: string | null; manager: boolean }) {
  const today = localDate(new Date(), settings.timezone);
  // Con un pedido señalado se abre un rango amplio para que aparezca aunque sea de otra semana.
  const [from, setFrom] = useState(highlight ? addDays(today, -30) : today);
  const [to, setTo] = useState(addDays(today, highlight ? settings.maxDaysAhead : 14));
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

  const byDate = new Map<string, AdminOrder[]>();
  for (const o of [...(orders ?? [])].sort((a, b) =>
    `${a.slot.date} ${a.slot.time}`.localeCompare(`${b.slot.date} ${b.slot.time}`),
  ))
    byDate.set(o.slot.date, [...(byDate.get(o.slot.date) ?? []), o]);

  return (
    <section aria-label="Pedidos por fecha">
      <div class="filters">
        <div class="field">
          <label for="from">Desde</label>
          <input
            id="from"
            type="date"
            value={from}
            onChange={(e) => setFrom((e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="field">
          <label for="to">Hasta</label>
          <input
            id="to"
            type="date"
            value={to}
            onChange={(e) => setTo((e.target as HTMLInputElement).value)}
          />
        </div>
        <button type="button" class="btn" onClick={() => load()}>
          Actualizar
        </button>
      </div>
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      {orders === null && !error && <p aria-live="polite">Cargando pedidos…</p>}
      {orders?.length === 0 && <p>No hay pedidos en esas fechas.</p>}
      {highlight && orders && !found && (
        <p class="notice">
          El pedido {highlight} no está entre estas fechas. Ajusta el rango para encontrarlo.
        </p>
      )}
      {[...byDate].map(([date, list]) => (
        <section key={date} aria-labelledby={`d-${date}`}>
          <h3 id={`d-${date}`}>{formatLocalDate(date)}</h3>
          <ul class="admin-orders">
            {list.map((o) => (
              <li
                key={o.code}
                id={`order-${o.code}`}
                tabIndex={-1}
                class={o.code === highlight ? 'card highlight' : 'card'}
                aria-current={o.code === highlight ? 'true' : undefined}
              >
                <AdminOrderCard
                  order={o}
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

/** Mercado Pago se reembolsa solo al cancelar; la transferencia, o un reembolso que falló, se devuelve a mano. */
function refundStatus(o: AdminOrder): string {
  const types = o.events.map((e) => e.type);
  if (types.includes('mp_refund')) return 'Reembolsado automáticamente por Mercado Pago';
  if (types.includes('mp_refund_error'))
    return 'Falló el reembolso automático: devolver a mano desde Mercado Pago';
  return o.paymentMethod === 'transfer' ? 'Devolver a mano por transferencia' : 'Devolver a mano';
}

function AdminOrderCard({
  order: o,
  manager,
  busy,
  onUpdate,
  onCancel,
}: {
  order: AdminOrder;
  /** Un barista solo ve "Marcar listo" y "Marcar entregado". */
  manager: boolean;
  busy: boolean;
  onUpdate: (code: string, body: AdminUpdateOrderRequest) => void;
  onCancel: () => void;
}) {
  const due = chargeFor(o.quote, o.paymentPlan).dueNowCents;
  const balance = Math.max(0, o.quote.totalCents - o.paidCents);
  return (
    <>
      <p>
        <strong>
          {o.slot.time} · {o.code}
        </strong>{' '}
        · {STATUS_LABEL[o.status]}
      </p>
      <p>
        {o.customerName} · <a href={`tel:${o.customerPhone}`}>{o.customerPhone}</a>
        {o.customerEmail && ` · ${o.customerEmail}`}
      </p>
      <p>
        {o.quote.drinks} bebidas · Total {formatMXN(o.quote.totalCents)} · Pagado {formatMXN(o.paidCents)} ·
        Por pagar {formatMXN(balance)}
      </p>
      <p class="muted small">
        {o.paymentMethod === 'transfer' ? 'Transferencia' : 'Mercado Pago'} ·{' '}
        {o.paymentPlan === 'full' ? 'Liquida el 100 %' : `Anticipo (${formatMXN(due)})`}
      </p>
      <ul class="lines small">
        {o.quote.lines.map((l) => (
          <li key={`${l.itemId}-${l.variantId}-${l.options.map((x) => x.optionId).join()}`}>
            {l.qty} × {l.name} {l.variantLabel} {l.options.map((x) => x.label).join(', ')}
          </li>
        ))}
      </ul>
      {o.notes && <p class="muted">Notas: {o.notes}</p>}
      {o.status === 'cancelled' && (
        <dl class="refund">
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
      <div class="actions">
        {manager && o.status === 'pending_payment' && (
          <button
            type="button"
            class="btn small"
            disabled={busy}
            onClick={() => onUpdate(o.code, { status: 'confirmed', paidCents: due })}
          >
            Marcar pagado ({formatMXN(due)})
          </button>
        )}
        {o.status === 'confirmed' && (
          <button
            type="button"
            class="btn small"
            disabled={busy}
            onClick={() => onUpdate(o.code, { status: 'ready' })}
          >
            Marcar listo
          </button>
        )}
        {(o.status === 'confirmed' || o.status === 'ready') && (
          <button
            type="button"
            class="btn small"
            disabled={busy}
            onClick={() => onUpdate(o.code, { status: 'completed', paidCents: o.quote.totalCents })}
          >
            Marcar entregado y liquidado
          </button>
        )}
        {manager && (o.status === 'pending_payment' || o.status === 'confirmed' || o.status === 'ready') && (
          <button type="button" class="btn small danger" disabled={busy} onClick={onCancel}>
            Cancelar
          </button>
        )}
      </div>
    </>
  );
}

function Prep({ token, settings, onUnauthorized }: TabProps) {
  const [date, setDate] = useState(localDate(new Date(), settings.timezone));
  const [prep, setPrep] = useState<PrepResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPrep(null);
    setError(null);
    adminApi
      .prep(token, date)
      .then(setPrep)
      .catch((e: unknown) => {
        const err = toApiError(e);
        if (err.error === 'unauthorized') onUnauthorized();
        else setError(apiErrorMessage(err));
      });
  }, [date]);

  return (
    <section aria-label="Hoja de producción">
      <div class="filters">
        <div class="field">
          <label for="prep-date">Fecha</label>
          <input
            id="prep-date"
            type="date"
            value={date}
            onChange={(e) => setDate((e.target as HTMLInputElement).value)}
          />
        </div>
        <button type="button" class="btn" onClick={() => window.print()}>
          Imprimir
        </button>
      </div>
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      {!prep && !error && <p aria-live="polite">Cargando…</p>}
      {prep && (
        <>
          <h3>{formatLocalDate(prep.date)}</h3>
          {prep.totals.length === 0 ? (
            <p>No hay bebidas que preparar ese día.</p>
          ) : (
            <table class="prep">
              <caption class="sr-only">Bebidas a preparar</caption>
              <thead>
                <tr>
                  <th scope="col">Bebida</th>
                  <th scope="col">Opciones</th>
                  <th scope="col">Cantidad</th>
                </tr>
              </thead>
              <tbody>
                {prep.totals.map((t) => (
                  <tr key={`${t.name}-${t.variantLabel}-${t.options}`}>
                    <td>
                      {t.name} {t.variantLabel}
                    </td>
                    <td>{t.options}</td>
                    <td>{t.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <h4>Pedidos</h4>
          <ul>
            {prep.orders.map((o) => (
              <li key={o.code}>
                {o.time} · {o.code} · {o.customerName} · {o.drinks} bebidas · {STATUS_LABEL[o.status]}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
