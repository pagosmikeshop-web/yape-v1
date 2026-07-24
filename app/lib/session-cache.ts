type SessionUser = {
  unlocked?: boolean;
  role?: string;
  [key: string]: unknown;
};

type SessionPayload = {
  user?: SessionUser | null;
  code?: string;
};

type SessionResult =
  | { ok: true; user: SessionUser }
  | { ok: false; status: number; code?: string; unauthorized: true };

const SESSION_TTL_MS = 45_000;

let inflight: Promise<SessionResult> | null = null;
let cached: { at: number; result: SessionResult } | null = null;

export function clearSessionCache() {
  inflight = null;
  cached = null;
}

export function hasOptimisticUnlock(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem("yape-unlocked") === "1";
  } catch {
    return false;
  }
}

export function setOptimisticUnlock(unlocked: boolean) {
  if (typeof window === "undefined") return;
  try {
    if (unlocked) window.sessionStorage.setItem("yape-unlocked", "1");
    else window.sessionStorage.removeItem("yape-unlocked");
  } catch {
    /* ignore quota / private mode */
  }
}

/**
 * Deduplica /api/auth/me entre vistas (perfil, transfer, etc.)
 * para que la navegación no dispare varias llamadas en paralelo.
 */
export function fetchSession(options?: {
  force?: boolean;
}): Promise<SessionResult> {
  const force = options?.force === true;
  const now = Date.now();

  if (!force && cached && now - cached.at < SESSION_TTL_MS) {
    return Promise.resolve(cached.result);
  }

  if (!force && inflight) return inflight;

  inflight = fetch("/api/auth/me", { cache: "no-store" })
    .then(async (response) => {
      const data = (await response.json().catch(() => ({}))) as SessionPayload;
      if (response.status === 403 && data?.code === "ACCESS_EXPIRED") {
        const result: SessionResult = {
          ok: false,
          status: 403,
          code: "ACCESS_EXPIRED",
          unauthorized: true,
        };
        cached = { at: Date.now(), result };
        return result;
      }
      if (!response.ok || !data.user) {
        const result: SessionResult = {
          ok: false,
          status: response.status,
          unauthorized: true,
        };
        /* Solo cachear 401/403 reales; otros errores no bloquean reintentos. */
        if (response.status === 401 || response.status === 403) {
          cached = { at: Date.now(), result };
        }
        return result;
      }
      const result: SessionResult = { ok: true, user: data.user };
      cached = { at: Date.now(), result };
      return result;
    })
    .catch(() => {
      /* No cachear fallos de red: evita falsos logouts durante 45s. */
      const result: SessionResult = {
        ok: false,
        status: 0,
        unauthorized: true,
      };
      return result;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}
