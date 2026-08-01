# Operacion de Supabase

La aplicacion usa Supabase Postgres como su unico proveedor de base de datos.
El backend se conecta con `SUPABASE_DATABASE_URL` desde el servidor y el
panel administrativo nunca se conecta directamente a la base.

## Requisitos

- Una base de datos Supabase del proyecto `zhgszyxjcvdyveoaefxh`.
- La cadena privada de conexion Postgres del pooler de Supabase, guardada
  unicamente como `SUPABASE_DATABASE_URL` en el backend/Vercel.
- Node 24 o superior para importar una exportacion SQLite local.

La cadena se obtiene en Supabase: **Project settings -> Database -> Connection
string**. Para Vercel se recomienda el pooler de transacciones y el adaptador
usa `prepare: false` y SSL obligatorio.

## Aplicar el esquema

El repositorio incluye `supabase/config.toml` con el project ref. La sesion de
la CLI/MCP debe autenticarse fuera del repositorio.

Ejecuta `supabase/migrations/20260801000000_initial_schema.sql` en el SQL
Editor de Supabase o con el MCP autenticado. Incluye las tablas, indices,
restricciones y los triggers que mantienen el saldo y el limite diario de
transferencias.

## Importar una exportacion SQLite

El script de importacion solo acepta una fuente SQLite en modo lectura. No
modifica el archivo original y las inserciones son idempotentes.

Desde `banco-web`:

```bash
npm run db:migrate:supabase:dry-run
npm run db:migrate:supabase -- --apply
npm run db:verify:supabase
```

Para indicar una fuente concreta:

```bash
node scripts/import-sqlite-to-supabase.mjs --source-sqlite="C:\\Users\\user\\Downloads\\yape-production.db"
node scripts/import-sqlite-to-supabase.mjs --source-sqlite="C:\\Users\\user\\Downloads\\yape-production.db" --apply
node scripts/import-sqlite-to-supabase.mjs --source-sqlite="C:\\Users\\user\\Downloads\\yape-production.db" --verify-only
```

Tambien puedes usar `SOURCE_SQLITE_FILE` en el entorno local. El modo de
simulacion enumera filas sin escribir. `--apply` inserta las tablas disponibles
con `ON CONFLICT DO NOTHING`; `--verify-only` compara los conteos de origen y
destino. Los movimientos historicos se importan con un ajuste transaccional
que evita volver a descontar saldos; los triggers quedan activos para nuevas
transferencias.

## Activar el backend

En Vercel, solo en el proyecto backend, configura:

```text
APP_ENV=production
DATABASE_PROVIDER=supabase
SUPABASE_DATABASE_URL=<cadena privada de conexion Postgres>
```

No agregues `SUPABASE_DATABASE_URL` al panel admin ni a ninguna variable
`NEXT_PUBLIC_*` o `VITE_*`.

## Verificacion realizada

- La conexion Postgres respondio correctamente.
- El esquema de Supabase fue aplicado.
- La importacion local se completo con 269 registros.
- La verificacion de conteos coincidio en todas las tablas presentes en la
  fuente SQLite.
- La tabla `global_permanent_access_tokens` quedo creada por el esquema y
  vacia porque no existia en la fuente original.

## Seguridad y operacion

- El backend usa Postgres directo y no expone una service-role key al
  navegador.
- La URL de conexion y los secretos deben vivir unicamente en Vercel o en el
  `.env` local ignorado por Git.
- No se cachean respuestas privadas ni se usa el Data API para las consultas
  internas del backend.
- Ejecuta las migraciones desde un entorno controlado, nunca durante una
  solicitud de usuario en Vercel.
- Verifica `GET /api/health` despues de cada despliegue.
