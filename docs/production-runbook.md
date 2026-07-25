# Operación en producción

## Despliegue

1. Ejecutar `npm ci --ignore-scripts`.
2. Ejecutar `npm run security:scan`, `npm run security:audit`, `npm run typecheck`, `npm run lint` y `npm test`.
3. Aplicar las migraciones pendientes en orden en un entorno de prueba.
4. Verificar `GET /api/health`.
5. Desplegar primero una vista previa y ejecutar los flujos de login, PIN, registro Telegram, transferencia interna y panel.
6. Promover a producción solo si no existen errores de consola ni respuestas 5xx.

## Base de datos y copias de seguridad

- Crear una copia o rama de la base Turso antes de cada migración.
- Conservar al menos una copia diaria y una copia mensual según la política del negocio.
- Probar la restauración en un proyecto aislado al menos una vez al mes.
- No ejecutar migraciones desde una función de Vercel durante una solicitud de usuario.
- No eliminar `account_movements`; el borrado visible usa `account_history_state`.

## Rollback

1. Detener nuevas promociones a producción.
2. Reasignar el dominio al último deployment verificado en Vercel.
3. Si cambió el esquema, restaurar la copia previa o aplicar la migración inversa validada.
4. Rotar cualquier secreto que haya podido quedar expuesto.
5. Documentar el incidente y agregar una prueba de regresión.

## Monitoreo

- Configurar una comprobación externa de `/api/health` cada minuto.
- Alertar por picos de respuestas 401, 403, 409, 429 y 5xx.
- Enviar los eventos `[security-event]` de Vercel a un destino con retención y acceso restringido.
- Alertar por fallos del webhook de Telegram y por crecimiento anormal del rate limit.
- No registrar tokens, cookies, contraseñas, teléfonos, correos ni payloads QR.

## Rotación de secretos

- Rotar `ADMIN_PROXY_SECRET`, `AUTH_RATE_LIMIT_PEPPER`, claves de QR y tokens de validación de forma programada.
- Rotar inmediatamente `TELEGRAM_BOT_TOKEN` y `TELEGRAM_WEBHOOK_SECRET` ante cualquier exposición.
- Guardar secretos únicamente en Vercel/Turso; nunca en Git.
