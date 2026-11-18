// Arranque del servidor de Repaso.
import { createApp } from './app.mjs';
import { loadConfig } from './config.mjs';
import { openDb } from './db.mjs';
import { createMailer } from './email.mjs';
import { startBackups } from './backup.mjs';

const config = loadConfig();
const db = openDb(config.dbPath);
const server = createApp({ config, db, sendEmail: createMailer(config) });
const backups = config.backupDir ? startBackups({ db: db.raw, dir: config.backupDir, keep: config.backupKeep }) : null;

server.listen(config.port, () => {
  console.log(`Repaso escuchando en el puerto ${config.port}`);
  console.log(`Origen de la app: ${config.appOrigin}`);
  if (!config.adminEmail) console.warn('ADMIN_EMAIL no está definido: nadie podrá registrarse sin invitación.');
  if (!config.resendApiKey) console.warn('RESEND_API_KEY no está definido: los correos se escribirán en el log.');
});

function shutdown() {
  backups?.stop();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
