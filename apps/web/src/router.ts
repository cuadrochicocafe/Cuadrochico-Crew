import { useEffect, useState } from 'preact/hooks';

const EVENT = 'cc:navigate';

/** Navega dentro de la app sin recargar. */
export function navigate(url: string, { replace = false } = {}): void {
  if (replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
  window.dispatchEvent(new Event(EVENT));
}

export interface Location {
  path: string;
  query: URLSearchParams;
}

const read = (): Location => ({ path: location.pathname, query: new URLSearchParams(location.search) });

export function useLocation(): Location {
  const [loc, setLoc] = useState(read);
  useEffect(() => {
    const update = () => setLoc(read());
    window.addEventListener('popstate', update);
    window.addEventListener(EVENT, update);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener(EVENT, update);
    };
  }, []);
  return loc;
}

export type Route =
  | { name: 'order-flow' }
  | { name: 'order'; code: string }
  | { name: 'admin' }
  | { name: 'not-found' };

export function matchRoute(path: string): Route {
  const clean = path.replace(/\/+$/, '') || '/';
  if (clean === '/') return { name: 'order-flow' };
  if (clean === '/admin') return { name: 'admin' };
  const m = /^\/pedido\/([^/]+)$/.exec(clean);
  if (m?.[1]) return { name: 'order', code: decodeURIComponent(m[1]) };
  return { name: 'not-found' };
}
