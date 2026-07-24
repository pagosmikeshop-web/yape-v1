type BalanceResult =
  | { ok: true; balance: number }
  | { ok: false; status: number };

const BALANCE_TTL_MS = 20_000;

let inflight: Promise<BalanceResult> | null = null;
let cached: { at: number; result: BalanceResult } | null = null;

export function clearBalanceCache() {
  inflight = null;
  cached = null;
}

export function fetchAccountBalance(options?: {
  force?: boolean;
}): Promise<BalanceResult> {
  const force = options?.force === true;
  const now = Date.now();

  if (!force && cached && now - cached.at < BALANCE_TTL_MS) {
    return Promise.resolve(cached.result);
  }

  if (!force && inflight) return inflight;

  inflight = fetch("/api/account/balance", { cache: "no-store" })
    .then(async (response) => {
      const data = (await response.json().catch(() => ({}))) as {
        balance?: number;
        ok?: boolean;
      };
      if (!response.ok || typeof data.balance !== "number") {
        const result: BalanceResult = { ok: false, status: response.status };
        /* No cachear fallos: el siguiente intento debe reintentar. */
        return result;
      }
      const result: BalanceResult = { ok: true, balance: data.balance };
      cached = { at: Date.now(), result };
      return result;
    })
    .catch(() => {
      /* Errores de red: no cachear. */
      return { ok: false, status: 0 } as BalanceResult;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}
