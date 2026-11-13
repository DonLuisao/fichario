# Fichario

Tarjetas de estudio con modo test, estadísticas de progreso y carpetas compartidas.
Funciona en el navegador y sin conexión, y se instala en el móvil como app.

https://fichario.luisse.pro

## Estructura

| Carpeta | Qué hay |
|---|---|
| `server/` | API en Node sin dependencias: `node:sqlite`, sesiones con cookie, correo con Resend, copias diarias |
| `web/` | App en TypeScript sin framework, compilada con esbuild. Service worker para usarla sin conexión |
| `deploy/` | `Caddyfile` (con la CSP y las cabeceras de seguridad) y `docker-compose.yml` de la Raspberry Pi |
| `docs/` | [Configuración](docs/configuracion.md) y [despliegue](docs/despliegue.md) |

## Desarrollo

Hace falta Node 22.13 o superior.

```sh
cd server && npm test            # pruebas de la API
cd web && npm install
npm run build                    # compila en web/dist
npm run test:e2e                 # Chromium usando la app compilada contra un servidor real
SCREENSHOTS=capturas npm run test:e2e   # lo mismo, guardando capturas de cada pantalla
```

Para trabajar con la app abierta en el navegador, en tres terminales:

```sh
cd server && APP_ORIGIN=http://localhost:5173 ADMIN_EMAIL=tu@correo DB_PATH=./dev.db npm run dev
cd web && npm run dev            # recompila al guardar
cd web && npm run serve          # http://localhost:5173, con la misma CSP que en producción
```

## Datos

Las tarjetas se guardan en el dispositivo y se sincronizan con el servidor; si dos dispositivos
cambian lo mismo, gana el último cambio. El CSV de importación y exportación es el mismo que el de la
versión anterior: una tarjeta por línea con pregunta, respuesta, tres respuestas falsas y carpeta.

Cada usuario puede descargar todos sus datos y borrar su cuenta desde Ajustes.

## Licencia

Código: MIT. Tipografías (Bricolage Grotesque, Crimson Pro, Geist Mono): SIL Open Font License,
ver `web/public/fonts/`.
