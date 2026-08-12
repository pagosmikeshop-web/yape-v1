# Operación de seguridad

## Señales que requieren revisión

- Alertar por cualquier 5xx sostenido durante cinco minutos.
- Investigar picos de 401, 403, 429 o rechazos de origen por ruta y por IP.
- Revisar cada fallo de cron, webhook de Telegram o evento de pago no exitoso.
- Revisar las reglas WAF en modo `log` durante al menos 14 días antes de aplicar
  una acción de bloqueo o desafío.

## Respuesta inicial

1. Correlacionar el `requestId` en los logs de Vercel con el evento de seguridad.
2. Confirmar si afecta a una ruta, cuenta o red concreta, sin exponer sesiones ni
   datos personales en tickets o chats.
3. Para tráfico abusivo confirmado, crear primero una regla WAF con duración
   limitada y revisar su impacto antes de mantenerla.
4. Si se sospecha una credencial comprometida, rotarla en Vercel/Supabase y
   revocar las sesiones afectadas según el procedimiento de soporte.

## Controles periódicos

- Semanalmente: revisar el panel Firewall y los avisos de seguridad de Supabase.
- Mensualmente: ejecutar `npm run security:scan` y `npm run security:audit` en
  ambas aplicaciones y revisar el SBOM generado por el CI del panel.
- Trimestralmente: practicar una restauración de backup en un entorno aislado y
  verificar el cron de retención.
- Ante cualquier cambio de personal: retirar accesos y exigir 2FA en Vercel,
  Supabase y GitHub para todo miembro con acceso a producción.
