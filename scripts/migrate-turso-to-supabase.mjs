import { DatabaseSync } from "node:sqlite";
import fs from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { createClient } from "@tursodatabase/serverless/compat";

try {
  process.loadEnvFile?.();
} catch {
  // En Vercel/CI las variables ya llegan desde el entorno.
}

const TABLES = [
  "users",
  "user_roles",
  "sessions",
  "auth_rate_limits",
  "payment_directory",
  "recipient_lookup_attempts",
  "saved_payment_recipients",
  "account_balances",
  "account_movements",
  "account_history_state",
  "account_feature_entitlements",
  "autocomplete_keys",
  "autocomplete_key_claims",
  "credit_ledger",
  "activations",
  "permanent_access_tokens",
  "global_permanent_access_tokens",
  "password_reset_requests",
  "password_reset_tokens",
  "account_invitations",
  "qr_contacts",
  "telegram_identities",
  "telegram_updates",
  "telegram_registration_challenges",
  "telegram_group_members",
  "referral_redemptions",
  "manager_audit_log",
  "rbac_permission_overrides",
  "client_crm_profiles",
  "client_crm_activities",
  "webauthn_credentials",
  "webauthn_challenges",
];

const args = new Set(process.argv.slice(2));
const tableArg = process.argv.find((value) => value.startsWith("--table="))?.slice("--table=".length);
const tables = tableArg ? TABLES.filter((table) => table === tableArg) : TABLES;
const apply = args.has("--apply");
const verifyOnly = args.has("--verify-only");
const sqliteArg = process.argv.find((value) => value.startsWith("--source-sqlite="))?.slice("--source-sqlite=".length);
const sqliteFile = sqliteArg || process.env.SOURCE_SQLITE_FILE?.trim();

if (tableArg && tables.length === 0) {
  throw new Error(`Tabla no permitida: ${tableArg}`);
}

const tursoUrl = process.env.TURSO_DATABASE_URL?.trim();
const tursoToken = process.env.TURSO_AUTH_TOKEN?.trim();
const supabaseUrl = process.env.SUPABASE_DATABASE_URL?.trim();

if (!sqliteFile && (!tursoUrl || !tursoToken)) {
  throw new Error("Faltan TURSO_DATABASE_URL y TURSO_AUTH_TOKEN.");
}
if (apply || verifyOnly) {
  if (!supabaseUrl) throw new Error("Falta SUPABASE_DATABASE_URL.");
  if (!/^postgres(?:ql)?:\/\//u.test(supabaseUrl)) {
    throw new Error("SUPABASE_DATABASE_URL debe usar postgres:// o postgresql://.");
  }
}

const source = sqliteFile
  ? new DatabaseSync(path.resolve(sqliteFile), { readOnly: true })
  : createClient({ url: tursoUrl, authToken: tursoToken });
const target = apply || verifyOnly
  ? postgres(supabaseUrl, { prepare: false, max: 2, connect_timeout: 10, onnotice: () => undefined })
  : null;

let sqliteTables = null;
if (sqliteFile) {
  await fs.access(path.resolve(sqliteFile));
  sqliteTables = new Set(
    source
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((row) => row.name),
  );
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

async function sourceRows(table) {
  if (sqliteFile) {
    if (!sqliteTables.has(table)) return null;
    const columns = source
      .prepare(`PRAGMA table_info(${quoteIdentifier(table)})`)
      .all()
      .map((row) => row.name);
    const rows = source
      .prepare(`SELECT * FROM ${quoteIdentifier(table)}`)
      .all()
      .map((row) => columns.map((column) => row[column] ?? null));
    return { columns, rows };
  }
  const result = await source.execute(`SELECT * FROM ${quoteIdentifier(table)}`);
  return {
    columns: result.columns,
    rows: result.rows.map((row) => (Array.isArray(row) ? row : result.columns.map((column) => row[column]))),
  };
}

async function targetCount(table) {
  const rows = await target.unsafe(`SELECT count(*)::bigint AS count FROM public.${quoteIdentifier(table)}`);
  return Number(rows[0]?.count ?? 0);
}

async function importTable(table, columns, rows) {
  if (!rows.length) return 0;
  const quotedTable = `public.${quoteIdentifier(table)}`;
  const quotedColumns = columns.map(quoteIdentifier).join(", ");
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
  const query = `INSERT INTO ${quotedTable} (${quotedColumns}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
  await target.begin(async (transaction) => {
    if (table === "account_movements") {
      // Preserve historical balances exactly as exported. The schema triggers
      // remain enabled for normal application writes after this transaction.
      await transaction.unsafe("select set_config('yape.importing', 'true', true)");
    }
    for (const row of rows) {
      await transaction.unsafe(query, row.map((value) => value ?? null));
    }
  });
  return rows.length;
}

const sourceLabel = sqliteFile ? "SQLite" : "Turso";
console.log(`${apply ? "Aplicando" : "Simulando"} migración ${sourceLabel} → Supabase (${tables.length} tablas).`);
if (!apply) console.log("Modo seguro: no se escribirá en Supabase. Usa --apply solo después de revisar el resumen.");

console.log(`Origen seleccionado: ${sourceLabel}.`);

for (const table of tables) {
  const result = await sourceRows(table);
  if (!result) {
    console.log(`${table}: no existe en el origen; se omite (la migración crea la tabla vacía).`);
    continue;
  }
  const { columns, rows } = result;
  if (verifyOnly) {
    const count = await targetCount(table);
    console.log(`${table}: ${sourceLabel}=${rows.length} Supabase=${count}`);
    continue;
  }
  if (apply) {
    const before = await targetCount(table);
    await importTable(table, columns, rows);
    const after = await targetCount(table);
    console.log(`${table}: ${sourceLabel}=${rows.length} Supabase antes=${before} después=${after}`);
  } else {
    console.log(`${table}: ${rows.length} filas listas, columnas=${columns.length}`);
  }
}

if (target) await target.end({ timeout: 5 });
if (sqliteFile) source.close();
await fs.access(new URL("../supabase/migrations/20260801000000_initial_schema.sql", import.meta.url));
