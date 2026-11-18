// Ajustes: nombre, tema, contraseña, mis datos y borrar la cuenta.
import { errorMessage, post, put } from '../api';
import { h } from '../dom';
import { navigate } from '../router';
import { store } from '../store';
import type { User } from '../types';
import { busy, dialog, field, formError, shell, toast } from '../ui';

const THEME_KEY = 'repaso:tema';

export function applyTheme(value: string) {
  if (value === 'claro' || value === 'oscuro') document.documentElement.dataset.theme = value;
  else delete document.documentElement.dataset.theme;
}

export async function logout() {
  try {
    await post('/api/auth/logout');
  } catch {
    /* aunque falle, se sale en este dispositivo */
  }
  store.forgetLocalData();
  store.setUser(null);
  navigate('/', { replace: true });
}

export function settingsView(): HTMLElement {
  const user = store.user!;
  const demo = user.is_demo;

  // Nombre
  const nameErr = formError();
  const name = h('input', { type: 'text', maxlength: 60, value: user.name, autocomplete: 'name' });
  const saveName = h('button', { class: 'btn btn-quiet', type: 'submit' }, 'Guardar nombre');
  const nameForm = h('form', { class: 'form inline-form' }, field('Nombre', name, 'Aparece en las carpetas que compartes.'), saveName, nameErr.el);
  nameForm.addEventListener('submit', (e) => {
    e.preventDefault();
    nameErr.clear();
    void busy(saveName, async () => {
      try {
        const res = await put<{ user: User }>('/api/auth/profile', { name: name.value });
        store.user = res.user;
        toast('Nombre guardado.');
      } catch (e) {
        nameErr.show(errorMessage(e));
      }
    });
  });

  // Tema
  const current = localStorage.getItem(THEME_KEY) ?? 'auto';
  const theme = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Tema' },
    ...[['auto', 'Como el sistema'], ['claro', 'Claro'], ['oscuro', 'Oscuro']].map(([value, label]) => {
      const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(current === value), class: current === value ? 'is-on' : '' }, label);
      b.addEventListener('click', () => {
        if (value === 'auto') localStorage.removeItem(THEME_KEY);
        else localStorage.setItem(THEME_KEY, value);
        applyTheme(value);
        theme.querySelectorAll('button').forEach((x) => {
          const on = x === b;
          x.classList.toggle('is-on', on);
          x.setAttribute('aria-checked', String(on));
        });
      });
      return b;
    }),
  );

  // Contraseña
  const passErr = formError();
  const currentPass = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const newPass = h('input', { type: 'password', autocomplete: 'new-password', minlength: 10, required: true });
  const savePass = h('button', { class: 'btn btn-quiet', type: 'submit' }, 'Cambiar contraseña');
  const passForm = h('form', { class: 'form' },
    field('Contraseña actual', currentPass),
    field('Contraseña nueva', newPass, 'Al menos 10 caracteres. Se cerrará la sesión en tus otros dispositivos.'),
    passErr.el, savePass);
  passForm.addEventListener('submit', (e) => {
    e.preventDefault();
    passErr.clear();
    void busy(savePass, async () => {
      try {
        await post('/api/auth/password', { current: currentPass.value, password: newPass.value });
        currentPass.value = '';
        newPass.value = '';
        toast('Contraseña cambiada.');
      } catch (e) {
        passErr.show(errorMessage(e));
      }
    });
  });

  return shell('/ajustes',
    h('h1', { class: 'page-title' }, 'Ajustes'),
    h('section', { class: 'panel' },
      h('h2', null, 'Tu cuenta'),
      h('p', { class: 'muted' }, 'Has entrado como ', h('strong', null, user.email), '.'),
      !demo && nameForm,
    ),
    h('section', { class: 'panel' }, h('h2', null, 'Apariencia'), theme),
    !demo && h('section', { class: 'panel' }, h('h2', null, 'Contraseña'), passForm),
    h('section', { class: 'panel' },
      h('h2', null, 'Tus datos'),
      h('p', { class: 'muted' }, 'Descarga todo lo que Repaso guarda de ti: carpetas, tarjetas, respuestas y enlaces compartidos, en un archivo JSON.'),
      h('div', { class: 'row-actions' },
        h('a', { class: 'btn btn-quiet', href: '/api/account/export', download: 'repaso-mis-datos.json' }, 'Descargar mis datos'),
        !demo && !user.is_admin && h('button', { class: 'btn btn-danger-quiet', type: 'button', onClick: deleteAccount }, 'Borrar mi cuenta'),
      ),
    ),
    h('div', { class: 'row-actions settings-foot' },
      user.is_admin && h('a', { class: 'btn btn-quiet', href: '/admin', 'data-link': true }, 'Invitaciones y usuarios'),
      h('button', { class: 'btn btn-quiet', type: 'button', onClick: logout }, 'Cerrar sesión'),
    ),
  );
}

function deleteAccount() {
  const err = formError();
  const pass = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const submit = h('button', { class: 'btn btn-danger', type: 'submit' }, 'Borrar mi cuenta para siempre');
  const form = h('form', { class: 'dialog-body form' },
    h('p', null, 'Se borran tu cuenta, tus carpetas, tus tarjetas, tu historial y los enlaces que hayas compartido. No se puede deshacer.'),
    h('p', { class: 'muted' }, 'Si quieres conservar algo, descarga antes tus datos o exporta las tarjetas en CSV.'),
    field('Escribe tu contraseña para confirmar', pass),
    err.el,
    h('div', { class: 'dialog-actions' }, submit),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    err.clear();
    void busy(submit, async () => {
      try {
        await post('/api/account/delete', { password: pass.value });
        store.forgetLocalData();
        store.setUser(null);
        d.close();
        toast('Cuenta borrada.');
        navigate('/', { replace: true });
      } catch (e) {
        err.show(errorMessage(e));
      }
    });
  });
  const d = dialog('Borrar la cuenta', form);
  pass.focus();
}
