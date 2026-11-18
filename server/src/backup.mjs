// Copias de seguridad diarias de la base de datos, dentro del propio servidor.
// Cada día se guarda una copia completa y coherente (VACUUM INTO) y se borran las más antiguas.
import { mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const NAME = /^repaso-(\d{4}-\d{2}-\d{2})\.db$/;

export function startBackups({ db, dir, keep = 14, now = () => Date.now(), log = console }) {
  mkdirSync(dir, { recursive: true });

  function run() {
    const day = new Date(now()).toISOString().slice(0, 10);
    const file = join(dir, `repaso-${day}.db`);
    if (!existsSync(file)) {
      try {
        db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
        log.log(`Copia de seguridad creada: ${file}`);
      } catch (error) {
        log.error('No se pudo crear la copia de seguridad:', error);
        return null;
      }
    }
    const copies = readdirSync(dir).filter((f) => NAME.test(f)).sort();
    for (const old of copies.slice(0, Math.max(copies.length - keep, 0))) rmSync(join(dir, old));
    return file;
  }

  run();
  const timer = setInterval(run, 3_600_000);
  timer.unref();
  return { run, stop: () => clearInterval(timer) };
}
