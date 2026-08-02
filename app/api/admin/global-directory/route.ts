import { asString, jsonError, jsonOk, readJson } from "@/app/lib/api-utils";
import {
  dbBinding,
  enforceAuthRateLimits,
  requireUnlockedSession,
  routeError,
} from "@/app/lib/auth-server";
import { maskPhoneOrNull } from "@/app/lib/masked-phone";

export const dynamic = "force-dynamic";

type DirectoryKind = "recipient" | "qr";
type DirectoryAction = "revoke" | "restore";
type DirectoryStatus = "active" | "revoked";

type DirectoryRow = {
  id: string;
  kind: DirectoryKind;
  name: string;
  phone_e164: string | null;
  source: string;
  provider: string | null;
  status: DirectoryStatus;
  submitted_by_user_id: string;
  submitter_telegram_id: string | null;
  submitter_name: string | null;
  submitter_username: string | null;
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
  revoked_reason: string | null;
};

function assertOwner(actor: { isOwner: boolean }) {
  if (!actor.isOwner) {
    throw Response.json(
      { ok: false, code: "OWNER_ONLY", error: "Esta sección está disponible únicamente para el Owner." },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  }
}

function kindValue(value: string) {
  return value === "recipient" || value === "qr" ? value : "";
}

function statusValue(value: string) {
  return value === "active" || value === "revoked" ? value : "";
}

function rowDto(row: DirectoryRow) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    phone: maskPhoneOrNull(row.phone_e164),
    source: row.source,
    provider: row.provider,
    status: row.status,
    submittedBy: {
      id: row.submitted_by_user_id,
      telegramId: row.submitter_telegram_id,
      name: row.submitter_name || row.submitter_username || "Cuenta no disponible",
      username: row.submitter_username,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revokedAt: row.revoked_at,
    revokedReason: row.revoked_reason,
  };
}

function directoryUnion() {
  return `
    SELECT
      d.id, 'recipient' AS kind, d.display_name AS name, d.phone_e164,
      d.source, NULL AS provider, d.status, d.submitted_by_user_id,
      u.telegram_user_id AS submitter_telegram_id,
      u.display_name AS submitter_name, u.username AS submitter_username,
      d.created_at, d.updated_at, d.revoked_at, d.revoked_reason
    FROM global_recipient_directory d
    LEFT JOIN users u ON u.id = d.submitted_by_user_id
    UNION ALL
    SELECT
      q.id, 'qr' AS kind, q.holder_name AS name, q.phone_e164,
      'qr' AS source, q.provider, q.status, q.submitted_by_user_id,
      u.telegram_user_id AS submitter_telegram_id,
      u.display_name AS submitter_name, u.username AS submitter_username,
      q.created_at, q.updated_at, q.revoked_at, q.revoked_reason
    FROM global_qr_directory q
    LEFT JOIN users u ON u.id = q.submitted_by_user_id
  `;
}

function buildFilters(search: string, kind: string, status: string) {
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (kind) {
    conditions.push("entries.kind = ?");
    values.push(kind);
  }
  if (status) {
    conditions.push("entries.status = ?");
    values.push(status);
  }
  if (search) {
    const term = `%${search.toLocaleLowerCase("es-PE")}%`;
    conditions.push(`(
      LOWER(COALESCE(entries.name, '')) LIKE ?
      OR LOWER(COALESCE(entries.phone_e164, '')) LIKE ?
      OR LOWER(COALESCE(entries.provider, '')) LIKE ?
      OR LOWER(COALESCE(entries.submitter_name, '')) LIKE ?
      OR LOWER(COALESCE(entries.submitter_username, '')) LIKE ?
    )`);
    values.push(term, term, term, term, term);
  }
  return { sql: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", values };
}

async function moderateEntry(input: {
  actor: { id: string; telegramUserId: string | null; isOwner: boolean };
  id: string;
  kind: DirectoryKind;
  action: DirectoryAction;
  reason: string;
}) {
  const database = dbBinding();
  const table = input.kind === "qr" ? "global_qr_directory" : "global_recipient_directory";
  const current = await database.prepare(
    `SELECT id, status FROM ${table} WHERE id = ? LIMIT 1`,
  ).bind(input.id).first<{ id: string; status: DirectoryStatus }>();
  if (!current) return false;

  const now = new Date().toISOString();
  const nextStatus = input.action === "revoke" ? "revoked" : "active";
  const revokedAt = input.action === "revoke" ? now : null;
  const revokedReason = input.action === "revoke" ? (input.reason || "Revisión del Owner") : null;
  const command = input.action === "revoke" ? "web_global_directory_revoke" : "web_global_directory_restore";
  const auditActor = input.actor.telegramUserId ?? input.actor.id;

  const results = await database.batch([
    database.prepare(
      `UPDATE ${table}
       SET status = ?, revoked_at = ?, revoked_reason = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(nextStatus, revokedAt, revokedReason, now, input.id),
    database.prepare(
      `INSERT INTO manager_audit_log (id, telegram_user_id, command, outcome, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), auditActor, command, `${input.kind}:${input.id}:${input.reason || ""}`.slice(0, 240), now),
  ]);
  return Number(results[0]?.meta.changes ?? 0) === 1;
}

export async function GET(request: Request) {
  try {
    const { user: actor } = await requireUnlockedSession(request, ["admin"]);
    assertOwner(actor);

    const url = new URL(request.url);
    const search = (url.searchParams.get("search") ?? "").trim().slice(0, 80);
    const kind = kindValue(url.searchParams.get("kind") ?? "");
    const status = statusValue(url.searchParams.get("status") ?? "");
    const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
    const pageSize = Math.min(50, Math.max(10, Number.parseInt(url.searchParams.get("pageSize") ?? "20", 10) || 20));
    const filters = buildFilters(search, kind, status);
    const from = `FROM (${directoryUnion()}) entries ${filters.sql}`;
    const database = dbBinding();
    const [totalRow, summaryRows] = await Promise.all([
      database.prepare(`SELECT COUNT(*) AS total ${from}`).bind(...filters.values).first<{ total: number }>(),
      database.prepare(
        `SELECT entries.status, COUNT(*) AS count FROM (${directoryUnion()}) entries GROUP BY entries.status`,
      ).all<{ status: DirectoryStatus; count: number }>(),
    ]);
    const total = Number(totalRow?.total ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const rows = await database.prepare(
      `SELECT entries.* ${from}
       ORDER BY entries.updated_at DESC, entries.id DESC
       LIMIT ? OFFSET ?`,
    ).bind(...filters.values, pageSize, (safePage - 1) * pageSize).all<DirectoryRow>();
    const summary = { active: 0, revoked: 0 };
    for (const row of summaryRows.results ?? []) summary[row.status] = Number(row.count ?? 0);

    return jsonOk({
      entries: (rows.results ?? []).map(rowDto),
      summary: { ...summary, total: summary.active + summary.revoked },
      pagination: { page: safePage, pageSize, total, totalPages },
    });
  } catch (error) {
    return routeError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { user: actor } = await requireUnlockedSession(request, ["admin"]);
    assertOwner(actor);
    await enforceAuthRateLimits([{ bucket: "global-directory-moderation", subject: actor.id, limit: 120, windowSeconds: 60 * 60 }]);
    const body = await readJson(request);
    if (Object.keys(body).some((key) => !["id", "kind", "action", "reason"].includes(key))) {
      return jsonError("La solicitud contiene campos no permitidos.", 400);
    }
    const id = asString(body.id).trim();
    const kind = kindValue(asString(body.kind)) as DirectoryKind;
    const action = asString(body.action) as DirectoryAction;
    const reason = asString(body.reason).trim().slice(0, 160);
    if (!/^[0-9a-f-]{16,80}$/iu.test(id) || !kind || (action !== "revoke" && action !== "restore")) {
      return jsonError("La solicitud de moderación no es válida.", 400);
    }
    const updated = await moderateEntry({ actor, id, kind, action, reason });
    if (!updated) return jsonError("El registro ya no está disponible.", 404);
    return jsonOk({ status: action === "revoke" ? "revoked" : "active" });
  } catch (error) {
    return routeError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { user: actor } = await requireUnlockedSession(request, ["admin"]);
    assertOwner(actor);
    await enforceAuthRateLimits([{ bucket: "global-directory-moderation", subject: actor.id, limit: 120, windowSeconds: 60 * 60 }]);
    const body = await readJson(request);
    if (Object.keys(body).some((key) => !["id", "kind"].includes(key))) {
      return jsonError("La solicitud contiene campos no permitidos.", 400);
    }
    const id = asString(body.id).trim();
    const kind = kindValue(asString(body.kind)) as DirectoryKind;
    if (!/^[0-9a-f-]{16,80}$/iu.test(id) || !kind) return jsonError("El registro no es válido.", 400);

    const table = kind === "qr" ? "global_qr_directory" : "global_recipient_directory";
    const database = dbBinding();
    const exists = await database.prepare(`SELECT id FROM ${table} WHERE id = ? LIMIT 1`).bind(id).first<{ id: string }>();
    if (!exists) return jsonError("El registro ya no está disponible.", 404);
    const now = new Date().toISOString();
    const auditActor = actor.telegramUserId ?? actor.id;
    const results = await database.batch([
      database.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id),
      database.prepare(
        `INSERT INTO manager_audit_log (id, telegram_user_id, command, outcome, created_at)
         VALUES (?, ?, 'web_global_directory_delete', ?, ?)`,
      ).bind(crypto.randomUUID(), auditActor, `${kind}:${id}`, now),
    ]);
    if (Number(results[0]?.meta.changes ?? 0) !== 1) return jsonError("El registro ya no está disponible.", 404);
    return jsonOk({ deleted: true });
  } catch (error) {
    return routeError(error);
  }
}
