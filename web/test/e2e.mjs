// Prueba de extremo a extremo: servidor real con base de datos en memoria, la app compilada
// servida con la misma CSP que en producción, y Chromium haciendo de usuario.
//
//   npm run build && npm run test:e2e
//   SCREENSHOTS=capturas npm run test:e2e   (guarda capturas de cada pantalla)
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { createApp } from '../../server/src/app.mjs';
import { loadConfig } from '../../server/src/config.mjs';
import { openDb } from '../../server/src/db.mjs';

const DIST = resolve('dist');
const SHOTS = process.env.SCREENSHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

// La CSP se lee del Caddyfile de producción, para probar exactamente la misma.
const caddy = readFileSync(resolve('../deploy/Caddyfile'), 'utf8');
const CSP = /Content-Security-Policy "([^"]+)"/.exec(caddy)[1];

// ---- Servidor de la API ----
const PORT = 4300 + Math.floor(Math.random() * 500);
const ORIGIN = `http://localhost:${PORT}`;
const config = loadConfig({ APP_ORIGIN: ORIGIN, ADMIN_EMAIL: 'luis@repaso.test', COOKIE_SECURE: 'false' });
const db = openDb(':memory:');
const emails = [];
const api = createApp({ config, db, sendEmail: async (m) => emails.push(m) });
await new Promise((r) => api.listen(0, '127.0.0.1', r));
const apiPort = api.address().port;

// ---- Servidor de la web (hace de Caddy) ----
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };
const web = createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    const p = request({ host: '127.0.0.1', port: apiPort, path: req.url, method: req.method, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    req.pipe(p);
    return;
  }
  const path = decodeURIComponent(new URL(req.url, ORIGIN).pathname);
  let file = join(DIST, path);
  if (!file.startsWith(DIST) || !existsSync(file) || path.endsWith('/')) file = join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'content-security-policy': CSP });
  res.end(readFileSync(file));
});
await new Promise((r) => web.listen(PORT, '127.0.0.1', r));

// ---- Navegador ----
const browser = await chromium.launch();
const problems = [];
async function newPage(viewport = { width: 1280, height: 860 }, scheme = 'light') {
  const context = await browser.newContext({ viewport, colorScheme: scheme, locale: 'es-ES', timezoneId: 'Europe/Madrid', acceptDownloads: true });
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // Sin sesión, /api/auth/me responde 401: es lo esperado al abrir la app sin haber entrado.
    if (m.location().url.endsWith('/api/auth/me') && m.text().includes('401')) return;
    problems.push(`consola: ${m.text()} (${m.location().url})`);
  });
  page.on('pageerror', (e) => problems.push(`error: ${e.message}`));
  return page;
}
async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}
// Espera a que algo se cumpla en el servidor (la app sincroniza en segundo plano).
async function until(check, what, ms = 8000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`No se ha cumplido a tiempo: ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

let step = '';
const t = (name) => {
  step = name;
  console.log(`· ${name}`);
};

try {
  const page = await newPage();

  t('presentación');
  await page.goto(ORIGIN);
  await page.getByRole('heading', { name: /Hasta que se quede/ }).waitFor();
  await page.getByRole('button', { name: /Dar la vuelta/ }).click();
  await shot(page, '01-presentacion');

  t('registro de la cuenta de administración (sin invitación)');
  await page.getByRole('link', { name: 'Tengo una invitación' }).click();
  await page.getByLabel('Nombre').fill('Luis');
  await page.getByLabel('Correo').fill('luis@repaso.test');
  await page.getByLabel('Contraseña').fill('una-contraseña-larga');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await page.getByRole('heading', { name: 'Hola, Luis' }).waitFor();
  await shot(page, '02-inicio-vacio');

  t('crear carpeta y tarjetas');
  await page.getByRole('link', { name: 'Tarjetas' }).first().click();
  await page.getByRole('button', { name: 'Nueva carpeta' }).click();
  await page.getByLabel('Nombre').fill('Redes');
  await page.getByRole('button', { name: 'Crear carpeta' }).click();
  await page.locator('.chip', { hasText: 'Redes' }).waitFor();

  const cards = [
    ['¿Qué capa del modelo OSI se encarga del enrutamiento?', 'La capa de red', ['La capa de enlace', 'La capa de transporte', 'La capa física']],
    ['¿Qué puerto usa HTTPS por defecto?', '443', ['80', '22', '8080']],
    ['¿Qué protocolo traduce nombres de dominio en direcciones IP?', 'DNS', ['DHCP', 'ARP', 'NTP']],
    ['¿Qué máscara corresponde a un /24?', '255.255.255.0', ['255.255.0.0', '255.255.255.128', '255.0.0.0']],
  ];
  await page.getByRole('button', { name: 'Nueva tarjeta' }).first().click();
  for (const [q, a, w] of cards) {
    await page.getByLabel('Pregunta').fill(q);
    await page.getByLabel('Respuesta', { exact: true }).fill(a);
    for (let i = 0; i < 3; i++) await page.getByLabel(`Respuesta falsa ${i + 1}`).fill(w[i]);
    await page.getByLabel('Carpeta', { exact: true }).selectOption({ label: 'Redes' });
    await page.getByRole('button', { name: 'Guardar y añadir otra' }).click();
  }
  await page.keyboard.press('Escape');
  await page.getByText('4 tarjetas', { exact: true }).waitFor();

  t('búsqueda sin tildes ni mayúsculas');
  await page.getByLabel('Buscar tarjetas').fill('mascara');
  await page.getByText('1 tarjeta encontrada').waitFor();
  await shot(page, '03-tarjetas-busqueda');
  await page.getByLabel('Buscar tarjetas').fill('');

  t('sincronización con el servidor');
  await until(() => db.prepare('SELECT COUNT(*) AS n FROM cards WHERE deleted = 0').get().n === 4, 'las 4 tarjetas en el servidor');
  await page.locator('.sync-ok').waitFor({ state: 'attached' });

  t('estudiar en modo tarjetas');
  await page.getByRole('link', { name: 'Estudiar' }).first().click();
  await page.getByRole('link', { name: /Redes/ }).click();
  await page.getByRole('button', { name: 'Tarjetas', exact: true }).click();
  await page.getByText('Tarjeta 1 de 4.').waitFor();
  await page.keyboard.press(' ');
  await page.getByRole('button', { name: 'La sabía', exact: true }).waitFor();
  await shot(page, '04-estudiar-tarjeta');
  await page.getByRole('button', { name: 'La sabía', exact: true }).click();
  await page.locator('.study-card').click();
  await page.getByRole('button', { name: 'No la sabía' }).click();

  t('cambiar a test');
  await page.getByRole('button', { name: 'Test', exact: true }).click();
  await page.locator('.option').first().waitFor();
  await page.keyboard.press('1');
  await page.locator('.quiz-foot').waitFor();
  await shot(page, '05-estudiar-test');
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.locator('.option.is-right, .option').first().waitFor();
  // Elegir la buena: se busca por el texto de la respuesta correcta
  const q = await page.locator('.question').textContent();
  const answer = cards.find((c) => c[0] === q)[1];
  await page.locator('.option', { hasText: answer }).first().click();
  await page.getByText('Correcto.').waitFor();
  await page.getByRole('button', { name: 'Ver resultado' }).click();
  await page.locator('.summary-score').waitFor();
  await shot(page, '06-resumen');

  t('las respuestas llegan al servidor y salen en Progreso');
  await until(() => db.prepare('SELECT COUNT(*) AS n FROM reviews').get().n === 4, 'las 4 respuestas en el servidor');
  await page.getByRole('button', { name: 'Terminar' }).click();
  await page.getByRole('link', { name: 'Progreso' }).first().click();
  await page.getByText('días de racha').or(page.getByText('día de racha')).waitFor();
  await shot(page, '07-progreso');

  t('compartir la carpeta');
  await page.getByRole('link', { name: 'Tarjetas' }).first().click();
  await page.locator('.chip', { hasText: 'Redes' }).click();
  await page.getByRole('button', { name: 'Compartir' }).click();
  await page.getByRole('button', { name: 'Crear enlace' }).click();
  const shareUrl = await page.getByLabel('Enlace', { exact: true }).inputValue();
  assert.match(shareUrl, new RegExp(`^${ORIGIN}/c/`));
  await shot(page, '08-compartir');
  await page.keyboard.press('Escape');

  t('crear una invitación');
  await page.getByRole('link', { name: 'Ajustes' }).first().click();
  await page.getByRole('link', { name: 'Invitaciones y usuarios' }).click();
  await page.getByLabel('Nota').fill('Para Ana');
  await page.getByRole('button', { name: 'Crear invitación' }).click();
  const code = (await page.locator('.admin-list .mono').first().textContent()).trim();
  assert.match(code, /^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/);
  await shot(page, '09-admin');

  t('abrir la carpeta compartida sin cuenta (móvil, modo oscuro)');
  const guest = await newPage({ width: 390, height: 844 }, 'dark');
  await guest.goto(shareUrl);
  await guest.getByRole('heading', { name: 'Redes' }).waitFor();
  await guest.getByText('Luis te ha compartido una carpeta').waitFor();
  await shot(guest, '10-compartida-movil');
  await guest.getByRole('button', { name: 'Practicar' }).click();
  await guest.locator('.study-card').waitFor();
  await shot(guest, '11-estudiar-movil');

  t('registrarse con la invitación y guardarse la copia');
  await guest.goto(`${ORIGIN}/registro?codigo=${code}`);
  await guest.getByLabel('Correo').fill('ana@repaso.test');
  await guest.getByLabel('Contraseña').fill('otra-contraseña-larga');
  await guest.getByRole('button', { name: 'Crear cuenta' }).click();
  await guest.getByRole('heading', { name: 'Hola' }).waitFor();
  await guest.goto(shareUrl);
  await guest.getByRole('button', { name: 'Guardar en mi cuenta' }).click();
  await guest.getByRole('heading', { name: '¿Qué estudiamos hoy?' }).waitFor();
  await guest.getByText('4 tarjetas, de Luis').waitFor();
  await shot(guest, '12-inicio-movil');

  t('importar un CSV de la versión anterior');
  await guest.getByRole('link', { name: 'Tarjetas' }).first().click();
  await guest.locator('summary', { hasText: 'Importar y exportar' }).click();
  await guest.getByRole('button', { name: 'Importar CSV' }).click();
  await guest.getByLabel('Archivo CSV').setInputFiles({
    name: 'antiguas.csv', mimeType: 'text/csv',
    buffer: Buffer.from('"¿Capital de Portugal?","Lisboa","Oporto","Coímbra","Faro","Geografía"\n"¿Río más largo de España?","Tajo","Ebro","Duero","","Geografía"\n'),
  });
  await guest.getByRole('button', { name: 'Importar', exact: true }).click();
  await guest.getByText('2 tarjetas importadas').waitFor();
  await guest.locator('.chip', { hasText: 'Geografía' }).waitFor();
  await shot(guest, '13-tarjetas-movil');

  t('ajustes en modo oscuro y borrar la cuenta');
  await guest.getByRole('link', { name: 'Ajustes' }).first().click();
  await shot(guest, '14-ajustes-movil');
  await guest.getByRole('button', { name: 'Borrar mi cuenta' }).click();
  await guest.getByLabel('Escribe tu contraseña para confirmar').fill('otra-contraseña-larga');
  await guest.getByRole('button', { name: 'Borrar mi cuenta para siempre' }).click();
  await guest.getByRole('heading', { name: /Hasta que se quede/ }).waitFor();
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE email = 'ana@repaso.test'").get().n, 0);

  t('restablecer la contraseña por correo');
  await page.getByRole('link', { name: 'Ajustes' }).first().click();
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await page.getByRole('link', { name: 'Entrar' }).click();
  await page.getByRole('link', { name: 'He olvidado mi contraseña' }).click();
  await page.getByLabel('Correo').fill('luis@repaso.test');
  await page.getByRole('button', { name: 'Enviar enlace' }).click();
  await page.getByText('te llegará el enlace').waitFor();
  await page.waitForTimeout(200);
  const link = /(http\S+restablecer#token=[\w-]+)/.exec(emails.at(-1).text)[1];
  await page.goto(link);
  await page.getByLabel('Contraseña nueva').fill('contraseña-nueva-larga');
  await page.getByRole('button', { name: 'Guardar contraseña' }).click();
  await page.getByRole('heading', { name: 'Entrar' }).waitFor();
  await page.getByLabel('Correo').fill('luis@repaso.test');
  await page.getByLabel('Contraseña').fill('contraseña-nueva-larga');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByRole('heading', { name: '¿Qué estudiamos hoy?' }).waitFor();

  t('sin errores en la consola ni bloqueos de la CSP');
  assert.deepEqual(problems, []);
  console.log('\nTodo bien.');
} catch (error) {
  console.error(`\nFalla en «${step}»:`, error.message);
  if (problems.length) console.error(problems.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
  web.close();
  api.close();
}
