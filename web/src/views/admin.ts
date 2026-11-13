// Administración: invitaciones y usuarios. Solo para la cuenta de administración.
import { del, errorMessage, get, post } from '../api';
import { h, plural, replace } from '../dom';
import { store } from '../store';
import { busy, confirmDialog, dialog, emptyState, field, formError, shell, toast } from '../ui';

interface Invite { code: string; note: string; created_at: number; used_at: number | null; used_by_email: string | null }
interface AdminUser { id: string; email: string; name: string; is_admin: boolean; is_demo: boolean; created_at: number; last_login_at: number | null; cards: number }

// Menú desplegable que se cierra al elegir una opción.
function closingMenu(summary: Node, list: HTMLElement) {
  const menu = h('details', { class: 'menu' }, summary, list);
  list.addEventListener('click', () => (menu.open = false));
  return menu;
}

const date = (t: number | null) => (t ? new Date(t).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' }) : 'nunca');

export function adminView(): HTMLElement {
  if (!store.user?.is_admin) return shell('/ajustes', emptyState('Solo para administración', 'Esta página no está disponible con tu cuenta.'));
  const invitesBox = h('div', null, h('p', { class: 'muted' }, 'Cargando…'));
  const usersBox = h('div', null, h('p', { class: 'muted' }, 'Cargando…'));

  async function loadInvites() {
    try {
      const { invites } = await get<{ invites: Invite[] }>('/api/admin/invites');
      const free = invites.filter((i) => !i.used_at);
      const used = invites.filter((i) => i.used_at);
      replace(invitesBox, 
        free.length
          ? h('ul', { class: 'admin-list' }, free.map((i) => h('li', null,
              h('span', { class: 'row-main' }, h('span', { class: 'mono' }, i.code), h('span', { class: 'row-meta' }, i.note || `Creada el ${date(i.created_at)}`)),
              h('button', { class: 'btn btn-quiet btn-sm', type: 'button', onClick: () => copyLink(i.code) }, 'Copiar enlace'),
              h('button', { class: 'btn btn-danger-quiet btn-sm', type: 'button', onClick: () => revoke(i.code) }, 'Anular'),
            )))
          : h('p', { class: 'muted' }, 'No hay invitaciones sin usar.'),
        used.length > 0 && h('details', { class: 'used' },
          h('summary', null, `${plural(used.length, 'invitación usada', 'invitaciones usadas')}`),
          h('ul', { class: 'admin-list' }, used.map((i) => h('li', null,
            h('span', { class: 'row-main' }, h('span', { class: 'mono muted' }, i.code), h('span', { class: 'row-meta' }, `${i.used_by_email ?? 'cuenta borrada'}, el ${date(i.used_at)}`)))))),
      );
    } catch (e) {
      replace(invitesBox, h('p', { class: 'form-error' }, errorMessage(e)));
    }
  }

  async function loadUsers() {
    try {
      const { users } = await get<{ users: AdminUser[] }>('/api/admin/users');
      replace(usersBox, h('ul', { class: 'admin-list' }, users.map((u) => h('li', null,
        h('span', { class: 'row-main' },
          h('span', { class: 'row-title' }, u.name || u.email, u.is_admin ? h('span', { class: 'tag' }, 'administración') : null, u.is_demo ? h('span', { class: 'tag' }, 'demo') : null),
          h('span', { class: 'row-meta' }, `${u.email}. ${plural(u.cards, 'tarjeta', 'tarjetas')}. Último acceso: ${date(u.last_login_at)}.`)),
        !u.is_admin && closingMenu(
          h('summary', { class: 'btn btn-quiet btn-sm' }, 'Opciones'),
          h('div', { class: 'menu-list' },
            h('button', { type: 'button', onClick: () => resetLink(u) }, 'Crear enlace para cambiar la contraseña'),
            h('button', { type: 'button', onClick: () => toggleDemo(u) }, u.is_demo ? 'Quitar de cuenta demo' : 'Usar como cuenta demo'),
            h('button', { type: 'button', class: 'danger', onClick: () => removeUser(u) }, 'Borrar usuario'),
          ),
        ),
      ))));
    } catch (e) {
      replace(usersBox, h('p', { class: 'form-error' }, errorMessage(e)));
    }
  }

  async function copyLink(code: string) {
    const url = `${location.origin}/registro?codigo=${encodeURIComponent(code)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('Enlace de invitación copiado.');
    } catch {
      toast(url);
    }
  }
  async function revoke(code: string) {
    if (!(await confirmDialog('Anular la invitación', `El código ${code} dejará de servir.`, 'Anular'))) return;
    try {
      await del(`/api/admin/invites/${encodeURIComponent(code)}`);
      void loadInvites();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }
  async function resetLink(u: AdminUser) {
    try {
      const { url } = await post<{ url: string }>(`/api/admin/users/${u.id}/reset-link`);
      const input = h('input', { type: 'text', readonly: true, value: url, class: 'mono', 'aria-label': 'Enlace' });
      dialog('Enlace para cambiar la contraseña', h('div', { class: 'dialog-body' },
        h('p', null, `Pásaselo a ${u.name || u.email} por un canal de confianza. Sirve una vez y caduca en una hora.`), input));
      input.select();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }
  async function toggleDemo(u: AdminUser) {
    try {
      await post(`/api/admin/users/${u.id}/demo`, { is_demo: !u.is_demo });
      void loadUsers();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }
  async function removeUser(u: AdminUser) {
    if (!(await confirmDialog('Borrar el usuario', `Se borra la cuenta de ${u.email} con todas sus tarjetas. No se puede deshacer.`, 'Borrar usuario'))) return;
    try {
      await del(`/api/admin/users/${u.id}`);
      void loadUsers();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  const err = formError();
  const count = h('input', { type: 'number', min: 1, max: 50, value: 1, class: 'num-input' });
  const note = h('input', { type: 'text', maxlength: 120, placeholder: 'Para quién es' });
  const create = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Crear invitación');
  const form = h('form', { class: 'form invite-form' }, field('Cuántas', count), field('Nota', note), create, err.el);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    err.clear();
    void busy(create, async () => {
      try {
        const { codes } = await post<{ codes: string[] }>('/api/admin/invites', { count: Number(count.value), note: note.value });
        note.value = '';
        toast(codes.length === 1 ? `Invitación creada: ${codes[0]}` : `${codes.length} invitaciones creadas.`);
        void loadInvites();
      } catch (e) {
        err.show(errorMessage(e));
      }
    });
  });

  void loadInvites();
  void loadUsers();
  return shell('/ajustes',
    h('h1', { class: 'page-title' }, 'Invitaciones y usuarios'),
    h('section', { class: 'panel' }, h('h2', null, 'Invitar a alguien'), h('p', { class: 'muted' }, 'Cada código sirve para crear una cuenta. Copia el enlace y mándaselo.'), form, invitesBox),
    h('section', { class: 'panel' }, h('h2', null, 'Usuarios'), usersBox),
  );
}
