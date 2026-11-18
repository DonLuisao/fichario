// Piezas comunes de la interfaz: avisos, diálogos, marco de la app y formularios.
import { type Child, h, replace } from './dom';
import { navigate, onLeave } from './router';
import { store } from './store';

// ---- Avisos breves ----

let toastBox: HTMLElement | null = null;
export function toast(message: string, kind: 'info' | 'error' = 'info') {
  if (!toastBox) {
    toastBox = h('div', { class: 'toasts', role: 'status' });
    document.body.append(toastBox);
  }
  const el = h('div', { class: `toast toast-${kind}` }, message);
  toastBox.append(el);
  // Como mucho dos a la vez: los avisos viejos sobran cuando llega uno nuevo.
  while (toastBox.children.length > 2) toastBox.firstElementChild!.remove();
  setTimeout(() => el.classList.add('toast-out'), 3200);
  setTimeout(() => el.remove(), 3600);
}

// ---- Diálogos ----

export function dialog(title: string, body: Node, opts: { wide?: boolean } = {}): { el: HTMLDialogElement; close: () => void } {
  const el = h('dialog', { class: opts.wide ? 'dialog dialog-wide' : 'dialog', 'aria-label': title });
  const close = () => {
    el.close();
  };
  el.append(
    h('header', { class: 'dialog-head' },
      h('h2', null, title),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Cerrar', onClick: close }, icon('close')),
    ),
    body,
  );
  el.addEventListener('close', () => el.remove());
  el.addEventListener('click', (e) => {
    if (e.target === el) close();
  });
  document.body.append(el);
  el.showModal();
  return { el, close };
}

export function confirmDialog(title: string, message: string, action: string, danger = true): Promise<boolean> {
  return new Promise((resolve) => {
    let answered = false;
    const body = h('div', { class: 'dialog-body' },
      h('p', null, message),
      h('div', { class: 'dialog-actions' },
        h('button', { class: 'btn btn-quiet', type: 'button', onClick: () => d.close() }, 'Cancelar'),
        h('button', {
          class: danger ? 'btn btn-danger' : 'btn btn-primary',
          type: 'button',
          onClick: () => {
            answered = true;
            resolve(true);
            d.close();
          },
        }, action),
      ),
    );
    const d = dialog(title, body);
    d.el.addEventListener('close', () => answered || resolve(false));
  });
}

// ---- Iconos (trazos simples, sin dependencias) ----

const ICONS: Record<string, string> = {
  close: 'M6 6l12 12M18 6L6 18',
  study: 'M4 6h11a3 3 0 013 3v9H7a3 3 0 01-3-3zM8 10h6M8 14h4',
  cards: 'M7 4h11v13M4 7h11v13H4z',
  progress: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  settings: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM16 16l5 5',
  share: 'M8 12h8M12 8l4 4-4 4M4 4v16',
  back: 'M15 5l-7 7 7 7',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  check: 'M5 12l5 5 9-10',
  cloud: 'M7 18h10a4 4 0 000-8 6 6 0 00-11.5 1.5A3.3 3.3 0 007 18z',
  offline: 'M7 18h10a4 4 0 000-8 6 6 0 00-11.5 1.5A3.3 3.3 0 007 18zM3 3l18 18',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
};

export function icon(name: string): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'icon');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', ICONS[name] ?? '');
  svg.append(path);
  return svg;
}

// ---- Marco de la app con sesión iniciada ----

const TABS = [
  { href: '/', label: 'Estudiar', icon: 'study' },
  { href: '/tarjetas', label: 'Tarjetas', icon: 'cards' },
  { href: '/progreso', label: 'Progreso', icon: 'progress' },
  { href: '/ajustes', label: 'Ajustes', icon: 'settings' },
];

function syncBadge(): HTMLElement {
  const el = h('span', { class: 'sync', role: 'status' });
  const paint = () => {
    const n = store.pendingCount();
    const map = {
      ok: ['sync-ok', 'cloud', 'Guardado'],
      syncing: ['sync-busy', 'cloud', 'Guardando…'],
      offline: ['sync-off', 'offline', n ? `Sin conexión, ${n} sin subir` : 'Sin conexión'],
      error: ['sync-err', 'offline', 'No se ha podido guardar'],
    } as const;
    const [cls, ic, text] = map[store.status];
    el.className = `sync ${cls}`;
    replace(el, icon(ic), h('span', null, text));
    el.title = store.status === 'error' ? 'Se volverá a intentar en unos segundos' : '';
  };
  paint();
  onLeave(store.subscribe(paint));
  return el;
}

export function shell(active: string, ...content: Child[]): HTMLElement {
  const user = store.user;
  return h('div', { class: 'shell' },
    user?.is_demo &&
      h('div', { class: 'demo-bar' },
        'Estás en la demo: puedes probarlo todo, pero no se guarda nada. ',
        h('a', { href: '/registro', 'data-link': true }, 'Tengo una invitación'),
      ),
    h('header', { class: 'topbar' },
      h('a', { class: 'brand', href: '/', 'data-link': true }, h('img', { src: '/icons/icon.svg', alt: '', width: 26, height: 26 }), 'Repaso'),
      h('nav', { class: 'tabs', 'aria-label': 'Secciones' },
        TABS.map((t) =>
          h('a', { href: t.href, 'data-link': true, class: t.href === active ? 'tab is-active' : 'tab', 'aria-current': t.href === active ? 'page' : null },
            icon(t.icon), h('span', null, t.label)),
        ),
      ),
      syncBadge(),
    ),
    h('main', { class: 'page', id: 'contenido' }, ...content),
  );
}

// ---- Formularios ----

export function field(label: string, input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, hint?: string): HTMLElement {
  const id = input.id || `f-${Math.random().toString(36).slice(2, 9)}`;
  input.id = id;
  return h('div', { class: 'field' }, h('label', { for: id }, label), input, hint && h('p', { class: 'hint' }, hint));
}

export function formError(): { el: HTMLElement; show: (msg: string) => void; clear: () => void } {
  const el = h('p', { class: 'form-error', role: 'alert', hidden: true });
  return {
    el,
    show: (msg) => {
      el.textContent = msg;
      el.hidden = false;
    },
    clear: () => {
      el.hidden = true;
    },
  };
}

// Deshabilita el botón mientras se envía, para no mandar dos veces.
export async function busy<T>(button: HTMLButtonElement, fn: () => Promise<T>): Promise<T> {
  const label = button.textContent;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.textContent = label;
  }
}

export function go(path: string) {
  navigate(path);
}

export function emptyState(title: string, text: string, ...actions: Child[]): HTMLElement {
  return h('div', { class: 'empty' }, h('h2', null, title), h('p', null, text), actions.length ? h('div', { class: 'empty-actions' }, ...actions) : null);
}

export function dot(color: string): HTMLElement {
  return h('span', { class: 'dot', style: { '--c': color || 'var(--accent)' } });
}
