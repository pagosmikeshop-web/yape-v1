# YAPE

Aplicación web/PWA construida con Next.js 16 (App Router), React 19 y APIs
server-side. La PWA conserva su manifest, Service Worker, autenticación,
rutas y APIs actuales. Capacitor queda preparado como capa de plataforma, sin
crear todavía proyectos Android/iOS.

## Ejecutar como PWA

```bash
npm install
npm run dev
```

Para producción web:

```bash
npm run build
npm run start
```

El build actual es SSR y genera `.next`; no crea `out/index.html`. No se
habilita `output: "export"` porque rompería rutas dinámicas, cookies, sesiones
y APIs. El Service Worker se registra únicamente en navegador/PWA en producción
y no cachea endpoints privados.

## Preparación de Capacitor (sin plataformas nativas)

Se mantienen únicamente estas dependencias, ambas en la major 8.4.2:

- `@capacitor/core`
- `@capacitor/cli`

`capacitor.config.ts` usa `appId: com.norathomas.yape`, `appName: YAPE` y
reserva `webDir: "out"`. El directorio se valida con:

```bash
npm run cap:check:webdir
```

El comando falla de forma intencional mientras no exista `out/index.html`,
porque Next.js SSR no produce un bundle local estático compatible. No se usa
`server.url`, no se agregaron carpetas `android/` o `ios/` y no se sincronizan
plataformas incompletas.

Cuando el cliente esté separado y genere un `out/index.html`, se podrá agregar
una plataforma desde la misma base de código con la major 8 de Capacitor. Para
iOS será necesario macOS/Xcode; para Android, Android Studio y el SDK.

## Capacidades web centralizadas

- `app/lib/platform.ts` centraliza la detección SSR-safe de web, PWA standalone,
  Capacitor, iOS, Android, capacidades y plugins disponibles.
- `app/lib/platform-adapters.ts` ofrece red online/offline, compartir y copiar
  con APIs web y fallbacks sin plugins nativos.
- `app/lib/capability-errors.ts` normaliza errores sin exponer detalles
  técnicos y `app/lib/web-lifecycle.ts` centraliza el ciclo de vida web.
- `app/lib/pwa-bridge.ts` registra un plugin interno diferido para comunicar
  actualizaciones seguras con el Service Worker.
- `app/components/PwaRuntime.tsx` consume el adaptador de red y conserva el
  flujo de actualización controlada del Service Worker.

La matriz completa de plugins evaluados y la estrategia de migración está en
[`docs/capacitor-pwa-audit.md`](docs/capacitor-pwa-audit.md).

## Validación

```bash
npm run typecheck
npm run lint
npm run build
npm run security:audit
npm test
```

No se guardan contraseñas, tokens permanentes, keystores ni claves privadas en
el repositorio. Capacitor no sustituye la autorización del backend ni convierte
una PWA en una aplicación nativa segura por sí solo.
