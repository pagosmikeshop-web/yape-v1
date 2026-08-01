# Migración de Turso a Supabase

La aplicación mantiene el adaptador D1 existente y añade un adaptador Postgres
para Supabase. Turso continúa siendo el proveedor por defecto hasta que el
esquema y los datos se verifiquen.

## Requisitos

- Una base de datos Supabase del proyecto `zhgszyxjcvdyveoaefxh`.
- La cadena de conexión Postgres del pooler de Supabase, guardada únicamente
  como `SUPABASE_DATABASE_URL` en el backend/Vercel. No es la URL pública ni la
  anon key.
- `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN` disponibles durante la copia.
- Si la fuente es un archivo SQLite exportado, Node 24+ puede leerlo en modo
  solo lectura con `--source-sqlite`; no se modifica el archivo original.

## Fuente local revisada

Se verificó el archivo `C:\\Users\\user\\Downloads\\yape-production.db` en
modo solo lectura. Su SHA-256 es
`A8441C5FE1ACA32309F650BEF003277237564B8D9A7F4E49FE9DA926B1707A40`.
La comprobación SQLite devolvió `integrity_check = ok`, sin violaciones de
claves foráneas ni duplicados en las claves únicas revisadas. El inventario
contiene 31 tablas; entre los datos no vacíos hay 9 usuarios, 37 movimientos,
10 sesiones, 5 activaciones, 36 destinatarios guardados y 24 registros de
auditoría. `global_permanent_access_tokens` todavía no existe en ese archivo,
por lo que quedará creada y vacía por el esquema de Supabase.

La cadena Postgres se obtiene en Supabase: **Project settings → Database →
Connection string**. Para entornos serverless se recomienda el pooler de
transacciones y el adaptador usa `prepare: false` para que sea compatible.

## Aplicar el esquema

El repositorio incluye `supabase/config.toml` con el project ref; la sesión de
la CLI/MCP debe autenticarse fuera del repositorio.

Ejecuta el archivo
`supabase/migrations/20260801000000_initial_schema.sql` en el SQL Editor de
Supabase o con el MCP autenticado. Incluye las tablas, índices, restricciones y
los dos triggers que mantienen el saldo y el límite diario de transferencias.

No cambies `DATABASE_PROVIDER` antes de que esta ejecución termine y una cuenta
de prueba pueda consultar `users`, `sessions`, `account_balances` y
`account_movements`.

## Copiar datos sin destruir Turso

Desde `banco-web`, con las variables cargadas:

```bash
npm run db:migrate:supabase:dry-run
npm run db:migrate:supabase -- --apply
npm run db:verify:supabase
```

Para migrar el archivo local entregado, usa la misma secuencia indicando la
fuente SQLite (el modo de simulación no requiere una conexión Supabase):

```bash
node scripts/migrate-turso-to-supabase.mjs --source-sqlite="C:\\Users\\user\\Downloads\\yape-production.db"
node scripts/migrate-turso-to-supabase.mjs --source-sqlite="C:\\Users\\user\\Downloads\\yape-production.db" --apply
node scripts/migrate-turso-to-supabase.mjs --source-sqlite="C:\\Users\\user\\Downloads\\yape-production.db" --verify-only
```

La copia del archivo detecta tablas ausentes (por ejemplo, una tabla nueva sin
filas) y las omite sin fallar; el esquema de Supabase las crea vacías. Los
movimientos históricos se importan con un ajuste transaccional que evita que
los triggers de saldo vuelvan a descontarlos. Los triggers quedan activos para
las transferencias posteriores.

El primer comando solo cuenta y enumera filas. El segundo inserta cada tabla en
una transacción, con `ON CONFLICT DO NOTHING`; no elimina ni modifica filas de
Turso. Si se interrumpe, puede ejecutarse otra vez de forma idempotente. El
último comando compara los conteos de origen y destino.

Para validar una tabla concreta durante una revisión:

```bash
node scripts/migrate-turso-to-supabase.mjs --table=users
```

## Activar el backend

Después de verificar conteos y pruebas funcionales, configura en Vercel (solo
en el proyecto backend):

```text
DATABASE_PROVIDER=supabase
SUPABASE_DATABASE_URL=<cadena privada de conexión Postgres>
```

No añadas `SUPABASE_DATABASE_URL` al panel admin ni a ninguna variable
`NEXT_PUBLIC_*`. El panel sigue llamando a las rutas del backend y no conoce la
base de datos.

Para volver temporalmente a Turso, cambia `DATABASE_PROVIDER=turso` o elimina
la variable y conserva las variables de Turso.

## Seguridad y límites

- El backend se conecta directamente a Postgres; no se expone una service-role
  key en el navegador.
- Las consultas existentes conservan su interfaz D1. El adaptador convierte
  placeholders `?` a parámetros Postgres y `INSERT OR IGNORE` a
  `ON CONFLICT DO NOTHING`.
- Supabase no debe recibir respuestas privadas mediante el Data API. Si se
  habilita el Data API para otra función futura, agrega RLS explícito y usa
  service role solo en servidor.
- La copia no es un backup. Conserva el backup/export de Turso hasta completar
  la validación y el periodo de observación.

## Estado de ejecución

La conexión de Supabase fue validada y el esquema se aplicó correctamente. El
archivo SQLite fue importado el 1 de agosto de 2026 con 269 registros; la
verificación posterior coincidió en todas las tablas existentes en el origen.
La tabla `global_permanent_access_tokens` fue creada vacía porque todavía no
existía en el archivo exportado. Turso se conserva como respaldo hasta cerrar
la observación de producción.
