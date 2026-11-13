// Arranque de la app: comprobar la sesión, registrar las rutas y el service worker.
import { ApiError, get, onUnauthorized } from './api';
import { h } from './dom';
import { navigate, resolve, route, setRenderer } from './router';
import { store } from './store';
import type { User } from './types';
import { emptyState, shell, toast } from './ui';
import { adminView } from './views/admin';
import { forgot, landing, login, register, reset } from './views/auth';
import { cardsView } from './views/cards';
import { home } from './views/home';
import { progressView } from './views/progress';
import { settingsView } from './views/settings';
import { sharedView } from './views/shared';
import { studyRoute } from './views/study';

const app = document.getElementById('app')!;
const LAST_USER = 'fichario:usuario';

type View = Parameters<typeof route>[1];
const signedIn = (view: View): View => (params, query) => (store.user ? view(params, query) : (navigate('/entrar', { replace: true }), document.createTextNode('')));
const signedOut = (view: View): View => (params, query) => (store.user ? (navigate('/', { replace: true }), document.createTextNode('')) : view(params, query));

route('/', () => (store.user ? home() : landing()));
route('/entrar', signedOut(login));
route('/registro', signedOut(register));
route('/olvide', signedOut(forgot));
route('/restablecer', reset);
route('/c/:token', sharedView);
route('/estudiar/:id', signedIn(studyRoute));
route('/tarjetas', signedIn(cardsView));
route('/progreso', signedIn(progressView));
route('/ajustes', signedIn(settingsView));
route('/admin', signedIn(adminView));

setRenderer(
  (node) => {
    app.replaceChildren(node);
    const title = (node as HTMLElement).querySelector?.('h1')?.textContent;
    document.title = title && title !== 'Fichario' ? `${title}. Fichario` : 'Fichario';
  },
  () => (store.user ? shell('', emptyState('Esta página no existe', 'Puede que el enlace esté mal copiado.', h('a', { class: 'btn btn-primary', href: '/', 'data-link': true }, 'Volver al inicio')))
    : emptyState('Esta página no existe', 'Puede que el enlace esté mal copiado.', h('a', { class: 'btn btn-primary', href: '/', 'data-link': true }, 'Ir a Fichario'))),
);

onUnauthorized(() => {
  if (!store.user) return;
  store.setUser(null);
  localStorage.removeItem(LAST_USER);
  toast('La sesión ha caducado. Vuelve a entrar.', 'error');
  navigate('/entrar', { replace: true });
});

store.subscribe(() => {
  if (store.user) localStorage.setItem(LAST_USER, JSON.stringify(store.user));
  else localStorage.removeItem(LAST_USER);
});

async function boot() {
  // Sin conexión se abre con el último usuario conocido y sus datos guardados.
  let cached: User | null = null;
  try {
    cached = JSON.parse(localStorage.getItem(LAST_USER) ?? 'null');
  } catch {
    /* nada */
  }
  if (cached) store.setUser(cached);
  try {
    const { user } = await get<{ user: User }>('/api/auth/me');
    if (user.id !== cached?.id) store.setUser(user);
    else store.user = user;
    void store.sync();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) store.setUser(null);
    else if (cached) store.status = 'offline';
  }
  await resolve();
}

void boot();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js'));
}
