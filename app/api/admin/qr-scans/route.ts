import { jsonOk } from "@/app/lib/api-utils";
import { dbBinding, requireUnlockedSession, routeError } from "@/app/lib/auth-server";
import { assertOwner } from "@/app/lib/rbac";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { user: actor } = await requireUnlockedSession(request, ["admin"]);
    assertOwner(actor);
    const url = new URL(request.url);
    const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
    const pageSize = Math.min(50, Math.max(10, Number.parseInt(url.searchParams.get("pageSize") ?? "20", 10) || 20));
    const status = (url.searchParams.get("status") ?? "").trim();
    const allowedStatuses = new Set(["valid", "invalid"]);
    const filter = allowedStatuses.has(status) ? status : "";
    const conditions: string[] = [];
    const values: string[] = [];
    if (filter) {
      conditions.push("s.scan_status = ?");
      values.push(filter);
    }
    const dateFrom = url.searchParams.get("from")?.trim() ?? "";
    if (/^\d{4}-\d{2}-\d{2}$/u.test(dateFrom)) {
      conditions.push("s.scanned_at >= ?");
      values.push(`${dateFrom}T00:00:00.000Z`);
    }
    const dateTo = url.searchParams.get("to")?.trim() ?? "";
    if (/^\d{4}-\d{2}-\d{2}$/u.test(dateTo)) {
      const exclusiveEnd = new Date(`${dateTo}T00:00:00.000Z`);
      if (!Number.isNaN(exclusiveEnd.getTime())) {
        exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
        conditions.push("s.scanned_at < ?");
        values.push(exclusiveEnd.toISOString());
      }
    }
    const scanner = (url.searchParams.get("scanner") ?? "").trim().slice(0, 80).toLocaleLowerCase("es-PE");
    if (scanner) {
      conditions.push("(LOWER(COALESCE(u.display_name, '')) LIKE ? OR LOWER(COALESCE(u.username, '')) LIKE ? OR u.telegram_user_id = ?)");
      values.push(`%${scanner}%`, `%${scanner}%`, scanner);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const database = dbBinding();
    const total = await database.prepare(`SELECT COUNT(*) AS total FROM qr_scan_events s ${where}`).bind(...values).first<{ total: number }>();
    const totalCount = Number(total?.total ?? 0);
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const safePage = Math.min(page, totalPages);
    const rows = await database.prepare(
      `SELECT s.id, s.scan_status, s.error_code, s.device_information, s.scanned_at,
              q.holder_name, q.provider, u.display_name AS scanner_name
       FROM qr_scan_events s
       LEFT JOIN global_qr_directory q ON q.id = s.qr_id
       LEFT JOIN users u ON u.id = s.scanned_by_user_id
       ${where}
       ORDER BY s.scanned_at DESC, s.id DESC
       LIMIT ? OFFSET ?`,
    ).bind(...values, pageSize, (safePage - 1) * pageSize).all<{
      id: string;
      scan_status: string;
      error_code: string | null;
      device_information: string | null;
      scanned_at: string;
      holder_name: string | null;
      provider: string | null;
      scanner_name: string | null;
    }>();
    return jsonOk({
      events: (rows.results ?? []).map((row) => ({
        id: row.id,
        status: row.scan_status === "valid" ? "valid" : "invalid",
        errorCode: row.error_code,
        device: row.device_information ?? "unknown",
        scannedAt: row.scanned_at,
        qrName: row.holder_name,
        provider: row.provider,
        scanner: row.scanner_name ?? "Cuenta no disponible",
      })),
      pagination: { page: safePage, pageSize, total: totalCount, totalPages },
    });
  } catch (error) {
    return routeError(error);
  }
}
