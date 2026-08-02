# Operación a escala

La aplicación se despliega en Vercel Pro en la región `iad1`, próxima a la
región actual de Supabase. El backend usa el pooler transaccional de Supabase
(puerto 6543) y limita cada instancia serverless a dos conexiones.

## Variables nuevas

Configura en Vercel Production y Preview, sin exponerlas al cliente:

```text
CRON_SECRET=<secreto aleatorio de al menos 32 caracteres>
```

`CRON_SECRET` protege `/api/internal/retention`, que Vercel ejecuta cada noche
para retirar sesiones expiradas, rate limits caducados y eventos operativos
antiguos. No contiene datos financieros ni borra movimientos.

## Rate limiting distribuido (opcional)

El limitador de Supabase sigue siendo el fallback seguro. Para evitar que un
pico repartido entre muchas instancias de Vercel concentre los contadores en
la base de datos, configura un Redis REST administrado (Upstash o Vercel KV):

```text
RATE_LIMIT_REDIS_URL=https://...
RATE_LIMIT_REDIS_TOKEN=...
```

Si utilizas la integración administrada de Vercel KV, también se aceptan
`KV_REST_API_URL` y `KV_REST_API_TOKEN`.

El código usa una operación Lua atómica con TTL y vuelve al contador de
Supabase si Redis no responde. No se debe activar con una URL HTTP ni publicar
el token en el cliente.

## Límites y observabilidad

Antes de abrir el servicio a una audiencia grande, monitoriza en Vercel y
Supabase:

- conexiones activas y conexiones rechazadas;
- p50, p95 y p99 de login, PIN, QR y transferencias;
- respuestas 429, 503 y 504;
- timeouts de consultas y bloqueos;
- duración del proxy administrativo;
- tamaño de `auth_rate_limits`, `qr_scan_events` y auditoría;
- errores de idempotencia y reintentos.

El timeout de consulta PostgreSQL es de 8 segundos y el de bloqueo de 3
segundos. No se deben agregar reintentos automáticos a transferencias ni a
otras operaciones mutables.

## Alertas que deben activarse en Vercel y Supabase

- p95 de API por encima de 800 ms durante 5 minutos;
- p99 por encima de 2 s;
- cualquier aumento sostenido de 429, 503 o 504;
- conexiones rechazadas o pool de Supabase por encima de 80%;
- errores de función o cron de retención;
- crecimiento anormal de `auth_rate_limits`, `qr_scan_events` o auditoría.

Estas alertas se configuran desde los paneles de Vercel/Supabase; no se
guardan credenciales ni se activan automáticamente desde el repositorio.

## Prueba recomendada

Ejecuta en staging una prueba k6 o Artillery con datos sintéticos y sesiones
aisladas. Debe cubrir login, desbloqueo PIN, directorio, QR, transferencias y
listados del panel con carga sostenida y picos. Valida que las operaciones con
la misma clave de idempotencia produzcan un único movimiento.

Hay un smoke test seguro para empezar por la salud de la base de datos:

```bash
k6 run -e LOAD_TEST_BASE_URL=https://staging.example.com scripts/load-health.k6.js
```

No sustituye una prueba autenticada de las rutas financieras y debe ejecutarse
únicamente contra staging con datos sintéticos.

No uses datos reales ni ejecutes una prueba de carga destructiva en producción.
