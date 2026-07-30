# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Los usuarios principales son clientes que usan la aplicación como una PWA móvil instalada en iPhone o Android.

El sistema también contempla operación interna por roles: Owner, Administradores y Vendedores. Esos roles gestionan clientes, accesos, créditos, tokens, permisos y estados desde el panel administrativo o las rutas protegidas que correspondan.

Los clientes son registros internos del sistema y no deben tener acceso al panel administrativo.

## Product Purpose

La aplicación reconstruye una experiencia móvil tipo billetera digital con flujos de inicio por clave, QR, yapeo, voucher/comprobante, perfil, datos de cuenta, contactos QR, saldo configurable y validación de acceso.

El objetivo del producto es permitir que nuevos clientes usen la app con acceso controlado: prueba inicial de 3 días, validación por Telegram y posibilidad de acceso permanente mediante tokens o activaciones administradas.

El éxito del producto significa que la app se vea y se comporte como una aplicación móvil real, funcione instalada como PWA, valide accesos de forma confiable y permita administrar usuarios/clientes sin depender de procesos manuales confusos.

## Positioning

El producto combina tres piezas operativas en una sola base web:

- PWA móvil para clientes.
- Validación de identidad/acceso apoyada en Telegram.
- Gestión interna por roles con Owner, Administradores y Vendedores.

El mecanismo distintivo es el control de acceso por días, tokens permanentes, códigos de promoción y validación de pertenencia al grupo de Telegram.

## Operating Context

La aplicación se despliega como web/PWA en Vercel y utiliza Turso como base de datos según la configuración del proyecto.

Telegram se utiliza como integración de validación: grupo requerido, bot/webhook, ID de Telegram, comandos de activación como `/redeem` y rutas de soporte.

El proyecto debe mantenerse en:

`C:\Users\user\Desktop\Proyecto 1\banco-web`

No se debe usar como fuente principal ninguna carpeta anterior de reconstrucción.

## Capabilities and Constraints

Capacidades confirmadas por código y contexto del proyecto:

- Inicio de sesión con Telegram ID, usuario y contraseña.
- Creación de cuenta con validación de Telegram.
- Validación de grupo de Telegram.
- Prueba de 3 días para usuarios nuevos.
- Tokens de acceso permanente.
- Códigos de invitación o promoción para sumar días.
- Roles internos: Owner, Administrador y Vendedor.
- CRM interno de clientes.
- Gestión de clientes nuevos y VIP.
- Flujo de yapear, escanear QR y voucher.
- Contactos QR guardables.
- Saldo configurable y deducción por yapeos.
- PWA con manifest, iconos y runtime de instalación.
- Backend en rutas API de Next.js.
- Base de datos con Drizzle/Turso.

Restricciones:

- Mantener una sola base web/PWA.
- No crear carpetas nativas Android/iOS para este proyecto.
- No cambiar rutas, lógica de negocio ni conexiones sin motivo directo.
- No exponer secretos en Git ni en el bundle público.
- No subir `.env`, builds generados ni dependencias instaladas.
- Preservar las pantallas principales ya construidas mientras se limpian rutas o contenidos pausados.

Decisiones abiertas:

- Qué módulos pausados se reactivarán y con qué contenido final.
- Qué textos finales se mantendrán para soporte, recuperación y validaciones.
- Qué dominios definitivos se usarán para app pública y panel.

## Brand Commitments

El nombre visible y la identidad actual están basados en Yape según el manifest, assets y componentes existentes.

La experiencia debe conservar el estilo visual móvil que el usuario ha estado ajustando: morado principal, acentos turquesa, pantallas tipo app instalada, QR con logo, voucher de yapeo y navegación inferior en pantallas principales.

Las mejoras visuales deben ser refinamientos cuidadosos salvo instrucción explícita de rediseño.

## Evidence on Hand

Evidencia local revisada:

- `package.json`: Next.js, React, Turso, Drizzle, QR, WebAuthn y PWA.
- `public/manifest.webmanifest`: nombre e iconos de la PWA.
- `app/components/BankApp.tsx`: aplicación principal y flujos móviles.
- `app/components/bank/MovementVoucher.tsx`: voucher/comprobante.
- `app/components/bank/HomeView.tsx`: pantalla inicial.
- `app/components/AppInstallGate.tsx`: control de instalación PWA.
- `app/components/MobileViewportSync.tsx`: sincronización de viewport móvil.
- `app/api/telegram/*`: integración Telegram.
- `app/api/auth/*`: autenticación, login, bootstrap y recuperación.
- `app/api/crm/*`: clientes/CRM.
- `app/api/admin/*`: administración interna.
- `docs/production-runbook.md`: notas de producción, Turso, Telegram y seguridad.
- `docs/frontend-hardening.md`: criterios de hardening frontend.

No hay evidencia suficiente para fabricar testimonios, métricas comerciales, garantías externas o claims públicos no confirmados.

## Product Principles

1. Mobile-first real: cada pantalla debe sentirse como app instalada, no como web reducida.
2. Control de acceso claro: días, tokens, Telegram y permisos deben ser entendibles y verificables.
3. Roles separados: Owner manda todo; Administradores y Vendedores operan solo dentro de permisos.
4. Seguridad práctica: secretos fuera del cliente, validación en backend y mínimos datos sensibles en logs.
5. Evolución ordenada: módulos pausados se pueden conservar visibles, pero no deben navegar a contenido incompleto.

## Accessibility & Inclusion

La PWA debe mantener inputs legibles en iPhone y Android, áreas táctiles cómodas, foco visible, contraste suficiente y comportamiento estable con teclado virtual, safe areas, notch y modo standalone.
