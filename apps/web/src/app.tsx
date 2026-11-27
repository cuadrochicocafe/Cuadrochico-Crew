import type { Menu, Settings } from '@cuadrochico/core';
import { useEffect, useState } from 'preact/hooks';
import { api, apiErrorMessage, toApiError } from './api';
import { contactLink, toCoreSettings } from './lib';
import { OrderFlow } from './order/OrderFlow';
import { AdminPage } from './pages/AdminPage';
import { OrderPage } from './pages/OrderPage';
import { matchRoute, navigate, useLocation } from './router';

type Catalog =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; menu: Menu; settings: Settings };

export function App() {
  const loc = useLocation();
  const route = matchRoute(loc.path);
  const [catalog, setCatalog] = useState<Catalog>({ status: 'loading' });

  const load = () => {
    setCatalog({ status: 'loading' });
    api
      .catalog()
      .then((c) => setCatalog({ status: 'ready', menu: c.menu, settings: toCoreSettings(c.settings) }))
      .catch((e: unknown) => setCatalog({ status: 'error', message: apiErrorMessage(toApiError(e)) }));
  };
  useEffect(load, []);

  return (
    <>
      <a class="skip" href="#main">
        Saltar al contenido
      </a>
      <header class="site-header">
        <a
          href="/"
          onClick={(e) => {
            if (route.name === 'order-flow') return;
            e.preventDefault();
            navigate('/');
          }}
        >
          <img src="/logo_cuadrochico.svg" alt="Cuadrochico" width={160} height={42} />
        </a>
        <p class="tagline">
          Pedidos de mayoreo · <span class="hand">todo frío</span>
        </p>
      </header>
      <main id="main">
        {catalog.status === 'loading' && <p aria-live="polite">Cargando…</p>}
        {catalog.status === 'error' && (
          <div role="alert" class="error">
            <p>{catalog.message}</p>
            <button type="button" class="btn" onClick={load}>
              Intentar de nuevo
            </button>
          </div>
        )}
        {catalog.status === 'ready' && (
          <>
            {route.name === 'order-flow' && <OrderFlow menu={catalog.menu} settings={catalog.settings} />}
            {route.name === 'order' && (
              <OrderPage settings={catalog.settings} code={route.code} token={loc.query.get('t') ?? ''} />
            )}
            {route.name === 'admin' && <AdminPage settings={catalog.settings} />}
            {route.name === 'not-found' && (
              <p>
                No encontramos esta página. <a href="/">Haz un pedido</a>.
              </p>
            )}
          </>
        )}
      </main>
      {catalog.status === 'ready' && (
        <footer class="site-footer">
          <img src="/logo_vaso.svg" alt="" width={36} height={46} />
          <p>
            {catalog.settings.fulfillment.pickup.address}.{' '}
            <a href={contactLink(catalog.settings).href} target="_blank" rel="noopener noreferrer">
              {contactLink(catalog.settings).label}
            </a>
          </p>
        </footer>
      )}
    </>
  );
}
