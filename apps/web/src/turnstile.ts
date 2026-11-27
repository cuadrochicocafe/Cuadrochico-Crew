/**
 * Cloudflare Turnstile invisible. Solo se carga si existe `VITE_TURNSTILE_SITE_KEY`;
 * si no, el pedido se envía sin token (el servidor decide si lo exige).
 */
interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export const TURNSTILE_SITE_KEY: string = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '';

let loading: Promise<TurnstileApi> | null = null;

function load(): Promise<TurnstileApi> {
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile')));
    s.onerror = () => {
      loading = null;
      reject(new Error('turnstile'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/**
 * Monta el widget en `el` (solo se ve si Cloudflare necesita interacción).
 * Devuelve una función para desmontarlo.
 */
export function mountTurnstile(
  el: HTMLElement,
  onToken: (token: string | null) => void,
  onError: () => void,
): () => void {
  let id: string | null = null;
  let cancelled = false;
  load()
    .then((t) => {
      if (cancelled) return;
      id = t.render(el, {
        sitekey: TURNSTILE_SITE_KEY,
        appearance: 'interaction-only',
        language: 'es',
        callback: (token: string) => onToken(token),
        'expired-callback': () => onToken(null),
        'error-callback': () => {
          onToken(null);
          onError();
        },
      });
    })
    .catch(() => {
      if (!cancelled) onError();
    });
  return () => {
    cancelled = true;
    if (id && window.turnstile) window.turnstile.remove(id);
  };
}
