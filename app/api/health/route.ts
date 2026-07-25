import { jsonOk } from "@/app/lib/api-utils";
import { dbBinding } from "@/app/lib/auth-server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const row = await dbBinding().prepare("SELECT 1 AS ready").first<{ ready: number }>();
    if (row?.ready !== 1) throw new Error("database-not-ready");
    return jsonOk(
      { status: "ready", database: "available" },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return Response.json(
      { ok: false, status: "unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
