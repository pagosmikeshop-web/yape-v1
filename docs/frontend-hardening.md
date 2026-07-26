# Hardening del frontend

## Modelo de seguridad

El navegador siempre recibe el HTML, CSS, JavaScript e imágenes necesarios para
mostrar la aplicación. Por ello, el objetivo de este hardening es reducir la
exposición accidental, impedir la publicación de fuentes originales y elevar el
costo del scraping automático, sin bloquear accesibilidad ni congelar equipos de
usuarios legítimos.

## Controles implementados

- Next.js no genera source maps públicos y elimina el encabezado de tecnología.
- La CSP se genera por solicitud con un nonce criptográficamente aleatorio.
- Los handlers inline, objetos, frames, bases externas y orígenes distintos quedan
  bloqueados.
- Las páginas HTML privadas se entregan con `Cache-Control: private, no-store`.
- Todo el sitio se marca `noindex`, `nofollow`, `noarchive`, `nosnippet` y
  `noimageindex`.
- Los recursos publicables se revisan después de cada build. El build falla si
  encuentra `.map`, `sourceMappingURL`, rutas locales o referencias `file://`.
- Los secretos y artefactos sensibles se revisan en CI antes de compilar.
- Las rutas privadas requieren sesión y las APIs aplican autorización en servidor.

## Controles deliberadamente descartados

- Los bucles `debugger`, cierres forzados y borrado del DOM producen una denegación
  de servicio contra clientes reales y son triviales de eliminar.
- Bloquear F12, clic derecho, selección o arrastre no impide descargar los
  recursos y rompe teclado, lectores de pantalla, copiar/pegar y soporte técnico.
- Un overlay global impediría usar la aplicación.
- Shadow DOM cerrado encapsula componentes, pero DevTools y el código ejecutado
  siguen pudiendo observarlos; no constituye una frontera de seguridad.
- La ofuscación posterior de bundles de React/Next suele romper carga diferida,
  WebAuthn y reportes de errores. La minificación y división con nombres hash se
  mantienen como opción estable y verificable.

## Protección contra scraping masivo

Los encabezados y `robots` detienen indexadores compatibles, no bots hostiles.
Para tráfico masivo debe configurarse en el proveedor:

1. WAF con rate limiting por IP, ASN y reputación.
2. Challenge administrado para patrones automatizados.
3. Límites más estrictos en autenticación y consultas.
4. Alertas por aumentos de 403, 429 y volumen de HTML.
5. Bloqueo temporal, nunca permanente, para evitar afectar redes compartidas.

La CSP de una página no puede impedir que una extensión instalada por el propio
usuario use permisos privilegiados del navegador.
