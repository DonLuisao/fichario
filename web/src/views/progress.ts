// Progreso: racha, aciertos, mapa de actividad, carpetas y tarjetas flojas.
import { type Child, h, percent, plural, replace } from '../dom';
import { onLeave } from '../router';
import { store } from '../store';
import type { Stats } from '../types';
import { dot, emptyState, shell } from '../ui';

export function progressView(): HTMLElement {
  const body = h('div', { class: 'progress-page' });
  const paint = () => replace(body, content(store.stats));
  paint();
  onLeave(store.subscribe(paint));
  void store.loadStats();
  return shell('/progreso', h('h1', { class: 'page-title' }, 'Progreso'), body);
}

function content(stats: Stats | null): Child[] {
  if (!stats) return [h('p', { class: 'muted' }, 'Cargando estadísticas…')];
  const answered = stats.heatmap.reduce((n, d) => n + d.count, 0);
  if (!answered && !stats.month.answers) {
    return [emptyState('Aún no hay respuestas', 'Haz una sesión de estudio y aquí verás tu racha, tus aciertos por carpeta y las tarjetas que más te cuestan.',
      h('a', { class: 'btn btn-primary', href: '/', 'data-link': true }, 'Empezar a estudiar'))];
  }

  return [
    h('div', { class: 'kpis' },
      kpi(String(stats.streak), stats.streak === 1 ? 'día de racha' : 'días de racha'),
      kpi(stats.month.answers.toLocaleString('es'), 'respuestas en 30 días'),
      kpi(percent(stats.month.accuracy), 'aciertos en 30 días'),
      kpi(stats.total_cards.toLocaleString('es'), 'tarjetas en total'),
    ),
    h('section', { class: 'panel' },
      h('h2', null, 'Actividad de las últimas 12 semanas'),
      heatmap(stats),
    ),
    h('section', { class: 'panel' },
      h('h2', null, 'Aciertos por carpeta'),
      h('ul', { class: 'bars' },
        stats.folders.filter((f) => f.cards > 0).map((f) =>
          h('li', { class: 'bar-row' },
            h('span', { class: 'bar-label' }, dot(f.color), h('span', null, f.name)),
            h('span', { class: 'bar-track' }, f.accuracy !== null && h('span', { class: 'bar-fill', style: { '--p': `${Math.round(f.accuracy * 100)}%`, '--c': f.color || 'var(--accent)' } })),
            h('span', { class: 'bar-num num' }, f.accuracy === null ? 'sin datos' : percent(f.accuracy)),
          )),
      ),
    ),
    weakList(stats),
  ];
}

function kpi(value: string, label: string) {
  return h('div', { class: 'kpi' }, h('span', { class: 'kpi-value num' }, value), h('span', { class: 'kpi-label' }, label));
}

function heatmap(stats: Stats) {
  const max = Math.max(1, ...stats.heatmap.map((d) => d.count));
  // 84 días en columnas de semana. La primera columna empieza en lunes.
  const first = new Date(stats.heatmap[0].day + 'T12:00:00');
  const offset = (first.getDay() + 6) % 7;
  const cells: Node[] = Array.from({ length: offset }, () => h('span', { class: 'cell cell-pad' }));
  for (const d of stats.heatmap) {
    const level = d.count === 0 ? 0 : Math.min(4, Math.ceil((d.count / max) * 4));
    const date = new Date(d.day + 'T12:00:00').toLocaleDateString('es', { day: 'numeric', month: 'long' });
    cells.push(h('span', { class: `cell l${level}`, title: `${date}: ${plural(d.count, 'respuesta', 'respuestas')}` }));
  }
  const legend = h('div', { class: 'heatmap-legend', 'aria-hidden': 'true' },
    h('span', null, 'Menos'), ...[0, 1, 2, 3, 4].map((l) => h('span', { class: `cell l${l}` })), h('span', null, 'Más'));
  return h('div', null, h('div', { class: 'heatmap-wrap' },
    h('div', { class: 'heatmap-days', 'aria-hidden': 'true' }, ...['L', '', 'X', '', 'V', '', 'D'].map((t) => h('span', null, t))),
    h('div', { class: 'heatmap', role: 'img', 'aria-label': `${plural(stats.heatmap.filter((d) => d.count).length, 'día', 'días')} con actividad en las últimas 12 semanas` }, ...cells),
  ), legend);
}

function weakList(stats: Stats) {
  const weak = stats.weak.map((w) => ({ ...w, card: store.cards[w.card_id] })).filter((w) => w.card).slice(0, 10);
  if (!weak.length) return null;
  return h('section', { class: 'panel' },
    h('div', { class: 'panel-head' },
      h('h2', null, 'Las que más fallas'),
      h('a', { class: 'btn btn-quiet btn-sm', href: '/estudiar/flojas', 'data-link': true }, 'Repasarlas'),
    ),
    h('ul', { class: 'weak-list' },
      weak.map((w) => h('li', null,
        h('span', { class: 'weak-q' }, w.card.question),
        h('span', { class: 'weak-pct num bad-text' }, percent(w.accuracy)),
      )),
    ),
  );
}
