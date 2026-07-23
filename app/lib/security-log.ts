type SecurityOutcome = "success" | "denied" | "failure";
type SecurityDetail = string | number | boolean | null;

const SENSITIVE_DETAIL_NAME = /password|secret|token|cookie|authorization|proof|payload|phone|email/iu;

function cleanDetail(name: string, value: SecurityDetail) {
  if (SENSITIVE_DETAIL_NAME.test(name)) return "[redacted]";
  if (typeof value !== "string") return value;
  return value.replace(/[\u0000-\u001f\u007f]/gu, "").slice(0, 128);
}

export function writeSecurityEvent(
  request: Request,
  event: string,
  outcome: SecurityOutcome,
  details: Record<string, SecurityDetail> = {},
) {
  const safeDetails = Object.fromEntries(
    Object.entries(details)
      .slice(0, 12)
      .map(([name, value]) => [name.slice(0, 48), cleanDetail(name, value)]),
  );
  console.info("[security-event]", {
    timestamp: new Date().toISOString(),
    requestId: request.headers.get("x-request-id") ?? "unavailable",
    event: event.replace(/[^a-z0-9_.:-]/giu, "_").slice(0, 80),
    outcome,
    method: request.method,
    path: new URL(request.url).pathname,
    ...safeDetails,
  });
}

