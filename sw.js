// Cuadrochico · copia local para abrir la página aunque la red esté lenta o caída.
// Solo guarda los archivos de la propia página (no toca las peticiones a Google).
const CACHE = 'cc-shell-1';
const ARCHIVOS = ['index.html', 'usuarios.js', 'logo_vaso.svg', 'logo_cuadrochico.svg', 'icono.svg', 'favicon-32.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest'];
const PACIENCIA = 3000;                                         // ms que se espera a la red por la página antes de usar la copia
const PACIENCIA_USUARIOS = 1200;                                // el archivo de usuarios es pequeño: si la red no responde pronto, se usa la copia
const INDEX = new URL('index.html', self.registration.scope).href;

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(ARCHIVOS.map(u => c.add(new Request(u, {cache: 'reload'})).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE && k.indexOf('cc-shell-') === 0) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function redPrimero(e, destino, clave, paciencia){
  const cache = await caches.open(CACHE);
  const red = fetch(destino, {cache: 'no-cache'}).then(r => { if (r && r.ok) cache.put(clave, r.clone()); return r; });
  e.waitUntil(red.then(() => {}, () => {}));                    // sigue actualizando la copia aunque se acabe la paciencia
  const espera = new Promise((ok, mal) => setTimeout(() => mal(new Error('paciencia')), paciencia || PACIENCIA));
  try {
    const r = await Promise.race([red, espera]);
    if (r.ok || r.type === 'opaqueredirect') return r;
    const c = await cache.match(clave, {ignoreSearch: true}); return c || r;
  } catch (x) {
    const c = await cache.match(clave, {ignoreSearch: true}); if (c) return c; return red;
  }
}

async function cachePrimero(e, req){
  const cache = await caches.open(CACHE), c = await cache.match(req, {ignoreSearch: true});
  const red = fetch(req).then(r => { if (r && r.ok) cache.put(req, r.clone()); return r; });
  if (c) { e.waitUntil(red.then(() => {}, () => {})); return c; }
  return red;
}

self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url); if (url.origin !== self.location.origin) return;      // Google y lo demás va directo a la red
  const nombre = url.pathname.split('/').pop();
  if (req.mode === 'navigate') return e.respondWith(redPrimero(e, INDEX, INDEX));
  if (nombre === 'index.html' || nombre === 'usuarios.js') return e.respondWith(redPrimero(e, req.url.split('#')[0], url.origin + url.pathname, nombre === 'usuarios.js' ? PACIENCIA_USUARIOS : PACIENCIA));
  if (ARCHIVOS.indexOf(nombre) >= 0) return e.respondWith(cachePrimero(e, req));
});
