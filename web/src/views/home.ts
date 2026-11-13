// Inicio: qué estudiar hoy.
import { type Child, h, percent, plural, replace } from '../dom';
import { onLeave } from '../router';
import { store } from '../store';
import { dot, emptyState, shell } from '../ui';

export function home(): HTMLElement {
  const body = h('div', { class: 'home' });
  const paint = () => {
    replace(body, content());
  };
  paint();
  onLeave(store.subscribe(paint));
  void store.loadStats();
  return shell('/', body);
}

function content(): Child[] {
  const folders = store.folderList();
  const total = Object.keys(store.cards).length;
  const stats = store.stats;
  const name = store.user?.name?.split(' ')[0];

  if (!total) {
    return [
      h('h1', { class: 'page-title' }, name ? `Hola, ${name}` : 'Hola'),
      emptyState('Aún no tienes tarjetas',
        'Crea una carpeta para un tema y añade tus primeras preguntas. También puedes importar un CSV de la versión anterior.',
        h('a', { class: 'btn btn-primary', href: '/tarjetas?nueva=1', 'data-link': true }, 'Crear una tarjeta'),
        h('a', { class: 'btn btn-quiet', href: '/tarjetas?importar=1', 'data-link': true }, 'Importar un CSV')),
    ];
  }

  const perFolder = new Map((stats?.folders ?? []).map((f) => [f.id, f]));
  const loose = store.cardsIn(null).length;
  const weak = (stats?.weak ?? []).filter((w) => store.cards[w.card_id]).length;

  const summary: (string | Node)[] = [];
  if (stats) {
    summary.push(stats.streak ? `${plural(stats.streak, 'día', 'días')} seguidos estudiando` : 'Hoy es buen día para empezar una racha');
    const today = stats.heatmap.at(-1)?.count ?? 0;
    if (today) summary.push(`, ${plural(today, 'respuesta', 'respuestas')} hoy`);
    summary.push('.');
  }

  return [
    h('div', { class: 'home-head' },
      h('h1', { class: 'page-title' }, '¿Qué estudiamos hoy?'),
      summary.length ? h('p', { class: 'muted' }, ...summary) : null,
    ),
    weak >= 3 &&
      h('a', { class: 'weak-banner', href: '/estudiar/flojas', 'data-link': true },
        h('span', { class: 'weak-n' }, String(weak)),
        h('span', null, h('strong', null, 'Tarjetas que más fallas'), h('span', { class: 'muted' }, 'Repásalas juntas en una sesión corta')),
      ),
    h('ul', { class: 'folder-list', 'aria-label': 'Carpetas' },
      folders.map((f) => {
        const n = store.cardsIn(f.id).length;
        const s = perFolder.get(f.id);
        return folderRow(`/estudiar/${f.id}`, f.color, f.name, plural(n, 'tarjeta', 'tarjetas') + (f.source ? `, de ${f.source}` : ''), s?.accuracy ?? null, n === 0);
      }),
      loose > 0 && folderRow('/estudiar/sin-carpeta', '', 'Sin carpeta', plural(loose, 'tarjeta', 'tarjetas'), null, false),
      folders.length > 1 && folderRow('/estudiar/todas', 'var(--ink)', 'Todas las carpetas', plural(total, 'tarjeta', 'tarjetas'), null, false),
    ),
  ];
}

function folderRow(href: string, color: string, name: string, meta: string, accuracy: number | null, empty: boolean) {
  const inner = [
    dot(color),
    h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, name), h('span', { class: 'row-meta' }, meta)),
    h('span', { class: 'row-num', title: 'Aciertos en esta carpeta' }, accuracy === null ? '' : percent(accuracy)),
  ];
  return h('li', null, empty
    ? h('span', { class: 'folder-row is-empty' }, ...inner)
    : h('a', { class: 'folder-row', href, 'data-link': true }, ...inner));
}
