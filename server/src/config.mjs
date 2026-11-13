// Configuración a partir de variables de entorno. Ver docs/configuracion.md.
export function loadConfig(env = process.env) {
  const origin = (env.APP_ORIGIN ?? 'http://localhost:5173').replace(/\/$/, '');
  return {
    port: Number(env.PORT ?? 3000),
    dbPath: env.DB_PATH ?? './data/fichario.db',
    appOrigin: origin,
    // En producción la cookie solo viaja por HTTPS. En local (http://localhost) no puede.
    secureCookies: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : origin.startsWith('https://'),
    // Cabecera con la IP real del visitante. Detrás de Cloudflare: cf-connecting-ip.
    clientIpHeader: (env.CLIENT_IP_HEADER ?? '').toLowerCase() || null,
    adminEmail: normalizeEmail(env.ADMIN_EMAIL ?? ''),
    demoEmail: normalizeEmail(env.DEMO_EMAIL ?? ''),
    demoPassword: env.DEMO_PASSWORD ?? '',
    resendApiKey: env.RESEND_API_KEY ?? '',
    emailFrom: env.EMAIL_FROM ?? 'Fichario <fichario@envio.luisse.pro>',
    // Copias diarias de la base de datos. Vacío para desactivarlas.
    backupDir: env.BACKUP_DIR ?? '',
    backupKeep: Number(env.BACKUP_KEEP ?? 14),
  };
}

export function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}
