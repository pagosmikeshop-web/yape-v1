interface Fetcher {
  fetch(input: Request | string | URL, init?: RequestInit): Promise<Response>;
}

interface D1Result<T = Record<string, unknown>> {
  results?: T[];
  success: boolean;
  error?: string;
  meta: Record<string, unknown>;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<{ count: number; duration: number }>;
  dump(): Promise<ArrayBuffer>;
}

declare module "cloudflare:workers" {
  export const env: {
    DB?: D1Database;
    APP_ENV?: string;
    PUBLIC_APP_URL?: string;
    ADMIN_WEB_URL?: string;
    AUTH_BOOTSTRAP_ENABLED?: string;
    AUTH_BOOTSTRAP_SECRET?: string;
    AUTH_OWNER_TELEGRAM_ID?: string;
    AUTH_RATE_LIMIT_PEPPER?: string;
    AUTH_SESSION_IDLE_MINUTES?: string;
    ACCOUNT_SMS_VALIDATION_TOKEN?: string;
    ACCOUNT_AUTO_VALIDATION_TOKEN?: string;
    QR_CONTACTS_ENCRYPTION_KEY?: string;
    TELEGRAM_BOT_TOKEN?: string;
    TELEGRAM_WEBHOOK_SECRET?: string;
    TELEGRAM_ADMIN_IDS?: string;
    TELEGRAM_BOT_USERNAME?: string;
    TELEGRAM_SUPPORT_USERNAME?: string;
    TELEGRAM_SUPPORT_USER_ID?: string;
    TELEGRAM_REQUIRED_GROUP_ID?: string;
    TELEGRAM_GROUP_INVITE_URL?: string;
    [binding: string]: unknown;
  };
}
