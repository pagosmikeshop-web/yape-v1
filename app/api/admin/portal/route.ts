import { authEnv } from "@/app/lib/auth-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const configuredUrl = authEnv().ADMIN_WEB_URL?.trim() ?? "";
  let destination: URL;
  try {
    destination = new URL(configuredUrl);
  } catch {
    return Response.json(
      { ok: false, error: "El panel administrativo externo no está configurado." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
  const localHttp = destination.protocol === "http:"
    && (destination.hostname === "localhost" || destination.hostname === "127.0.0.1");
  if (destination.protocol !== "https:" && !localHttp) {
    return Response.json(
      { ok: false, error: "La dirección del panel administrativo no es válida." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
  return new Response(null, {
    status: 307,
    headers: { location: destination.toString(), "cache-control": "no-store" },
  });
}
