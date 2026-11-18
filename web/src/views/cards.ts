// Tarjetas: buscar, crear, editar, carpetas, compartir, importar y exportar.
import { del, errorMessage, get, post } from '../api';
import { fold, h, plural, replace } from '../dom';
import { buildEpub, download } from '../epub';
import { onLeave } from '../router';
import { store } from '../store';
import type { Card, Folder } from '../types';
import { busy, confirmDialog, dialog, dot, emptyState, field, formError, icon, shell, toast } from '../ui';

const COLORS = ['#3b5bdb', '#0c8599', '#e8590c', '#9c36b5', '#2b8a3e', '#c2255c', '#5f3dc4', '#d9480f'];
const PAGE = 100;

export function cardsView(_p: Record<string, string>, query: URLSearchParams): HTMLElement {
  let text = '';
  let folderFilter = query.get('carpeta') ?? '';
  let shown = PAGE;

  const search = h('input', { type: 'search', class: 'search-input', placeholder: 'Buscar en preguntas y respuestas', 'aria-label': 'Buscar tarjetas', autocomplete: 'off' });
  const filter = h('select', { class: 'select', 'aria-label': 'Filtrar por carpeta' });
  const foldersBox = h('div', { class: 'folders-strip' });
  const list = h('div', { class: 'card-list' });

  search.addEventListener('input', () => {
    text = search.value;
    shown = PAGE;
    paintList();
  });
  filter.addEventListener('change', () => {
    folderFilter = filter.value;
    shown = PAGE;
    paintList();
  });

  function paintFilter() {
    const opts = [h('option', { value: '' }, 'Todas las carpetas'), h('option', { value: '-' }, 'Sin carpeta'), ...store.folderList().map((f) => h('option', { value: f.id }, f.name))];
    filter.replaceChildren(...opts);
    if (folderFilter && folderFilter !== '-' && !store.folders[folderFilter]) folderFilter = '';
    filter.value = folderFilter;
  }

  function paintFolders() {
    const folders = store.folderList();
    foldersBox.replaceChildren(
      ...folders.map((f) =>
        h('button', { class: `chip${folderFilter === f.id ? ' is-on' : ''}`, type: 'button', onClick: () => folderDialog(f), title: 'Gestionar la carpeta' },
          dot(f.color), h('span', null, f.name), h('span', { class: 'chip-n num' }, String(store.cardsIn(f.id).length)))),
      h('button', { class: 'chip chip-add', type: 'button', onClick: () => folderDialog(null) }, icon('plus'), 'Nueva carpeta'),
    );
  }

  function matches(): Card[] {
    const needle = fold(text.trim());
    let cards = Object.values(store.cards);
    if (folderFilter === '-') cards = cards.filter((c) => !c.folder_id);
    else if (folderFilter) cards = cards.filter((c) => c.folder_id === folderFilter);
    if (needle) cards = cards.filter((c) => fold(`${c.question}\n${c.answer}\n${c.wrongs.join('\n')}`).includes(needle));
    return cards.sort((a, b) => (store.folders[a.folder_id ?? '']?.name ?? '~').localeCompare(store.folders[b.folder_id ?? '']?.name ?? '~', 'es') || a.question.localeCompare(b.question, 'es'));
  }

  function paintList() {
    const total = Object.keys(store.cards).length;
    if (!total) {
      list.replaceChildren(emptyState('Todavía no hay tarjetas', 'Escribe la primera o importa las que tenías en un CSV.',
        h('button', { class: 'btn btn-primary', type: 'button', onClick: () => cardDialog(null) }, 'Nueva tarjeta'),
        h('button', { class: 'btn btn-quiet', type: 'button', onClick: importDialog }, 'Importar un CSV')));
      return;
    }
    const found = matches();
    const rows = found.slice(0, shown).map((c) => {
      const f = c.folder_id ? store.folders[c.folder_id] : null;
      return h('button', { class: 'card-row', type: 'button', onClick: () => cardDialog(c) },
        dot(f?.color ?? ''),
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, c.question), h('span', { class: 'row-meta' }, c.answer)),
        h('span', { class: 'row-side' }, f?.name ?? 'Sin carpeta'),
      );
    });
    replace(list,
      h('p', { class: 'list-count muted', role: 'status' }, text.trim() || folderFilter ? `${plural(found.length, 'tarjeta encontrada', 'tarjetas encontradas')}` : plural(total, 'tarjeta', 'tarjetas')),
      found.length ? h('div', { class: 'rows' }, ...rows) : h('p', { class: 'muted no-results' }, 'Ninguna tarjeta coincide. Prueba con otra palabra o quita el filtro de carpeta.'),
      found.length > shown && h('button', { class: 'btn btn-quiet btn-block', type: 'button', onClick: () => ((shown += PAGE), paintList()) }, `Mostrar ${Math.min(PAGE, found.length - shown)} más`),
    );
  }

  const paint = () => {
    paintFilter();
    paintFolders();
    paintList();
  };
  paint();
  onLeave(store.subscribe(paint));

  const moreMenu = h('details', { class: 'menu' },
    h('summary', { class: 'btn btn-quiet', 'aria-label': 'Importar y exportar' }, 'Importar y exportar'),
    h('div', { class: 'menu-list' },
      h('button', { type: 'button', onClick: importDialog }, 'Importar CSV'),
      h('a', { href: '/api/export.csv', download: 'repaso.csv' }, 'Exportar todo en CSV'),
      h('button', { type: 'button', onClick: () => exportEpub(null) }, 'Exportar todo como libro (EPUB)'),
    ),
  );
  // Elegir una opción cierra el menú.
  moreMenu.querySelector('.menu-list')!.addEventListener('click', () => (moreMenu.open = false));
  document.addEventListener('click', closeMenus);
  onLeave(() => document.removeEventListener('click', closeMenus));
  function closeMenus(e: Event) {
    if (!moreMenu.contains(e.target as Node)) moreMenu.open = false;
  }

  if (query.get('nueva')) queueMicrotask(() => cardDialog(null));
  if (query.get('importar')) queueMicrotask(importDialog);

  return shell('/tarjetas',
    h('div', { class: 'page-head' },
      h('h1', { class: 'page-title' }, 'Tarjetas'),
      h('div', { class: 'page-actions' },
        moreMenu,
        h('button', { class: 'btn btn-primary', type: 'button', onClick: () => cardDialog(null, folderFilter && folderFilter !== '-' ? folderFilter : null) }, icon('plus'), 'Nueva tarjeta'),
      ),
    ),
    foldersBox,
    h('div', { class: 'toolbar' }, h('label', { class: 'search' }, icon('search'), search), filter),
    list,
  );
}

// ---- Editar una tarjeta ----

function folderSelect(selected: string | null, extra?: { value: string; label: string }) {
  const sel = h('select', { class: 'select' },
    extra && h('option', { value: extra.value }, extra.label),
    h('option', { value: '' }, 'Sin carpeta'),
    ...store.folderList().map((f) => h('option', { value: f.id }, f.name)),
  );
  sel.value = selected ?? (extra ? extra.value : '');
  return sel;
}

export function cardDialog(card: Card | null, folderId: string | null = null) {
  const err = formError();
  const q = h('textarea', { rows: 3, maxlength: 2000, required: true }, card?.question ?? '');
  const a = h('textarea', { rows: 2, maxlength: 2000, required: true }, card?.answer ?? '');
  const wrongs = [0, 1, 2].map((i) => h('input', { type: 'text', maxlength: 500, value: card?.wrongs[i] ?? '', 'aria-label': `Respuesta falsa ${i + 1}` }));
  const folder = folderSelect(card ? card.folder_id : folderId);
  const save = h('button', { class: 'btn btn-primary', type: 'submit' }, card ? 'Guardar cambios' : 'Guardar tarjeta');
  const another = !card && h('button', { class: 'btn btn-quiet', type: 'button' }, 'Guardar y añadir otra');

  const form = h('form', { class: 'dialog-body form', novalidate: true },
    field('Pregunta', q),
    field('Respuesta', a),
    h('fieldset', { class: 'field' },
      h('legend', null, 'Respuestas falsas para el test'),
      h('div', { class: 'wrongs' }, ...wrongs),
      h('p', { class: 'hint' }, 'Opcional. Si faltan, el test usa respuestas de otras tarjetas.'),
    ),
    field('Carpeta', folder),
    err.el,
    h('div', { class: 'dialog-actions' },
      card && h('button', { class: 'btn btn-danger-quiet push-left', type: 'button', onClick: remove }, icon('trash'), 'Borrar'),
      another,
      save,
    ),
  );

  function collect(): boolean {
    err.clear();
    if (!q.value.trim() || !a.value.trim()) {
      err.show('La tarjeta necesita pregunta y respuesta.');
      (q.value.trim() ? a : q).focus();
      return false;
    }
    store.saveCard({ id: card?.id, question: q.value, answer: a.value, wrongs: wrongs.map((w) => w.value), folder_id: folder.value || null });
    return true;
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (collect()) {
      d.close();
      toast(card ? 'Cambios guardados.' : 'Tarjeta guardada.');
    }
  });
  if (another) {
    another.addEventListener('click', () => {
      if (!collect()) return;
      toast('Tarjeta guardada.');
      q.value = '';
      a.value = '';
      wrongs.forEach((w) => (w.value = ''));
      q.focus();
    });
  }

  async function remove() {
    if (!card) return;
    if (await confirmDialog('Borrar la tarjeta', 'Se borrará también su historial de respuestas.', 'Borrar tarjeta')) {
      store.deleteCard(card.id);
      d.close();
      toast('Tarjeta borrada.');
    }
  }

  const d = dialog(card ? 'Editar tarjeta' : 'Nueva tarjeta', form, { wide: true });
  q.focus();
}

// ---- Carpetas ----

function folderDialog(folder: Folder | null) {
  const err = formError();
  const name = h('input', { type: 'text', maxlength: 80, required: true, value: folder?.name ?? '' });
  let color = folder?.color || store.nextColor();
  const swatches = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Color' });
  const paintSwatches = () =>
    swatches.replaceChildren(...COLORS.map((c) =>
      h('button', { type: 'button', class: `swatch${c === color ? ' is-on' : ''}`, role: 'radio', 'aria-checked': String(c === color), 'aria-label': `Color ${c}`, style: { '--c': c }, onClick: () => ((color = c), paintSwatches()) })));
  paintSwatches();

  const n = folder ? store.cardsIn(folder.id).length : 0;
  const form = h('form', { class: 'dialog-body form', novalidate: true },
    field('Nombre', name),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Color'), swatches),
    err.el,
    folder && h('div', { class: 'folder-tools' },
      h('a', { class: 'btn btn-quiet', href: `/estudiar/${folder.id}`, 'data-link': true, onClick: () => d.close() }, 'Estudiar'),
      h('a', { class: 'btn btn-quiet', href: `/tarjetas?carpeta=${folder.id}`, 'data-link': true, onClick: () => d.close() }, 'Ver sus tarjetas'),
      h('button', { class: 'btn btn-quiet', type: 'button', onClick: () => (d.close(), shareDialog(folder)) }, icon('share'), 'Compartir'),
      h('a', { class: 'btn btn-quiet', href: `/api/export.csv?folder_id=${encodeURIComponent(folder.id)}`, download: `${folder.name}.csv` }, 'CSV'),
      h('button', { class: 'btn btn-quiet', type: 'button', onClick: () => exportEpub(folder) }, 'EPUB'),
    ),
    h('div', { class: 'dialog-actions' },
      folder && h('button', { class: 'btn btn-danger-quiet push-left', type: 'button', onClick: remove }, icon('trash'), 'Borrar carpeta'),
      h('button', { class: 'btn btn-primary', type: 'submit' }, folder ? 'Guardar' : 'Crear carpeta'),
    ),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!name.value.trim()) return err.show('Ponle un nombre a la carpeta.');
    store.saveFolder({ id: folder?.id, name: name.value, color });
    d.close();
    toast(folder ? 'Carpeta guardada.' : 'Carpeta creada.');
  });
  async function remove() {
    if (!folder) return;
    const ok = await confirmDialog('Borrar la carpeta', n ? `Se borrarán también sus ${plural(n, 'tarjeta', 'tarjetas')} y dejará de compartirse. No se puede deshacer.` : 'La carpeta está vacía.', 'Borrar carpeta');
    if (ok) {
      store.deleteFolder(folder.id);
      d.close();
      toast('Carpeta borrada.');
    }
  }
  const d = dialog(folder ? folder.name : 'Nueva carpeta', form);
  if (!folder) name.focus();
}

// ---- Compartir ----

interface Share {
  token: string;
  mode: 'view' | 'copy';
  url: string;
}

async function shareDialog(folder: Folder) {
  const body = h('div', { class: 'dialog-body' }, h('p', { class: 'muted' }, 'Cargando…'));
  const d = dialog(`Compartir «${folder.name}»`, body);
  // Una carpeta recién creada tiene que haber llegado al servidor antes de compartirla.
  if (store.pending.folders[folder.id]) await store.sync();
  let share: Share | null = null;
  try {
    share = (await get<{ share: Share | null }>(`/api/folders/${folder.id}/share`)).share;
  } catch (e) {
    body.replaceChildren(h('p', { class: 'form-error' }, errorMessage(e)));
    return;
  }

  const paint = () => {
    const mode = h('div', { class: 'radio-list' },
      radio('view', 'Solo practicar', 'Quien abra el enlace puede repasar las tarjetas, sin cuenta.'),
      radio('copy', 'Practicar y guardarse una copia', 'Quien tenga cuenta puede guardarse la carpeta.'),
    );
    function radio(value: 'view' | 'copy', title: string, text: string) {
      const input = h('input', { type: 'radio', name: 'modo', value, checked: (share?.mode ?? 'copy') === value });
      input.addEventListener('change', () => share && void save(value));
      return h('label', { class: 'radio' }, input, h('span', null, h('strong', null, title), h('span', { class: 'muted' }, text)));
    }
    if (!share) {
      const create = h('button', { class: 'btn btn-primary', type: 'button' }, 'Crear enlace');
      create.addEventListener('click', () => {
        const value = (mode.querySelector('input:checked') as HTMLInputElement).value as 'view' | 'copy';
        void busy(create, () => save(value));
      });
      body.replaceChildren(
        h('p', null, 'Crea un enlace para que otras personas vean las tarjetas de esta carpeta. Tus estadísticas no se comparten.'),
        mode,
        h('div', { class: 'dialog-actions' }, create),
      );
      return;
    }
    const url = h('input', { type: 'text', readonly: true, value: share.url, class: 'mono', 'aria-label': 'Enlace' });
    url.addEventListener('focus', () => url.select());
    const copy = h('button', { class: 'btn btn-primary', type: 'button' }, 'Copiar enlace');
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(share!.url);
        toast('Enlace copiado.');
      } catch {
        url.select();
      }
    });
    const stop = h('button', { class: 'btn btn-danger-quiet push-left', type: 'button' }, 'Dejar de compartir');
    stop.addEventListener('click', () =>
      busy(stop, async () => {
        try {
          await del(`/api/folders/${folder.id}/share`);
          share = null;
          toast('El enlace ya no funciona.');
          paint();
        } catch (e) {
          toast(errorMessage(e), 'error');
        }
      }));
    body.replaceChildren(h('div', { class: 'copy-row' }, url, copy), mode, h('div', { class: 'dialog-actions' }, stop));
  };

  async function save(mode: 'view' | 'copy') {
    try {
      share = (await post<{ share: Share }>(`/api/folders/${folder.id}/share`, { mode })).share;
      paint();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }
  paint();
  void d;
}

// ---- Importar y exportar ----

function importDialog() {
  const err = formError();
  const file = h('input', { type: 'file', accept: '.csv,text/csv', required: true });
  const target = folderSelect(null, { value: '', label: 'La que indique cada línea' });
  target.querySelectorAll('option')[1]?.remove(); // "Sin carpeta" no tiene sentido como destino aquí
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Importar');
  const form = h('form', { class: 'dialog-body form', novalidate: true },
    h('p', { class: 'muted' }, 'El formato es el de Fichario, la versión anterior de Repaso: una tarjeta por línea con pregunta, respuesta, hasta tres respuestas falsas y el nombre de la carpeta. Las carpetas que no existan se crean.'),
    field('Archivo CSV', file),
    field('Carpeta de destino', target),
    err.el,
    h('div', { class: 'dialog-actions' }, submit),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    err.clear();
    const f = file.files?.[0];
    if (!f) return err.show('Elige un archivo .csv.');
    if (f.size > 4 * 1024 * 1024) return err.show('El archivo es demasiado grande (máximo 4 MB).');
    void busy(submit, async () => {
      try {
        if (target.value && store.pending.folders[target.value]) await store.sync();
        const res = await post<{ imported: number; skipped: number; folders_created: number }>('/api/import', { csv: await f.text(), folder_id: target.value || undefined });
        await store.sync();
        d.close();
        const extra = [res.folders_created ? plural(res.folders_created, 'carpeta nueva', 'carpetas nuevas') : '', res.skipped ? `${plural(res.skipped, 'línea', 'líneas')} sin pregunta o respuesta se han saltado` : ''].filter(Boolean);
        toast(`${plural(res.imported, 'tarjeta importada', 'tarjetas importadas')}.${extra.length ? ' ' + extra.join('; ') + '.' : ''}`);
      } catch (e) {
        err.show(errorMessage(e));
      }
    });
  });
  const d = dialog('Importar tarjetas', form);
}

function exportEpub(folder: Folder | null) {
  const folders = folder ? [folder] : store.folderList();
  const groups: { folder: Folder | null; cards: Card[] }[] = folders.map((f) => ({ folder: f, cards: store.cardsIn(f.id) }));
  if (!folder) groups.push({ folder: null, cards: store.cardsIn(null) });
  const nonEmpty = groups.filter((g) => g.cards.length);
  if (!nonEmpty.length) return toast('No hay tarjetas que exportar.', 'error');
  const title = folder ? folder.name : 'Mis tarjetas de Repaso';
  download(buildEpub(title, nonEmpty), `${title}.epub`);
}
