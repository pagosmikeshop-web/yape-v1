import { jsonOk } from "@/app/lib/api-utils";

export const dynamic = "force-dynamic";

/**
 * La PWA consulta esta versión sin caché porque el Service Worker puede
 * permanecer activo aunque el código de Next.js haya cambiado.
 */
export async function GET() {
  return jsonOk(
    { version: process.env.NEXT_PUBLIC_BUILD_VERSION?.trim() || "development" },
    { headers: { "cache-control": "no-store, max-age=0" } },
  );
}
