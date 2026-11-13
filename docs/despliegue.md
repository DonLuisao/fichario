# Despliegue en la Raspberry Pi

Fichario vive en `~/fichario` de la Pi, separado de la web del CV (`~/web`). Comparten el túnel
de Cloudflare: el `cloudflared` de `~/web` se une a una red de Docker llamada `tunel`, y la web de
Fichario entra en esa red con el nombre `fichario-web`.

```
Cloudflare ── túnel ── cloudflared (~/web)
                          │ red "tunel"
                          ▼
                     fichario-web (Caddy) ── /api ──► api (Node, sin dependencias)
                          │                              │
                     ~/fichario/app/site            ~/fichario/datos (base de datos y copias)
```

GitHub Actions compila y prueba en cada push a `main` y copia a la Pi:

- `web/dist/` → `~/fichario/app/site/`
- `server/src` y `server/package.json` → `~/fichario/app/server/`

El servidor se reinicia solo cuando cambia su código (`node --watch-path`).

## 1. Preparar la Pi (una vez)

Desde el Mac, entra en la Pi por SSH y crea las carpetas:

```sh
mkdir -p ~/fichario/app/site ~/fichario/app/server ~/fichario/datos
```

Copia `deploy/docker-compose.yml` y `deploy/Caddyfile` del repo a `~/fichario/` (desde el Mac):

```sh
scp deploy/docker-compose.yml deploy/Caddyfile pi-web:fichario/
```

Crea `~/fichario/.env` en la Pi con `nano ~/fichario/.env` (ver `docs/configuracion.md`) y
protégelo:

```sh
chmod 600 ~/fichario/.env
```

### Red compartida con el túnel

```sh
docker network create tunel
```

En `~/web/docker-compose.yml`, añade la red al servicio `cloudflared` y decláralo al final:

```yaml
  cloudflared:
    # …lo que ya tiene…
    networks: [default, tunel]

networks:
  tunel:
    external: true
```

Y aplica el cambio:

```sh
cd ~/web && docker compose up -d
```

## 2. Clave de despliegue (una vez)

Igual que en el CV, una clave nueva que solo puede escribir en `~/fichario/app`. En el Mac:

```sh
ssh-keygen -t ed25519 -f ~/.ssh/fichario_deploy -N "" -C "github-actions fichario"
```

Añade la pública al final de `~/.ssh/authorized_keys` de la Pi, con la restricción delante
(todo en una sola línea):

```
command="/usr/bin/rrsync -wo /home/lu1sa0/fichario/app",restrict ssh-ed25519 AAAA… github-actions fichario
```

## 3. Secretos del repo en GitHub (una vez)

En *Settings → Secrets and variables → Actions* del repo `fichario`:

| Secreto | Valor |
|---|---|
| `DEPLOY_SSH_KEY` | El contenido de `~/.ssh/fichario_deploy` (la privada) |
| `PI_HOST` | La IP de Tailscale de la Pi (la misma que en el CV) |
| `PI_USER` | `lu1sa0` |
| `PI_KNOWN_HOSTS` | El mismo valor que en el CV |
| `TS_OAUTH_CLIENT_ID` y `TS_OAUTH_SECRET` | Los del cliente OAuth de Tailscale (o uno nuevo con la etiqueta `tag:ci`) |

Y en la pestaña *Variables*: `DEPLOY_ENABLED` = `true`.

## 4. Primer arranque

Haz un push a `main` (o lanza el workflow a mano). Cuando el despliegue haya copiado los archivos,
arranca los contenedores en la Pi:

```sh
cd ~/fichario && docker compose up -d
docker compose logs -f api
```

Deberías ver `Fichario escuchando en el puerto 8080`.

## 5. Ruta en Cloudflare (una vez)

En *Zero Trust → Networks → Tunnels → pi-web → Public hostnames → Add*:

- Subdomain: `fichario`, Domain: `luisse.pro`
- Service: `HTTP`, URL: `fichario-web:80`

Cloudflare crea solo el registro DNS. Abre https://fichario.luisse.pro y regístrate con
`ADMIN_EMAIL`: esa cuenta es la de administración y no necesita invitación.

## 6. Correo con Resend (una vez)

1. En Resend, *Domains → Add domain*: `envio.luisse.pro`. Así el correo de Fichario no toca el
   del dominio principal.
2. Añade en Cloudflare (DNS de `luisse.pro`) los registros que te muestre Resend (MX, TXT de SPF y
   DKIM), con la nube gris (solo DNS).
3. Cuando aparezca como verificado, crea una API key con permiso *Sending access* solo para ese
   dominio y ponla en `RESEND_API_KEY` del `.env`.
4. Reinicia: `cd ~/fichario && docker compose up -d`.

Para probarlo, cierra sesión y usa *He olvidado mi contraseña*.

## Copias de seguridad

Cada día se guarda una copia completa en `~/fichario/datos/copias/fichario-AAAA-MM-DD.db` y se
conservan las 14 últimas. Para restaurar una:

```sh
cd ~/fichario && docker compose stop api
cp datos/copias/fichario-2026-11-20.db datos/fichario.db
rm -f datos/fichario.db-wal datos/fichario.db-shm
docker compose start api
```

## Si algo falla

- `docker compose logs api` y `docker compose logs web` en `~/fichario`.
- 502 en la web: el contenedor `api` no está arrancado o aún no tiene el código (`ls ~/fichario/app/server`).
- La web no carga: revisa la ruta del túnel y que `cloudflared` está en la red `tunel`
  (`docker network inspect tunel`).
- Tras cambiar el `Caddyfile`: `docker compose exec web caddy reload --config /etc/caddy/Caddyfile`.
