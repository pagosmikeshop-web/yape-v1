import { asString, jsonError, jsonOk, readJson } from "@/app/lib/api-utils";
import {
  createUser,
  dbBinding,
  generateTemporaryPassword,
  normalizePeruvianMobile,
  publicAppBaseUrl,
  requireUnlockedSession,
  routeError,
  SELF_REGISTRATION_SELLER_CODE,
  validateDisplayName,
  validateOptionalEmail,
  validateUsername,
} from "@/app/lib/auth-server";
import { createInvitation } from "@/app/lib/invitation-server";
import { hasPermission, requirePermission } from "@/app/lib/rbac";

export const dynamic = "force-dynamic";

const CRM_STATUSES = new Set(["new", "active", "pending", "suspended", "vip", "recurring"]);
const CLIENT_TYPES = new Set(["individual", "business"]);
const SORT_COLUMNS = {
  name: "u.display_name",
  date: "u.created_at",
  status: "p.crm_status",
  sales: "total_sales_cents",
  activity: "p.last_activity_at",
} as const;

function cleanTags(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((tag) => String(tag).trim().slice(0, 24)).filter(Boolean))].slice(0, 8);
}

export async function GET(request: Request) {
  try {
    const { user: actor } = await requireUnlockedSession(request, ["seller", "admin"]);
    await requirePermission(actor, "clients:view");
    const url = new URL(request.url);
    const search = (url.searchParams.get("search") ?? "").trim().slice(0, 80).toLocaleLowerCase("es-PE");
    const status = url.searchParams.get("status") ?? "";
    const sellerId = url.searchParams.get("sellerId") ?? "";
    const clientType = url.searchParams.get("clientType") ?? "";
    const category = (url.searchParams.get("category") ?? "").trim().slice(0, 40);
    const dateFrom = url.searchParams.get("dateFrom") ?? "";
    const dateTo = url.searchParams.get("dateTo") ?? "";
    const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
    const pageSize = Math.min(100, Math.max(10, Number.parseInt(url.searchParams.get("pageSize") ?? "20", 10) || 20));
    const sortKey = url.searchParams.get("sort") as keyof typeof SORT_COLUMNS | null;
    const sortColumn = sortKey && SORT_COLUMNS[sortKey] ? SORT_COLUMNS[sortKey] : SORT_COLUMNS.date;
    const sortDirection = url.searchParams.get("order") === "asc" ? "ASC" : "DESC";
    const canViewAll = actor.isOwner || await hasPermission(actor, "clients:view_all");

    const conditions = ["u.role = 'client'", "u.deleted_at IS NULL"];
    const values: unknown[] = [];
    if (!canViewAll) {
      if (actor.role === "seller") {
        conditions.push("u.owner_id = ?");
        values.push(actor.id);
      } else {
        conditions.push(`(
          u.owner_id = ? OR u.owner_id IN (
            SELECT id FROM users
            WHERE role = 'seller' AND owner_id = ? AND deleted_at IS NULL
          )
        )`);
        values.push(actor.id, actor.id);
      }
    }
    if (search) {
      conditions.push(`(
        LOWER(u.display_name) LIKE ? OR LOWER(u.username) LIKE ? OR
        LOWER(u.email) LIKE ? OR d.phone_e164 LIKE ? OR LOWER(COALESCE(p.tags_json, '')) LIKE ?
      )`);
      const term = `%${search}%`;
      values.push(term, term, term, term, term);
    }
    if (CRM_STATUSES.has(status)) {
      conditions.push("COALESCE(p.crm_status, 'new') = ?");
      values.push(status);
    }
    if (sellerId === "unassigned") conditions.push("u.owner_id IS NULL");
    else if (sellerId && canViewAll) {
      conditions.push("u.owner_id = ?");
      values.push(sellerId);
    }
    if (CLIENT_TYPES.has(clientType)) {
      conditions.push("COALESCE(p.client_type, 'individual') = ?");
      values.push(clientType);
    }
    if (category) {
      conditions.push("COALESCE(p.category, 'general') = ?");
      values.push(category);
    }
    if (/^\d{4}-\d{2}-\d{2}$/u.test(dateFrom)) {
      conditions.push("u.created_at >= ?");
      values.push(`${dateFrom}T00:00:00.000Z`);
    }
    if (/^\d{4}-\d{2}-\d{2}$/u.test(dateTo)) {
      conditions.push("u.created_at <= ?");
      values.push(`${dateTo}T23:59:59.999Z`);
    }
    const where = `WHERE ${conditions.join(" AND ")}`;
    const database = dbBinding();
    const count = await database.prepare(
      `SELECT COUNT(*) AS total
       FROM users u
       LEFT JOIN payment_directory d ON d.user_id = u.id
       LEFT JOIN client_crm_profiles p ON p.user_id = u.id
       ${where}`,
    ).bind(...values).first<{ total: number }>();

    const result = await database.prepare(
      `SELECT u.id, u.seller_code, u.username, u.display_name, u.email, u.status,
              u.owner_id, u.created_at, u.activated_at, u.device_id, u.referral_code,
              u.access_expires_at, d.phone_e164,
              COALESCE(p.crm_status, 'new') AS crm_status,
              COALESCE(p.client_type, 'individual') AS client_type,
              COALESCE(p.category, 'general') AS category,
              COALESCE(p.tags_json, '[]') AS tags_json,
              COALESCE(p.notes, '') AS notes,
              p.last_activity_at,
              s.display_name AS seller_name,
              COALESCE(SUM(CASE WHEN a.activity_type = 'purchase' THEN a.amount_cents ELSE 0 END), 0) AS total_sales_cents,
              COUNT(a.id) AS activity_count
       FROM users u
       LEFT JOIN payment_directory d ON d.user_id = u.id
       LEFT JOIN client_crm_profiles p ON p.user_id = u.id
       LEFT JOIN users s ON s.id = u.owner_id AND s.role = 'seller' AND s.deleted_at IS NULL
       LEFT JOIN client_crm_activities a ON a.user_id = u.id
       ${where}
       GROUP BY u.id
       ORDER BY ${sortColumn} ${sortDirection}, u.id DESC
       LIMIT ? OFFSET ?`,
    ).bind(...values, pageSize, (page - 1) * pageSize).all<Record<string, unknown>>();

    const clients = (result.results ?? []).map((client) => {
      let tags: string[] = [];
      try {
        const parsed = JSON.parse(String(client.tags_json ?? "[]"));
        tags = cleanTags(parsed);
      } catch {
        tags = [];
      }
      const rest = { ...client };
      delete rest.tags_json;
      return { ...rest, tags };
    });
    const total = Number(count?.total ?? 0);
    return jsonOk({
      clients,
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
      viewerRole: actor.isOwner ? "owner" : actor.role,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { user: actor } = await requireUnlockedSession(request, ["seller", "admin"]);
    await requirePermission(actor, "clients:create");
    const body = await readJson(request);
    const username = asString(body.username);
    const displayName = asString(body.displayName).trim();
    const email = asString(body.email).trim().toLowerCase();
    const phone = normalizePeruvianMobile(asString(body.phone));
    const crmStatus = CRM_STATUSES.has(asString(body.crmStatus)) ? asString(body.crmStatus) : "new";
    const clientType = CLIENT_TYPES.has(asString(body.clientType)) ? asString(body.clientType) : "individual";
    const category = asString(body.category).trim().slice(0, 40) || "general";
    const tags = cleanTags(body.tags);

    if (!validateUsername(username) || !validateDisplayName(displayName) || !validateOptionalEmail(email) || !phone) {
      return jsonError("Completa un usuario, nombre y celular peruano válidos.");
    }

    let ownerId: string | null = actor.role === "seller" ? actor.id : null;
    let sellerCode = actor.role === "seller" ? actor.sellerCode : SELF_REGISTRATION_SELLER_CODE;
    const requestedSellerId = asString(body.sellerId).trim();
    if (requestedSellerId && actor.role !== "seller") {
      await requirePermission(actor, "clients:assign");
      const canAssignGlobally = actor.isOwner || await hasPermission(actor, "clients:view_all");
      const seller = await dbBinding().prepare(
        `SELECT id, seller_code
         FROM users
         WHERE id = ? AND role = 'seller' AND status = 'active' AND deleted_at IS NULL
           AND (? = 1 OR owner_id = ?)
         LIMIT 1`,
      ).bind(requestedSellerId, canAssignGlobally ? 1 : 0, actor.id).first<{ id: string; seller_code: string }>();
      if (!seller) return jsonError("Vendedor activo no encontrado.", 404);
      ownerId = seller.id;
      sellerCode = seller.seller_code;
    }

    const id = await createUser({
      sellerCode,
      username,
      displayName,
      email,
      password: generateTemporaryPassword(),
      phone,
      role: "client",
      ownerId,
      status: "pending",
      mustChangePassword: true,
    });
    const now = new Date().toISOString();
    await dbBinding().batch([
      dbBinding().prepare(
        `INSERT INTO client_crm_profiles
           (user_id, crm_status, client_type, category, tags_json, notes, last_activity_at, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, '', ?, ?, ?)`,
      ).bind(id, crmStatus, clientType, category, JSON.stringify(tags), now, actor.id, now),
      dbBinding().prepare(
        `INSERT INTO manager_audit_log (id, telegram_user_id, command, outcome, created_at)
         VALUES (?, ?, 'crm_client_create', ?, ?)`,
      ).bind(crypto.randomUUID(), actor.telegramUserId ?? actor.id, `${id}:${ownerId ?? "unassigned"}`, now),
    ]);
    const invitation = await createInvitation(id);
    const activationUrl = new URL(invitation.activationPath, publicAppBaseUrl(request)).toString();

    return jsonOk({
      client: { id, username: username.toLowerCase(), displayName, phone, status: "pending", ownerId },
      invitation: { activationUrl, expiresAt: invitation.expiresAt },
      message: ownerId
        ? "Cliente creado en el CRM y asignado correctamente. No tiene acceso al panel."
        : "Cliente creado en el CRM sin vendedor asignado. No tiene acceso al panel.",
    }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return routeError(error);
  }
}
