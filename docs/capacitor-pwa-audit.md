# Auditoría de Capacitor y capacidades web

Fecha: 2026-07-31  
Proyecto: `banco-web`

## Diagnóstico del stack

- **Framework:** Next.js 16.2.12, App Router, React 19.2.8 y TypeScript 5.9.3.
- **Gestor:** npm (`package-lock.json`). El proyecto declara Node 24.x; la máquina usada para esta auditoría debe ejecutarse con Node 24 (la versión disponible durante la revisión fue Node 25.8.1 y npm mostró `EBADENGINE`).
- **Build:** `next build`, salida SSR en `.next`. No existe `out/index.html`; no se puede sincronizar un cliente Capacitor local sin cambiar la arquitectura o crear una exportación estática compatible.
- **Servidor:** rutas API, cookies, sesiones y lectura de headers en el servidor. Por eso no se activa `output: "export"` ni `server.url`.
- **PWA:** `public/manifest.webmanifest`, `public/sw.js`, `PwaRuntime` y `AppInstallGate`. El Service Worker cachea únicamente recursos públicos y evita `/api`.
- **Viewport:** `MobileViewportSync` y `ios-viewport` ya escuchan `visualViewport`; los estilos globales usan `dvh/svh` y safe areas. Se conserva esta estrategia y se evita añadir listeners duplicados.
- **Necesidades reales observadas:** conectividad online/offline, compartir comprobantes, copiar datos, captura/lectura de QR mediante cámara y `@zxing/browser`, y sincronización de viewport. No se identificó una necesidad actual de geolocalización, sensores, mapas, contactos, calendario, notificaciones nativas o filesystem nativo.

## Decisión de Capacitor

Se mantienen únicamente `@capacitor/core` y `@capacitor/cli` en la misma major (8.4.2). Se retiraron los plugins nativos instalados previamente y se retiró la carpeta Android del repositorio; existe una copia recuperable fuera del proyecto en `C:\Users\user\Desktop\capacitor-android-backup-20260731`.

Las pruebas contractuales se ejecutan con `npm test`. Vitest `3.2.6` es una
dependencia de desarrollo y no se incluye en el bundle web.

`capacitor.config.ts` reserva `webDir: "out"`, pero `scripts/verify-capacitor-webdir.mjs` impide sincronizarlo mientras no exista `out/index.html`. Esto evita enviar una aplicación incompleta al WebView. No se crearon `android/` ni `ios/` y no se usa `server.url`.

## Módulos y adaptadores implementados

- `app/lib/platform.ts`: detección SSR-safe de web, PWA standalone, iOS, Android, Capacitor, táctil, conectividad y capacidades del navegador. `runtimePlatform.hasPlugin()` permite activar un plugin futuro sin duplicar detecciones.
- `app/lib/platform-adapters.ts`: suscripción única a `online/offline`, comprobación puntual del backend sin cache (`checkBackendReachability`), `copyText()` con Clipboard API y fallback controlado, y `shareText()` con Web Share y fallback al portapapeles. Ningún adaptador lee el portapapeles automáticamente ni mantiene listeners después de desmontarse.
- `app/lib/capability-errors.ts`: contrato común `CapabilityErrorCode`, preservación interna de `cause` y mensajes públicos seguros.
- `app/lib/web-lifecycle.ts`: registro singleton de visibilidad, `pageshow/pagehide`, red, orientación y cambio de display-mode, con limpieza al quedar sin suscriptores.
- `app/lib/pwa-bridge.ts` y `app/lib/pwa-bridge.web.ts`: plugin interno `YapePwaBridge` registrado con `registerPlugin`; su implementación web se importa de forma diferida para consultar el Service Worker y solicitar actualizaciones.
- La autenticación fuerte existente usa WebAuthn/passkeys mediante `@simplewebauthn/browser` y sus rutas de servidor. No se duplica con un plugin biométrico: el contrato queda listo para una implementación nativa futura, pero la verificación continúa siendo responsabilidad del backend.
- `tests/platform-contracts.test.ts`: pruebas contractuales SSR de capacidades, errores, cancelación y limpieza de listeners.
- `app/components/PwaRuntime.tsx`: usa el adaptador de red en lugar de registrar sus propios listeners; el Service Worker continúa limitado a web/PWA y no se duplica en una futura plataforma nativa.
- `app/lib/pwa-client.ts`: reutiliza el módulo central para decidir `isNativeApp()` e `isInstalledApp()`.

No se instaló `@ionic/pwa-elements`: ningún plugin de Capacitor que lo requiera
está instalado. El escaneo QR mantiene su cámara web y fallback de archivo con
`@zxing/browser`; el voucher conserva su ruta específica de compartir archivos
porque necesita descargar el PNG cuando Web Share Files no está disponible.

## Matriz de plugins oficiales de Capacitor

La columna **Web** describe el soporte de la API web sin instalar el plugin. La compatibilidad concreta depende de la versión del navegador y de permisos. La recomendación es para el estado actual del proyecto.

| Plugin | Web / APIs útiles | Safari iOS / PWA / Chrome Android | Permisos y HTTPS | Fallback y recomendación |
|---|---|---|---|---|
| Action Sheet | No hay API estándar equivalente; requiere UI propia | UI HTML funciona en todos | No requiere permiso; HTTPS para despliegue PWA | Usar componentes existentes; **posponer** |
| App Launcher | No existe API fiable para detectar apps | Esquemas externos dependen del sistema | Validar URL y gesto de usuario | Enlace seguro con fallback; **posponer** |
| App | `visibilitychange`, `pageshow`, `matchMedia` | Disponibles en navegadores modernos | No requiere permiso | `platform.ts`; **posponer plugin** |
| Background Runner | No existe ejecución fiable en segundo plano web | Safari limita timers/PWA suspendida | No sustituye backend | Backend/Sync; **descartar por ahora** |
| Barcode Scanner | `getUserMedia`/ZXing requieren HTTPS y gesto | Soporte sujeto a permisos y WebView | Cámara + HTTPS | Ya existe `@zxing/browser`; **no instalar** |
| Browser | `window.open` con `noopener` | Funciona con restricciones de popup | Gesto de usuario; validar HTTPS | `openExternalUrl` futuro; **posponer** |
| Calendar | No API web interoperable | Depende de URL/app del sistema | Ninguno | Enlace `.ics` generado en backend; **descartar** |
| Camera | `<input type=file capture>` y `getUserMedia` | Safari permite captura con permisos | Cámara + HTTPS | Fallback input; **no instalar sin flujo de foto** |
| Contacts | No API interoperable | No disponible de forma general | Datos sensibles | Flujo manual; **descartar** |
| Cookies | `document.cookie` no lee HttpOnly | Restricciones SameSite/Secure | HTTPS para cookies seguras | Cookies server-side; **no instalar** |
| Device | `screen`, `navigator.maxTouchPoints`, media queries | Disponibles parcialmente | Ninguno | `platform.ts`; **posponer plugin** |
| Dialog | `<dialog>` y UI React | Soporte actual suficiente | Ninguno | Componentes existentes; **posponer** |
| Filesystem | File System Access limitado; `<input>`/descarga | Capacidades limitadas en iOS | HTTPS para APIs avanzadas | Descarga y Blob; **posponer** |
| File Transfer | `fetch`/Streams con CORS | Soporte razonable con límites de memoria | HTTPS/CORS | Cliente HTTP actual; **posponer** |
| File Viewer | `URL.createObjectURL`, `<iframe>`/descarga | Tipos soportados varían | Validar MIME | Vista/descarga controlada; **descartar** |
| Geolocation | `navigator.geolocation` | Disponible con permiso y HTTPS | Ubicación + HTTPS | Solicitar solo en acción; **no instalar** |
| Google Maps | SDK web externo | Requiere clave restringida | HTTPS + API key restringida | No hay mapas en el flujo actual; **descartar** |
| Haptics | No API interoperable; `vibrate` no funciona en iOS Safari | Muy limitado en PWA | Ninguno | CSS feedback; **posponer** |
| Http | `fetch`/XHR | Funciona, sujeto a CORS/cookies | HTTPS/CORS | `fetch` server/API actual; **no instalar** |
| InAppBrowser | No controla la pestaña de Safari | Web no puede forzar ventana interna | Gesto + URL segura | `window.open` seguro; **posponer** |
| Keyboard | CSS/`visualViewport` | WebKit gestiona teclado; plugin no controla Safari | Ninguno | `MobileViewportSync` existente; **no instalar** |
| Local LLM | WebGPU/Web Workers dependen del dispositivo | No interoperable ni adecuado al bundle actual | Ninguno | Backend; **descartar** |
| Local Notifications | Notification API limitada y permisos | PWA no garantiza ejecución cerrada | Permiso explícito; HTTPS | No hay necesidad actual; **posponer** |
| Motion | `DeviceMotionEvent`/Orientation con permiso en iOS | Permiso y soporte variable | Gesto de usuario/HTTPS | No hay sensores; **descartar** |
| Network | `online/offline` no garantiza backend | Funciona en Safari/PWA/Chrome | Ninguno | `subscribeToNetworkState`; **no instalar** |
| Preferences | `localStorage`/IndexedDB | Disponibles, no son almacén seguro | Ninguno | Preferencias ligeras solamente; **posponer** |
| Privacy Screen | No API web para ocultar snapshot | No controlable desde PWA | Ninguno | UI defensiva; **posponer** |
| Push Notifications | Push API + Service Worker + VAPID | Safari requiere suscripción PWA y permiso | HTTPS + backend VAPID | No hay flujo push configurado; **posponer** |
| Screen Orientation | `screen.orientation` parcial | Bloqueo suele rechazarse en iOS | Gesto/contexto | Continuar sin bloqueo; **descartar** |
| Screen Reader | No se debe detectar lector | Accesibilidad semántica funciona | Ninguno | HTML/ARIA; **descartar** |
| Share | `navigator.share` en dispositivos compatibles | Funciona con gesto; archivos requieren `canShare` | HTTPS normalmente | `shareText`; **no instalar** |
| Splash Screen | No controla splash de Safari/PWA | Solo nativo controla splash | Ninguno | CSS/app-ready; **posponer** |
| Status Bar | Meta/theme-color y safe areas son lo disponible en web | No controla barra real de Safari | Ninguno | `viewport`/safe area; **posponer** |
| System Bars | Sin API web para barras del sistema | No controlable en Safari | Ninguno | Manifest y CSS; **posponer** |
| Text Zoom | `text-size-adjust`/CSS | Usuario puede ampliar texto | Ninguno | Accesibilidad CSS; **posponer** |
| Toast | UI React/ARIA | Funciona en todos | Ninguno | Sistema de avisos existente; **posponer** |

## Seguridad, caché y límites

La PWA mantiene `/api` fuera del cache del Service Worker y las respuestas API tienen `Cache-Control: no-store`. No se agregan secretos ni se usa Capacitor para evadir CORS. La PWA sigue siendo código web manipulable: la autenticación y autorización deben continuar verificándose en el backend. Capacitor Core no aporta atestación ni convierte una PWA en una aplicación nativa.

## Próxima migración nativa

Antes de `npx cap add android` o `npx cap add ios` se necesita una estrategia de cliente estático local: separar las rutas de UI de las rutas SSR/API o proveer un backend remoto explícito. Después se podrá instalar el plugin concreto de cada capacidad, mantener la major 8, sincronizar el bundle generado y configurar CORS/cookies para el origen nativo. Android requiere Android Studio/SDK; iOS requiere macOS/Xcode y `@capacitor/ios`.
