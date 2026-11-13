// Compila la app: TypeScript y CSS con esbuild, nombres con hash para poder guardarlos
// en caché un año, y el service worker con la lista de archivos para funcionar sin conexión.
import { build, context } from 'esbuild';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'dist';
const watch = process.argv.includes('--watch');
const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 10);

const options = {
  entryPoints: { app: 'src/main.ts', styles: 'src/styles/app.css' },
  bundle: true,
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  target: ['es2020', 'safari15'],
  format: 'esm',
  write: false,
  outdir: OUT,
  legalComments: 'none',
  external: ['/fonts/*', '/icons/*'],
  logLevel: 'warning',
};

function emit(result) {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, 'assets'), { recursive: true });
  cpSync('public', OUT, { recursive: true });

  const files = {};
  for (const file of result.outputFiles) {
    const ext = file.path.endsWith('.css') ? 'css' : 'js';
    const name = `assets/${ext === 'css' ? 'app' : 'app'}-${hash(file.contents)}.${ext}`;
    writeFileSync(join(OUT, name), file.contents);
    files[ext] = `/${name}`;
  }

  const html = readFileSync('src/index.html', 'utf8').replace('__CSS__', files.css).replace('__JS__', files.js);
  writeFileSync(join(OUT, 'index.html'), html);

  // El service worker guarda la app para usarla sin conexión. Su versión cambia con cada build.
  const fonts = readdirSync(join(OUT, 'fonts')).filter((f) => f.endsWith('.woff')).map((f) => `/fonts/${f}`);
  const precache = ['/', files.js, files.css, '/theme.js', '/manifest.webmanifest', '/icons/icon.svg', ...fonts];
  const sw = readFileSync('src/sw.js', 'utf8')
    .replace('__VERSION__', hash(precache.join() + html))
    .replace('__PRECACHE__', JSON.stringify(precache));
  writeFileSync(join(OUT, 'sw.js'), sw);
  console.log(`Fichario compilado en ${OUT}/ (${files.js}, ${files.css})`);
}

if (watch) {
  const ctx = await context({ ...options, plugins: [{ name: 'emit', setup: (b) => b.onEnd((r) => r.errors.length || emit(r)) }] });
  await ctx.watch();
  console.log('Vigilando cambios…');
} else {
  emit(await build(options));
}
