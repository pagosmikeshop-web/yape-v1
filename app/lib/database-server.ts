import {
  createClient,
  type BatchResultSet,
  type Client,
  type InValue,
  type ResultSet,
} from "@tursodatabase/serverless/compat";

export type DatabaseEnvironment = {
  DB?: D1Database;
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
  ) {}

  bind(...values: unknown[]) {
    return new TursoPreparedStatement(this.client, {
      sql: this.statement.sql,
      args: values.map(boundValue),
    });
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const result = await this.client.execute(this.statement);
    const row = rowsAsObjects<Record<string, InValue>>(
      result.columns,
      result.rows as Array<Record<string, InValue> | Array<InValue>>,
    )[0];
    if (!row) return null;
    return (column ? row[column] : row) as T;
  }

  async run<T = Record<string, unknown>>() {
    return d1Result<T>(await this.client.execute(this.statement));
  }

  async all<T = Record<string, unknown>>() {
    return d1Result<T>(await this.client.execute(this.statement));
  }

  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]> {
    const result = await this.client.execute(this.statement);
    const rows = result.rows.map((row) => result.columns.map((_, index) => row[index]));
    if (options?.columnNames) rows.unshift(result.columns);
    return rows as T[];
  }
}

class TursoD1Database implements D1Database {
  constructor(private readonly client: Client) {}

  prepare(query: string) {
    return new TursoPreparedStatement(this.client, { sql: query, args: [] });
  }

  async batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]) {
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

let activeTurso: {
  url: string;
  authToken: string;
  database: D1Database;
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

export function databaseForEnvironment(environment: DatabaseEnvironment) {
  if (environment.DB) return environment.DB;

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
