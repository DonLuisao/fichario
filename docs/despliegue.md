# Despliegue en la Raspberry Pi

Repaso vive en `~/repaso` de la Pi, separado de la web del CV (`~/web`). Comparten el túnel
de Cloudflare: el `cloudflared` de `~/web` se une a una red de Docker llamada `tunel`, y la web de
Repaso entra en esa red con el nombre `repaso-web`.

```
Cloudflare ── túnel ── cloudflared (~/web)
                          │ red "tunel"
                          ▼
                     repaso-web (Caddy) ── /api ──► api (Node, sin dependencias)
                          │                              │
                     ~/repaso/app/site            ~/repaso/datos (base de datos y copias)
```

GitHub Actions compila y prueba en cada push a `main` y copia a la Pi:

- `web/dist/` → `~/repaso/app/site/`
- `server/src` y `server/package.json` → `~/repaso/app/server/`

El servidor se reinicia solo cuando cambia su código (`node --watch-path`).

## 1. Preparar la Pi (una vez)

Desde el Mac, entra en la Pi por SSH y crea las carpetas:

```sh
mkdir -p ~/repaso/app/site ~/repaso/app/server ~/repaso/datos
```

Copia `deploy/docker-compose.yml` y `deploy/Caddyfile` del repo a `~/repaso/` (desde el Mac):

```sh
scp deploy/docker-compose.yml deploy/Caddyfile lu1sa0@raspi:repaso/
```

Crea `~/repaso/.env` en la Pi con `nano ~/repaso/.env` (ver `docs/configuracion.md`) y
protégelo:

```sh
chmod 600 ~/repaso/.env
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

Igual que en el CV, una clave nueva que solo puede escribir en `~/repaso/app`. En el Mac:

```sh
ssh-keygen -t ed25519 -f ~/.ssh/repaso_deploy -N "" -C "github-actions repaso"
```

Añade la pública al final de `~/.ssh/authorized_keys` de la Pi, con la restricción delante
(todo en una sola línea):

```
command="/usr/bin/rrsync -wo /home/lu1sa0/repaso/app",restrict ssh-ed25519 AAAA… github-actions repaso
```

## 3. Secretos del repo en GitHub (una vez)

En *Settings → Secrets and variables → Actions* del repo `repaso`:

| Secreto | Valor |
|---|---|
| `DEPLOY_SSH_KEY` | El contenido de `~/.ssh/repaso_deploy` (la privada) |
| `PI_HOST` | La IP de Tailscale de la Pi (la misma que en el CV) |
| `PI_USER` | `lu1sa0` |
| `PI_KNOWN_HOSTS` | El mismo valor que en el CV |
| `TS_OAUTH_CLIENT_ID` y `TS_OAUTH_SECRET` | Los del cliente OAuth de Tailscale (o uno nuevo con la etiqueta `tag:ci`) |

Y en la pestaña *Variables*: `DEPLOY_ENABLED` = `true`.

## 4. Primer arranque

Haz un push a `main` (o lanza el workflow a mano). Cuando el despliegue haya copiado los archivos,
arranca los contenedores en la Pi:

```sh
cd ~/repaso && docker compose up -d
docker compose logs -f api
```

Deberías ver `Repaso escuchando en el puerto 8080`.

## 5. Ruta en Cloudflare (una vez)

En *Zero Trust → Networks → Tunnels → pi-web → Public hostnames → Add*:

- Subdomain: `repaso`, Domain: `luisse.pro`
- Service: `HTTP`, URL: `repaso-web:80`

Cloudflare crea solo el registro DNS. Abre https://repaso.luisse.pro y regístrate con
`ADMIN_EMAIL`: esa cuenta es la de administración y no necesita invitación.

## 6. Correo con Resend (una vez)

1. En Resend, *Domains → Add domain*: `envio.luisse.pro`. Así el correo de Repaso no toca el
   del dominio principal.
2. Añade en Cloudflare (DNS de `luisse.pro`) los registros que te muestre Resend (MX, TXT de SPF y
   DKIM), con la nube gris (solo DNS).
3. Cuando aparezca como verificado, crea una API key con permiso *Sending access* solo para ese
   dominio y ponla en `RESEND_API_KEY` del `.env`.
4. Reinicia: `cd ~/repaso && docker compose up -d`.

Para probarlo, cierra sesión y usa *He olvidado mi contraseña*.

## Copias de seguridad

Cada día se guarda una copia completa en `~/repaso/datos/copias/repaso-AAAA-MM-DD.db` y se
conservan las 14 últimas. Para restaurar una:

```sh
cd ~/repaso && docker compose stop api
cp datos/copias/repaso-2026-11-20.db datos/repaso.db
rm -f datos/repaso.db-wal datos/repaso.db-shm
docker compose start api
```

## Si algo falla

- `docker compose logs api` y `docker compose logs repaso-web` en `~/repaso`.
- 502 en la web: el contenedor `api` no está arrancado o aún no tiene el código (`ls ~/repaso/app/server`).
- La web no carga: revisa la ruta del túnel y que `cloudflared` está en la red `tunel`
  (`docker network inspect tunel`).
- Tras cambiar el `Caddyfile`: `docker compose exec repaso-web caddy reload --config /etc/caddy/Caddyfile`.
