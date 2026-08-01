import {
  createClient,
  type BatchResultSet,
  type Client,
  type InValue,
  type ResultSet,
} from "@tursodatabase/serverless/compat";
import postgres, { type Sql } from "postgres";

export type DatabaseEnvironment = {
  DB?: D1Database;
  DATABASE_PROVIDER?: string;
  SUPABASE_DATABASE_URL?: string;
  TURSO_DATABASE_URL?: string;
  TURSO_AUTH_TOKEN?: string;
};

type TursoStatement = {
  sql: string;
  args: InValue[];
};

function boundValue(value: unknown): InValue {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "number"
    || typeof value === "bigint"
    || typeof value === "boolean"
    || value instanceof ArrayBuffer
    || value instanceof Uint8Array
    || value instanceof Date
  ) {
    return value;
  }
  throw new TypeError("La consulta contiene un valor no compatible con SQLite.");
}

function rowsAsObjects<T>(columns: string[], rows: Array<Record<string, InValue> | Array<InValue>>) {
  return rows.map((row) => {
    if (!Array.isArray(row)) return row as T;
    return Object.fromEntries(columns.map((column, index) => [column, row[index] ?? null])) as T;
  });
}

function d1Result<T>(
  result: ResultSet | BatchResultSet,
): D1Result<T> {
  return {
    results: rowsAsObjects<T>(
      result.columns,
      result.rows as Array<Record<string, InValue> | Array<InValue>>,
    ),
    success: true,
    meta: {
      changes: result.rowsAffected,
      last_row_id: "lastInsertRowid" in result && result.lastInsertRowid !== undefined
        ? result.lastInsertRowid.toString()
        : undefined,
    },
  };
}

class TursoPreparedStatement implements D1PreparedStatement {
  constructor(
    readonly client: Client,
    readonly statement: TursoStatement,
    readonly ready: Promise<void>,
  ) {}

  bind(...values: unknown[]) {
    return new TursoPreparedStatement(this.client, {
      sql: this.statement.sql,
      args: values.map(boundValue),
    }, this.ready);
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    await this.ready;
    const result = await this.client.execute(this.statement);
    const row = rowsAsObjects<Record<string, InValue>>(
      result.columns,
      result.rows as Array<Record<string, InValue> | Array<InValue>>,
    )[0];
    if (!row) return null;
    return (column ? row[column] : row) as T;
  }

  async run<T = Record<string, unknown>>() {
    await this.ready;
    return d1Result<T>(await this.client.execute(this.statement));
  }

  async all<T = Record<string, unknown>>() {
    await this.ready;
    return d1Result<T>(await this.client.execute(this.statement));
  }

  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]> {
    await this.ready;
    const result = await this.client.execute(this.statement);
    const rows = result.rows.map((row) => result.columns.map((_, index) => row[index]));
    if (options?.columnNames) rows.unshift(result.columns);
    return rows as T[];
  }
}

class TursoD1Database implements D1Database {
  private readonly ready: Promise<void>;

  constructor(private readonly client: Client) {
    this.ready = client.execute("PRAGMA foreign_keys = ON").then(() => undefined);
  }

  prepare(query: string) {
    return new TursoPreparedStatement(this.client, { sql: query, args: [] }, this.ready);
  }

  async batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]) {
    await this.ready;
    const input = statements.map((statement) => {
      if (!(statement instanceof TursoPreparedStatement)) {
        throw new TypeError("La consulta por lotes no pertenece a esta conexión.");
      }
      return statement.statement;
    });
    const results = await this.client.batch(input, { mode: "write" });
    return results.map((result) => d1Result<T>(result));
  }

  async exec(query: string) {
    await this.ready;
    const startedAt = performance.now();
    await this.client.executeMultiple(query);
    return {
      count: query.split(";").filter((statement) => statement.trim()).length,
      duration: performance.now() - startedAt,
    };
  }

  async dump(): Promise<ArrayBuffer> {
    throw new Error("La exportación binaria no está disponible mediante la conexión remota.");
  }
}

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
        throw new TypeError("La consulta por lotes no pertenece a esta conexiÃ³n.");
      }
      const normalized = normalizePostgresStatement(statement.statement);
      if (!normalized) return null;
      return normalized;
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
    throw new Error("La exportaciÃ³n binaria no estÃ¡ disponible mediante Supabase.");
  }
}

let activeTurso: {
  url: string;
  authToken: string;
  database: D1Database;
} | null = null;

let activeSupabase: {
  url: string;
  database: D1Database;
  client: Sql;
} | null = null;

function tursoDatabase(url: string, authToken: string) {
  if (activeTurso?.url === url && activeTurso.authToken === authToken) {
    return activeTurso.database;
  }
  const client = createClient({ url, authToken });
  const database = new TursoD1Database(client);
  activeTurso = { url, authToken, database };
  return database;
}

function supabaseDatabase(url: string) {
  if (activeSupabase?.url === url) return activeSupabase.database;
  const client = postgres(url, {
    prepare: false,
    max: 4,
    idle_timeout: 20,
    connect_timeout: 10,
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
  if (provider === "supabase") {
    const url = environment.SUPABASE_DATABASE_URL?.trim() ?? "";
    if (!url) {
      throw new Error("Configura SUPABASE_DATABASE_URL para usar Supabase.");
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("SUPABASE_DATABASE_URL no tiene un formato vÃ¡lido.");
    }
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
      throw new Error("SUPABASE_DATABASE_URL debe utilizar el protocolo postgres:// o postgresql://.");
    }
    return supabaseDatabase(url);
  }

  const url = environment.TURSO_DATABASE_URL?.trim() ?? "";
  const authToken = environment.TURSO_AUTH_TOKEN?.trim() ?? "";
  if (!url || !authToken) {
    throw new Error("Configura TURSO_DATABASE_URL y TURSO_AUTH_TOKEN para conectar la base de datos.");
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("TURSO_DATABASE_URL no tiene un formato válido.");
  }
  if (parsed.protocol !== "libsql:" && parsed.protocol !== "https:") {
    throw new Error("TURSO_DATABASE_URL debe utilizar el protocolo libsql:// o https://.");
  }
  return tursoDatabase(url, authToken);
}
