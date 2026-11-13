// Enrutado en el navegador con la History API. Los enlaces internos llevan data-link.
type View = (params: Record<string, string>, query: URLSearchParams) => Promise<Node> | Node;
interface Route {
  regex: RegExp;
  keys: string[];
  view: View;
}

const routes: Route[] = [];
let render: (node: Node) => void = () => {};
let notFound: View = () => document.createTextNode('');

export function route(pattern: string, view: View) {
  const keys: string[] = [];
  const regex = new RegExp(
    '^' + pattern.replace(/\/:([a-z_]+)/gi, (_, k) => (keys.push(k), '/([^/]+)')) + '/?$',
  );
  routes.push({ regex, keys, view });
}

export function setRenderer(fn: (node: Node) => void, fallback: View) {
  render = fn;
  notFound = fallback;
}

// Lo que una vista necesita deshacer al salir de ella (suscripciones, temporizadores, teclas).
let cleanups: (() => void)[] = [];
export function onLeave(fn: () => void) {
  cleanups.push(fn);
}
function leave() {
  const fns = cleanups;
  cleanups = [];
  fns.forEach((fn) => fn());
}

let token = 0;
export async function resolve() {
  const current = ++token;
  leave();
  const { pathname, search } = location;
  const query = new URLSearchParams(search);
  for (const r of routes) {
    const m = r.regex.exec(pathname);
    if (!m) continue;
    const params: Record<string, string> = {};
    r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    const node = await r.view(params, query);
    if (current === token) render(node);
    return;
  }
  const node = await notFound({}, query);
  if (current === token) render(node);
}

export function navigate(path: string, { replace = false } = {}) {
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  window.scrollTo(0, 0);
  void resolve();
}

window.addEventListener('popstate', () => void resolve());
document.addEventListener('click', (event) => {
  const a = (event.target as Element).closest?.('a[data-link]') as HTMLAnchorElement | null;
  if (!a || event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
  event.preventDefault();
  navigate(a.getAttribute('href') ?? '/');
});
