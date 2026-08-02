import postgres, { type Sql } from "postgres";

/**
 * Database access stays behind the small D1-shaped interface already used by
 * the application. The production implementation is Supabase Postgres.
 * `DB` remains available only for isolated tests that inject an in-memory
 * compatible implementation.
 */
export type DatabaseEnvironment = {
  DB?: D1Database;
  DATABASE_PROVIDER?: string;
  SUPABASE_DATABASE_URL?: string;
};

type PostgresStatement = {
  sql: string;
  args: unknown[];
};

function postgresPlaceholders(query: string) {
  let result = "";
  let parameter = 0;
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < query.length; index += 1) {
    const character = query[index];
    const next = query[index + 1];
    if (quote) {
      result += character;
      if (character === quote && next === quote) {
        result += next;
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      result += character;
      continue;
    }
    if (character === "?") {
      parameter += 1;
      result += `$${parameter}`;
      continue;
    }
    result += character;
  }
  return result;
}

export function normalizePostgresStatement(statement: PostgresStatement) {
  const original = statement.sql.trim();
  if (!original || /^PRAGMA\s+/iu.test(original)) return null;

  const ignoredConflict = /^INSERT\s+OR\s+IGNORE\s+INTO\s+/iu.test(original);
  let sqlText = original.replace(/^INSERT\s+OR\s+IGNORE\s+INTO\s+/iu, "INSERT INTO ");
  sqlText = postgresPlaceholders(sqlText);
  if (ignoredConflict && !/\bON\s+CONFLICT\b/iu.test(sqlText)) {
    sqlText = `${sqlText.replace(/;\s*$/u, "")} ON CONFLICT DO NOTHING`;
  }
  return { sqlText, args: statement.args };
}

class SupabasePostgresPreparedStatement implements D1PreparedStatement {
  constructor(
    readonly client: Sql,
    readonly statement: PostgresStatement,
  ) {}

  bind(...values: unknown[]) {
    return new SupabasePostgresPreparedStatement(this.client, {
      sql: this.statement.sql,
      args: values,
    });
  }

  private async execute() {
    const normalized = normalizePostgresStatement(this.statement);
    if (!normalized) return { rows: [], count: 0 };
    return this.client.unsafe(normalized.sqlText, normalized.args as never[]);
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const result = await this.execute();
    const row = (result as Array<Record<string, unknown>>)[0];
    if (!row) return null;
    return (column ? row[column] : row) as T;
  }

  async run<T = Record<string, unknown>>() {
    const result = await this.execute();
    return {
      results: Array.from(result as Array<Record<string, unknown>>),
      success: true,
      meta: {
        changes: result.count,
        last_row_id: undefined,
      },
    } as D1Result<T>;
  }

  async all<T = Record<string, unknown>>() {
    return this.run<T>();
  }

  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]> {
    const result = await this.execute();
    const rows = result as Array<Record<string, unknown>>;
    if (!rows.length) return [];
    const columns = Object.keys(rows[0]);
    const rawRows = rows.map((row) => columns.map((column) => row[column]));
    if (options?.columnNames) rawRows.unshift(columns);
    return rawRows as T[];
  }
}

class SupabasePostgresDatabase implements D1Database {
  constructor(private readonly client: Sql) {}

  prepare(query: string) {
    return new SupabasePostgresPreparedStatement(this.client, { sql: query, args: [] });
  }

  async batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]) {
    const prepared = statements.map((statement) => {
      if (!(statement instanceof SupabasePostgresPreparedStatement)) {
        throw new TypeError("La consulta por lotes no pertenece a esta conexion.");
      }
      return normalizePostgresStatement(statement.statement);
    });
    const results: D1Result<T>[] = [];
    await this.client.begin(async (transaction) => {
      for (const statement of prepared) {
        if (!statement) {
          results.push({ results: [], success: true, meta: { changes: 0 } });
          continue;
        }
        const result = await transaction.unsafe(statement.sqlText, statement.args as never[]);
        results.push({
          results: Array.from(result as Array<Record<string, unknown>>) as T[],
          success: true,
          meta: { changes: result.count, last_row_id: undefined },
        });
      }
    });
    return results;
  }

  async exec(query: string) {
    if (!query.trim() || /^\s*PRAGMA\s+/iu.test(query)) {
      return { count: 0, duration: 0 };
    }
    const startedAt = performance.now();
    await this.client.unsafe(query);
    return {
      count: query.split(";").filter((statement) => statement.trim()).length,
      duration: performance.now() - startedAt,
    };
  }

  async dump(): Promise<ArrayBuffer> {
    throw new Error("La exportacion binaria no esta disponible mediante Supabase.");
  }
}

let activeSupabase: {
  url: string;
  database: D1Database;
  client: Sql;
} | null = null;

function supabaseDatabase(url: string) {
  if (activeSupabase?.url === url) return activeSupabase.database;
  const client = postgres(url, {
    ssl: "require",
    prepare: false,
    // Vercel puede crear varias instancias en paralelo. Mantener un pool
    // pequeño por instancia evita multiplicar conexiones contra el pooler de
    // Supabase durante un pico de tráfico.
    // La URL de producción usa el pool transaccional de Supavisor (puerto
    // 6543). Las vistas del panel hacen varias lecturas en paralelo; con dos
    // conexiones esas lecturas se quedaban en cola hasta que el proxy las
    // abortaba a los ocho segundos. Ocho conexiones mantienen el flujo sin
    // abrir una conexión física por cada solicitud.
    max: 8,
    idle_timeout: 20,
    connect_timeout: 10,
    max_lifetime: 600,
    connection: {
      application_name: "yape-web",
      statement_timeout: 8_000,
      lock_timeout: 3_000,
      idle_in_transaction_session_timeout: 10_000,
    },
    onnotice: () => undefined,
  });
  const database = new SupabasePostgresDatabase(client);
  activeSupabase = { url, database, client };
  return database;
}

export function isSupabaseDatabase(environment?: DatabaseEnvironment) {
  const resolvedEnvironment = environment ?? (globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  }).process?.env;
  return resolvedEnvironment?.DATABASE_PROVIDER?.trim().toLowerCase() === "supabase";
}

export function databaseForEnvironment(environment: DatabaseEnvironment) {
  if (environment.DB) return environment.DB;

  const provider = environment.DATABASE_PROVIDER?.trim().toLowerCase();
  if (provider !== "supabase") {
    throw new Error("DATABASE_PROVIDER debe estar configurado como supabase.");
  }

  const url = environment.SUPABASE_DATABASE_URL?.trim() ?? "";
  if (!url) {
    throw new Error("Configura SUPABASE_DATABASE_URL para usar Supabase.");
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("SUPABASE_DATABASE_URL no tiene un formato valido.");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("SUPABASE_DATABASE_URL debe utilizar el protocolo postgres:// o postgresql://.");
  }
  return supabaseDatabase(url);
}
