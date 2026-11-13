// Sesión de estudio: tarjetas que se giran o test de opciones.
import { h, plural, shuffle } from '../dom';
import { navigate, onLeave } from '../router';
import { store } from '../store';
import type { Card } from '../types';
import { emptyState, icon, shell } from '../ui';

type Mode = 'flip' | 'quiz';
const MODE_KEY = 'fichario:modo';

export function studyRoute({ id }: Record<string, string>): HTMLElement {
  let title: string;
  let cards: Card[];
  if (id === 'todas') {
    title = 'Todas las carpetas';
    cards = store.cardsIn('todas');
  } else if (id === 'sin-carpeta') {
    title = 'Sin carpeta';
    cards = store.cardsIn(null);
  } else if (id === 'flojas') {
    title = 'Las que más fallas';
    cards = (store.stats?.weak ?? []).map((w) => store.cards[w.card_id]).filter(Boolean);
  } else {
    const folder = store.folders[id];
    if (!folder) return shell('/', emptyState('No se encuentra la carpeta', 'Puede que se haya borrado desde otro dispositivo.', h('a', { class: 'btn btn-primary', href: '/', 'data-link': true }, 'Volver al inicio')));
    title = folder.name;
    cards = store.cardsIn(id);
  }
  if (!cards.length) return shell('/', emptyState('No hay tarjetas aquí', 'Añade alguna desde la sección Tarjetas.', h('a', { class: 'btn btn-primary', href: '/tarjetas', 'data-link': true }, 'Ir a Tarjetas')));
  return shell('/', studySession({ title, cards, record: true, exit: () => navigate('/') }));
}

interface SessionOptions {
  title: string;
  cards: Card[];
  record: boolean; // guardar las respuestas para las estadísticas
  exit: () => void;
  extra?: Node; // acciones adicionales en el resumen final (carpetas compartidas)
}

export function studySession(opts: SessionOptions): HTMLElement {
  let mode: Mode = localStorage.getItem(MODE_KEY) === 'quiz' ? 'quiz' : 'flip';
  let deck: Card[] = [];
  let results: (boolean | null)[] = [];
  let index = 0;
  let revealed = false;
  let picked: number | null = null;
  let options: { text: string; right: boolean }[] = [];

  const root = h('section', { class: 'study' });

  function start(cards: Card[]) {
    deck = shuffle(cards);
    results = deck.map(() => null);
    index = 0;
    prepare();
    paint();
  }

  function prepare() {
    revealed = false;
    picked = null;
    const card = deck[index];
    if (!card) return;
    let wrongs = card.wrongs.filter(Boolean);
    // Sin respuestas falsas propias, el test toma prestadas respuestas de otras tarjetas.
    if (wrongs.length < 3) {
      const others = shuffle(opts.cards.filter((c) => c.id !== card.id && c.answer !== card.answer).map((c) => c.answer));
      wrongs = [...wrongs, ...others.filter((o) => !wrongs.includes(o))].slice(0, 3);
    }
    options = shuffle([{ text: card.answer, right: true }, ...wrongs.map((text) => ({ text, right: false }))]);
  }

  function answer(correct: boolean) {
    const card = deck[index];
    results[index] = correct;
    if (opts.record) store.addReview(card.id, correct, mode);
  }

  function next() {
    index++;
    prepare();
    paint();
    root.querySelector<HTMLElement>('.study-focus')?.focus();
  }

  function setMode(m: Mode) {
    mode = m;
    localStorage.setItem(MODE_KEY, m);
    prepare();
    paint();
  }

  function progress() {
    const bar = h('div', { class: deck.length > 40 ? 'progress progress-smooth' : 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': deck.length, 'aria-valuenow': index });
    if (deck.length > 40) {
      bar.append(h('span', { class: 'progress-fill', style: { '--p': `${(index / deck.length) * 100}%` } }));
    } else {
      results.forEach((r, i) => bar.append(h('span', { class: `seg ${r === true ? 'seg-ok' : r === false ? 'seg-bad' : i === index ? 'seg-now' : ''}` })));
    }
    return bar;
  }

  function header() {
    return h('header', { class: 'study-head' },
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Salir de la sesión', onClick: opts.exit }, icon('back')),
      h('h1', { class: 'study-title' }, opts.title),
      h('div', { class: 'segmented', role: 'group', 'aria-label': 'Forma de repasar' },
        modeButton('flip', 'Tarjetas'),
        modeButton('quiz', 'Test'),
      ),
    );
  }

  function modeButton(m: Mode, label: string) {
    return h('button', { type: 'button', class: mode === m ? 'is-on' : '', 'aria-pressed': String(mode === m), onClick: () => setMode(m) }, label);
  }

  function paint() {
    if (index >= deck.length) return paintSummary();
    const card = deck[index];
    const last = store.stats?.cards[card.id]?.last;
    const failedLast = opts.record && last ? last.endsWith('0') : false;

    const meta = h('p', { class: 'study-meta' },
      `Tarjeta ${index + 1} de ${deck.length}.`,
      failedLast ? h('span', { class: 'bad-text' }, ' La fallaste la última vez.') : null,
    );

    const question = h('p', { class: 'question' }, card.question);
    let body: Node;

    if (mode === 'flip') {
      const answerEl = h('p', { class: 'answer', hidden: !revealed }, card.answer);
      const face = h('button', { class: `study-card study-focus${revealed ? ' is-revealed' : ''}`, type: 'button', 'aria-expanded': String(revealed) },
        question, h('span', { class: 'rule', hidden: !revealed }), answerEl,
        !revealed && h('span', { class: 'tap-hint' }, 'Pulsa para ver la respuesta'),
      );
      face.addEventListener('click', () => {
        if (!revealed) {
          revealed = true;
          paint();
          root.querySelector<HTMLElement>('.judge .btn-ok')?.focus();
        }
      });
      const judge = h('div', { class: 'judge', hidden: !revealed },
        h('button', { class: 'btn btn-bad-soft', type: 'button', onClick: () => (answer(false), next()) }, 'No la sabía'),
        h('button', { class: 'btn btn-ok', type: 'button', onClick: () => (answer(true), next()) }, 'La sabía'),
      );
      body = h('div', null, face, judge);
    } else {
      const list = h('ol', { class: 'options' },
        options.map((o, i) => {
          let cls = 'option';
          if (picked !== null) {
            if (o.right) cls += ' is-right';
            else if (i === picked) cls += ' is-wrong';
            else cls += ' is-dim';
          }
          return h('li', null, h('button', {
            class: cls, type: 'button', disabled: picked !== null,
            onClick: () => {
              picked = i;
              answer(o.right);
              paint();
              root.querySelector<HTMLElement>('.next-btn')?.focus();
            },
          }, h('span', { class: 'key num' }, String(i + 1)), h('span', null, o.text)));
        }),
      );
      const feedback = picked === null ? null : h('div', { class: 'quiz-foot' },
        h('p', { class: options[picked].right ? 'ok-text' : 'bad-text' }, options[picked].right ? 'Correcto.' : 'No era esa. La buena está marcada en verde.'),
        h('button', { class: 'btn btn-primary next-btn', type: 'button', onClick: next }, index + 1 < deck.length ? 'Siguiente' : 'Ver resultado'),
      );
      body = h('div', { class: 'study-card study-quiz study-focus', tabindex: -1 }, question, list, feedback);
    }

    root.replaceChildren(header(), progress(), meta, body);
  }

  function paintSummary() {
    const right = results.filter((r) => r === true).length;
    const failed = deck.filter((_, i) => results[i] === false);
    const pct = deck.length ? Math.round((right / deck.length) * 100) : 0;
    root.replaceChildren(
      header(),
      progress(),
      h('div', { class: 'summary' },
        h('p', { class: 'summary-score num' }, `${right}/${deck.length}`),
        h('h2', null, pct === 100 ? 'Todas bien. Así da gusto.' : pct >= 70 ? 'Buena sesión.' : 'Hay que darle otra vuelta.'),
        h('p', { class: 'muted' }, failed.length ? `Has fallado ${plural(failed.length, 'tarjeta', 'tarjetas')}.` : 'No has fallado ninguna.'),
        h('div', { class: 'summary-actions' },
          failed.length > 0 && h('button', { class: 'btn btn-primary', type: 'button', onClick: () => start(failed) }, 'Repasar las falladas'),
          h('button', { class: failed.length ? 'btn btn-quiet' : 'btn btn-primary', type: 'button', onClick: () => start(opts.cards) }, 'Otra vuelta'),
          h('button', { class: 'btn btn-quiet', type: 'button', onClick: opts.exit }, 'Terminar'),
        ),
        opts.extra ?? null,
      ),
    );
    // Sube las respuestas ya, para que las estadísticas incluyan esta sesión.
    if (opts.record) void store.sync().then(() => store.loadStats());
  }

  // Teclado: espacio gira la tarjeta, 1 y 2 juzgan, 1–4 eligen opción, Intro pasa a la siguiente.
  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || document.querySelector('dialog[open]')) return;
    if (index >= deck.length || e.metaKey || e.ctrlKey || e.altKey) return;
    if (mode === 'flip') {
      if (!revealed && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        root.querySelector<HTMLButtonElement>('.study-card')?.click();
      } else if (revealed && (e.key === '1' || e.key === '2')) {
        e.preventDefault();
        root.querySelector<HTMLButtonElement>(e.key === '1' ? '.btn-bad-soft' : '.btn-ok')?.click();
      }
    } else if (picked === null && /^[1-4]$/.test(e.key)) {
      root.querySelectorAll<HTMLButtonElement>('.option')[Number(e.key) - 1]?.click();
    }
  };
  document.addEventListener('keydown', onKey);
  onLeave(() => document.removeEventListener('keydown', onKey));

  start(opts.cards);
  return root;
}
