import { authEnv, secureCompare } from "@/app/lib/auth-server";

/** Valida invocaciones programadas de Vercel sin aceptar llamadas públicas. */
export async function isAuthorizedCronRequest(request: Request) {
  const configured = authEnv().CRON_SECRET?.trim() ?? "";
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  return configured.length >= 32 && supplied.length >= 32 && secureCompare(configured, supplied);
}
