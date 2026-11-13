// Presentación, entrar, registro con invitación y recuperar la contraseña.
import { errorMessage, post } from '../api';
import { h } from '../dom';
import { navigate } from '../router';
import { store } from '../store';
import type { User } from '../types';
import { busy, field, formError, toast } from '../ui';

async function signedIn(user: User) {
  store.setUser(user);
  await store.sync();
  navigate('/', { replace: true });
}

function authFrame(title: string, intro: string | null, form: Node, foot: Node | null): HTMLElement {
  return h('div', { class: 'auth' },
    h('a', { class: 'brand auth-brand', href: '/', 'data-link': true }, h('img', { src: '/icons/icon.svg', alt: '', width: 28, height: 28 }), 'Fichario'),
    h('section', { class: 'auth-card' }, h('h1', null, title), intro && h('p', { class: 'muted' }, intro), form),
    foot && h('p', { class: 'auth-foot' }, foot),
  );
}

const input = (type: string, name: string, extra: Record<string, unknown> = {}) =>
  h('input', { type, name, required: true, ...extra });

// ---- Presentación ----

const SAMPLE = [
  { q: '¿Qué capa del modelo OSI se encarga del enrutamiento?', a: 'La capa de red (capa 3)' },
  { q: '¿Qué hace un índice en una base de datos?', a: 'Acelera las búsquedas a cambio de espacio y escrituras más lentas' },
  { q: '¿En qué año se aprobó la Constitución española?', a: 'En 1978' },
];

export function landing(): HTMLElement {
  let i = 0;
  let flipped = false;
  const q = h('p', { class: 'flash-q' });
  const a = h('p', { class: 'flash-a' });
  const card = h('button', { class: 'flash', type: 'button', 'aria-label': 'Dar la vuelta a la tarjeta de ejemplo' }, h('span', { class: 'flash-face' }, q, a));
  const paint = () => {
    q.textContent = SAMPLE[i].q;
    a.textContent = SAMPLE[i].a;
    card.classList.toggle('is-flipped', flipped);
  };
  card.addEventListener('click', () => {
    if (flipped) i = (i + 1) % SAMPLE.length;
    flipped = !flipped;
    paint();
  });
  paint();

  const demo = h('button', { class: 'btn btn-primary btn-lg', type: 'button' }, 'Probar la demo');
  demo.addEventListener('click', () =>
    busy(demo, async () => {
      try {
        const { user } = await post<{ user: User }>('/api/auth/demo');
        await signedIn(user);
      } catch (e) {
        toast(errorMessage(e), 'error');
      }
    }),
  );

  return h('div', { class: 'landing' },
    h('header', { class: 'landing-top' },
      h('span', { class: 'brand' }, h('img', { src: '/icons/icon.svg', alt: '', width: 28, height: 28 }), 'Fichario'),
      h('a', { class: 'btn btn-quiet', href: '/entrar', 'data-link': true }, 'Entrar'),
    ),
    h('section', { class: 'hero' },
      h('div', { class: 'hero-text' },
        h('h1', null, 'Pregunta, respuesta y otra vez. Hasta que se quede.'),
        h('p', { class: 'lead' },
          'Fichario es un cuaderno de tarjetas para estudiar oposiciones, certificaciones o lo que toque. Repasa dándoles la vuelta o en modo test, y mira qué temas se te resisten.'),
        h('div', { class: 'hero-actions' },
          demo,
          h('a', { class: 'btn btn-quiet btn-lg', href: '/registro', 'data-link': true }, 'Tengo una invitación'),
        ),
      ),
      h('div', { class: 'hero-card' }, card, h('p', { class: 'hint' }, 'Pulsa la tarjeta para ver la respuesta.')),
    ),
    h('section', { class: 'features' },
      feature('Dos formas de repasar', 'Dale la vuelta a la tarjeta y di si la sabías, o responde un test con tres opciones falsas que escribes tú.'),
      feature('Sabes dónde fallas', 'Racha de días, aciertos por carpeta y las tarjetas que más fallas, juntas para repasarlas de una vez.'),
      feature('Carpetas para compartir', 'Manda un enlace a una carpeta. Quien lo abra puede practicar sin cuenta o guardarse una copia.'),
      feature('Funciona sin conexión', 'Instálala en el móvil y estudia en el metro. Los cambios se suben solos al volver la cobertura.'),
    ),
    h('footer', { class: 'landing-foot' },
      'Fichario es un proyecto personal de ',
      h('a', { href: 'https://luisse.pro' }, 'Luis Sánchez Elvira'),
      '. Sin anuncios ni cookies de seguimiento.',
    ),
  );
}

function feature(title: string, text: string) {
  return h('article', { class: 'feature' }, h('h2', null, title), h('p', null, text));
}

// ---- Entrar ----

export function login(): HTMLElement {
  const err = formError();
  const email = input('email', 'email', { autocomplete: 'email', inputmode: 'email' });
  const pass = input('password', 'password', { autocomplete: 'current-password' });
  const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Entrar');
  const form = h('form', { class: 'form', novalidate: true },
    field('Correo', email),
    field('Contraseña', pass),
    err.el,
    submit,
    h('a', { class: 'small-link', href: '/olvide', 'data-link': true }, 'He olvidado mi contraseña'),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    err.clear();
    void busy(submit, async () => {
      try {
        const { user } = await post<{ user: User }>('/api/auth/login', { email: email.value, password: pass.value });
        await signedIn(user);
      } catch (e) {
        err.show(errorMessage(e));
      }
    });
  });
  queueMicrotask(() => email.focus());
  return authFrame('Entrar', null, form, h('span', null, '¿Te han invitado? ', h('a', { href: '/registro', 'data-link': true }, 'Crea tu cuenta')));
}

// ---- Registro ----

export function register(_p: Record<string, string>, query: URLSearchParams): HTMLElement {
  const err = formError();
  const invite = input('text', 'invite', { autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'XXXX-XXXX-XXXX-XXXX', value: query.get('codigo') ?? '' });
  invite.required = false;
  const name = input('text', 'name', { autocomplete: 'name', maxlength: 60 });
  name.required = false;
  const email = input('email', 'email', { autocomplete: 'email', inputmode: 'email' });
  const pass = input('password', 'password', { autocomplete: 'new-password', minlength: 10 });
  const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Crear cuenta');
  const form = h('form', { class: 'form', novalidate: true },
    field('Código de invitación', invite),
    field('Nombre', name, 'Opcional. Se muestra en las carpetas que compartas.'),
    field('Correo', email),
    field('Contraseña', pass, 'Al menos 10 caracteres.'),
    err.el,
    submit,
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    err.clear();
    void busy(submit, async () => {
      try {
        const { user } = await post<{ user: User }>('/api/auth/register', {
          invite: invite.value, name: name.value, email: email.value, password: pass.value,
        });
        await signedIn(user);
        toast('Cuenta creada. Ya puedes crear tu primera carpeta.');
      } catch (e) {
        err.show(errorMessage(e));
      }
    });
  });
  return authFrame('Crear tu cuenta', 'Fichario funciona por invitación. Escribe el código que te han pasado.', form,
    h('span', null, '¿Ya tienes cuenta? ', h('a', { href: '/entrar', 'data-link': true }, 'Entra')));
}

// ---- He olvidado la contraseña ----

export function forgot(): HTMLElement {
  const err = formError();
  const email = input('email', 'email', { autocomplete: 'email', inputmode: 'email' });
  const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Enviar enlace');
  const form = h('form', { class: 'form', novalidate: true }, field('Correo', email), err.el, submit);
  const frame = authFrame('Recuperar la contraseña', 'Te mandaremos un enlace para elegir una nueva. Caduca en una hora.', form,
    h('a', { href: '/entrar', 'data-link': true }, 'Volver a entrar'));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    err.clear();
    void busy(submit, async () => {
      try {
        await post('/api/auth/forgot', { email: email.value });
        form.replaceWith(h('p', { class: 'notice' },
          'Si hay una cuenta con ese correo, te llegará el enlace en unos minutos. Mira también en la carpeta de spam.'));
      } catch (e) {
        err.show(errorMessage(e));
      }
    });
  });
  return frame;
}

// ---- Elegir una contraseña nueva (enlace del correo) ----

export function reset(): HTMLElement {
  // El token viaja en el fragmento (#) para que no quede en registros del servidor ni en el Referer.
  const token = new URLSearchParams(location.hash.slice(1)).get('token') ?? '';
  history.replaceState(null, '', '/restablecer');
  const err = formError();
  const pass = input('password', 'password', { autocomplete: 'new-password', minlength: 10 });
  const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Guardar contraseña');
  const form = h('form', { class: 'form', novalidate: true }, field('Contraseña nueva', pass, 'Al menos 10 caracteres.'), err.el, submit);
  if (!token) err.show('Falta el código del enlace. Ábrelo de nuevo desde el correo o pide otro.');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    err.clear();
    void busy(submit, async () => {
      try {
        await post('/api/auth/reset', { token, password: pass.value });
        toast('Contraseña cambiada. Entra con la nueva.');
        navigate('/entrar', { replace: true });
      } catch (e) {
        err.show(errorMessage(e));
      }
    });
  });
  return authFrame('Elige una contraseña nueva', null, form, h('a', { href: '/olvide', 'data-link': true }, 'Pedir otro enlace'));
}
