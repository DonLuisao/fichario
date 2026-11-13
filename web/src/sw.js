// Service worker de Fichario: guarda la app para que funcione sin conexión.
// Las peticiones a /api nunca se guardan: los datos los gestiona la propia app.
const VERSION = '__VERSION__';
const CACHE = `fichario-${VERSION}`;
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('fichario-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // Páginas: primero la red, para recibir siempre la última versión; sin conexión, la guardada.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/')));
    return;
  }
  // Archivos de la app: llevan hash en el nombre, así que la copia guardada siempre es válida.
  event.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
});
