// Carpeta compartida por enlace: se puede practicar sin cuenta y, si se permite, guardar una copia.
import { errorMessage, get, post } from '../api';
import { h, plural } from '../dom';
import { navigate } from '../router';
import { store } from '../store';
import type { Card } from '../types';
import { busy, dot, emptyState, toast } from '../ui';
import { studySession } from './study';

interface Shared {
  folder: { name: string; color: string };
  owner: string;
  mode: 'view' | 'copy';
  cards: Omit<Card, 'folder_id'>[];
}

export async function sharedView({ token }: Record<string, string>): Promise<HTMLElement> {
  const frame = (...content: Node[]) =>
    h('div', { class: 'shared' },
      h('header', { class: 'landing-top' },
        h('a', { class: 'brand', href: '/', 'data-link': true }, h('img', { src: '/icons/icon.svg', alt: '', width: 26, height: 26 }), 'Fichario'),
        store.user ? h('a', { class: 'btn btn-quiet', href: '/', 'data-link': true }, 'Ir a mi Fichario') : h('a', { class: 'btn btn-quiet', href: '/entrar', 'data-link': true }, 'Entrar'),
      ),
      h('main', { class: 'page' }, ...content));

  let data: Shared;
  try {
    data = await get<Shared>(`/api/shared/${encodeURIComponent(token)}`);
  } catch (e) {
    return frame(emptyState('No se puede abrir este enlace', errorMessage(e), h('a', { class: 'btn btn-primary', href: '/', 'data-link': true }, 'Ir a Fichario')));
  }

  const cards: Card[] = data.cards.map((c) => ({ ...c, folder_id: null }));
  const canCopy = data.mode === 'copy';

  const saveButton = () => {
    if (!canCopy) return null;
    if (!store.user) return h('p', { class: 'muted' }, 'Para guardarte una copia, ', h('a', { href: '/entrar', 'data-link': true }, 'entra en tu cuenta'), ' y vuelve a abrir el enlace.');
    const b = h('button', { class: 'btn btn-primary', type: 'button' }, 'Guardar en mi Fichario');
    b.addEventListener('click', () =>
      busy(b, async () => {
        try {
          await post(`/api/shared/${encodeURIComponent(token)}/copy`);
          await store.sync();
          toast(`Carpeta «${data.folder.name}» guardada en tu Fichario.`);
          navigate('/');
        } catch (e) {
          toast(errorMessage(e), 'error');
        }
      }));
    return b;
  };

  const intro = h('section', { class: 'shared-intro' },
    h('p', { class: 'muted' }, data.owner ? `${data.owner} te ha compartido una carpeta` : 'Te han compartido una carpeta'),
    h('h1', { class: 'page-title' }, dot(data.folder.color), data.folder.name),
    h('p', { class: 'muted' }, plural(cards.length, 'tarjeta', 'tarjetas')),
    h('div', { class: 'row-actions' },
      cards.length > 0 && h('button', { class: 'btn btn-primary', type: 'button', onClick: practice }, 'Practicar'),
      saveButton(),
    ),
    h('ul', { class: 'preview-list' }, cards.slice(0, 5).map((c) => h('li', null, c.question))),
    cards.length > 5 && h('p', { class: 'muted' }, `y ${plural(cards.length - 5, 'más', 'más')}.`),
  );
  const holder = frame(intro);

  function practice() {
    const main = holder.querySelector('main')!;
    main.replaceChildren(studySession({
      title: data.folder.name,
      cards,
      record: false,
      exit: () => main.replaceChildren(intro),
      extra: h('div', { class: 'summary-actions' }, saveButton()),
    }));
  }

  return holder;
}
