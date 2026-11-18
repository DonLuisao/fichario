# Configuración del servidor

Todo se configura con variables de entorno. En la Raspberry Pi van en `~/repaso/.env`,
que nunca se sube al repositorio.

`deploy/docker-compose.yml` ya fija `PORT`, `DB_PATH`, `BACKUP_DIR` y `CLIENT_IP_HEADER`, así que en
el `.env` de la Pi solo hacen falta estas:

```sh
APP_ORIGIN=https://repaso.luisse.pro
ADMIN_EMAIL=tu-correo@ejemplo.com
RESEND_API_KEY=re_...
# Opcional, cuando crees la cuenta demo:
# DEMO_EMAIL=demo@luisse.pro
# DEMO_PASSWORD=...
```

| Variable | Obligatoria | Para qué sirve |
|---|---|---|
| `APP_ORIGIN` | Sí | Dirección pública de la app, sin barra final: `https://repaso.luisse.pro`. Se usa en los enlaces de los correos y para rechazar peticiones de otras webs. |
| `ADMIN_EMAIL` | Sí | El primer usuario que se registre con este correo será el administrador, sin invitación. |
| `RESEND_API_KEY` | No | Clave de Resend para enviar los correos de recuperación. Sin ella, el correo se escribe en el log. |
| `EMAIL_FROM` | No | Remitente. Por defecto `Repaso <repaso@envio.luisse.pro>`; el dominio tiene que estar verificado en Resend. |
| `DEMO_EMAIL` y `DEMO_PASSWORD` | No | Cuenta de demostración de solo lectura. Hay que crearla y marcarla como demo desde el panel de admin. |
| `CLIENT_IP_HEADER` | No | Cabecera con la IP real del visitante. Detrás de Cloudflare: `cf-connecting-ip`. Se usa en los límites de intentos. |
| `BACKUP_DIR` | No | Carpeta de las copias diarias de la base de datos. En Docker, `/data/copias`. Vacía, no se hacen copias. |
| `BACKUP_KEEP` | No | Cuántas copias diarias se guardan. Por defecto 14. |
| `DB_PATH` | No | Dónde está la base de datos. Por defecto `/data/repaso.db` en Docker. |
| `PORT` | No | Puerto interno. Por defecto `3000`. |
| `COOKIE_SECURE` | No | Se deduce de `APP_ORIGIN`: con `https://` la cookie solo viaja cifrada. |

## Seguridad, en resumen

- Contraseñas con scrypt; nunca se guardan en claro.
- Sesiones en una cookie `HttpOnly` y `SameSite=Lax`, que el JavaScript de la página no puede leer.
  En la base de datos solo está el hash del token, y cada sesión se puede cerrar desde el servidor.
- Los enlaces de recuperación caducan en una hora, sirven una sola vez, y al usarlos se cierran
  todas las sesiones abiertas de la cuenta.
- Las peticiones que cambian datos tienen que venir de `APP_ORIGIN` y ser JSON.
- Límites de intentos en el inicio de sesión, el registro, la recuperación y las carpetas compartidas.
- Las carpetas compartidas nunca muestran el correo ni las estadísticas de su dueño.
