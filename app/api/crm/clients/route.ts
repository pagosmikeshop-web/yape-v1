import { asString, jsonError, jsonOk, readJson } from "@/app/lib/api-utils";
import {
  createUser,
  dbBinding,
  enforceAuthRateLimits,
  generateTemporaryPassword,
  normalizePeruvianMobile,
  publicAppBaseUrl,
  requestIpRateLimitSubject,
  requireUnlockedSession,
  routeError,
  SELF_REGISTRATION_SELLER_CODE,
  validateDisplayName,
  validateUsername,
} from "@/app/lib/auth-server";
import { createInvitation } from "@/app/lib/invitation-server";
import { hasPermission, requirePermission } from "@/app/lib/rbac";

export const dynamic = "force-dynamic";

const CRM_STATUSES = new Set(["new", "vip"]);
const CLIENT_TYPES = new Set(["individual", "business"]);
const CRM_STATUS_SQL = "CASE WHEN u.status = 'active' AND u.access_expires_at IS NULL THEN 'vip' ELSE 'new' END";
const SORT_COLUMNS = {
  name: "u.display_name",
  date: "u.created_at",
  status: "crm_status",
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
    if (url.searchParams.get("export") === "1") {
      await requirePermission(actor, "clients:export");
    }
    const sortKey = url.searchParams.get("sort") as keyof typeof SORT_COLUMNS | null;
    const sortColumn = sortKey && SORT_COLUMNS[sortKey] ? SORT_COLUMNS[sortKey] : SORT_COLUMNS.date;
    const sortDirection = url.searchParams.get("order") === "asc" ? "ASC" : "DESC";
    const canViewAll = actor.isOwner || await hasPermission(actor, "clients:view_all");

    const conditions = ["(u.role = 'client' OR EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role = 'client'))", "u.deleted_at IS NULL"];
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
      conditions.push(`${CRM_STATUS_SQL} = ?`);
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
    const [count, summary, sellerSummary] = await Promise.all([
      database.prepare(
        `SELECT COUNT(*) AS total
         FROM users u
         LEFT JOIN payment_directory d ON d.user_id = u.id
         LEFT JOIN client_crm_profiles p ON p.user_id = u.id
         ${where}`,
      ).bind(...values).first<{ total: number }>(),
      database.prepare(
        `SELECT
           COUNT(*) AS total_clients,
           SUM(CASE WHEN ${CRM_STATUS_SQL} = 'new' THEN 1 ELSE 0 END) AS new_clients,
           SUM(CASE WHEN ${CRM_STATUS_SQL} = 'vip' THEN 1 ELSE 0 END) AS vip_clients,
           SUM(COALESCE(activity_totals.total_sales_cents, 0)) AS total_sales_cents,
           SUM(COALESCE(activity_totals.total_payments_cents, 0)) AS total_payments_cents
         FROM users u
         LEFT JOIN payment_directory d ON d.user_id = u.id
         LEFT JOIN client_crm_profiles p ON p.user_id = u.id
         LEFT JOIN (
           SELECT
             user_id,
             COALESCE(SUM(CASE WHEN activity_type = 'purchase' THEN amount_cents ELSE 0 END), 0) AS total_sales_cents,
             COALESCE(SUM(CASE WHEN activity_type = 'payment' THEN amount_cents ELSE 0 END), 0) AS total_payments_cents
           FROM client_crm_activities
           GROUP BY user_id
         ) activity_totals ON activity_totals.user_id = u.id
         ${where}`,
      ).bind(...values).first<{
        total_clients: number;
        new_clients: number;
        vip_clients: number;
        total_sales_cents: number;
        total_payments_cents: number;
      }>(),
      database.prepare(
        `SELECT
           s.id AS seller_id,
           s.display_name AS seller_name,
           s.seller_code,
           COUNT(u.id) AS client_count,
           COALESCE(SUM(COALESCE(a.total_sales_cents, 0)), 0) AS total_sales_cents,
           COALESCE(SUM(COALESCE(a.total_payments_cents, 0)), 0) AS total_payments_cents,
           COALESCE(SUM(COALESCE(a.sales_count, 0)), 0) AS sales_count,
           COALESCE(SUM(COALESCE(a.payment_count, 0)), 0) AS payment_count
         FROM users u
         LEFT JOIN payment_directory d ON d.user_id = u.id
         LEFT JOIN client_crm_profiles p ON p.user_id = u.id
         LEFT JOIN users s ON s.id = u.owner_id AND (s.role = 'seller' OR EXISTS (
           SELECT 1 FROM user_roles sr WHERE sr.user_id = s.id AND sr.role = 'seller'
         )) AND s.deleted_at IS NULL
         LEFT JOIN (
           SELECT
             user_id,
             COALESCE(SUM(CASE WHEN activity_type = 'purchase' THEN amount_cents ELSE 0 END), 0) AS total_sales_cents,
             COALESCE(SUM(CASE WHEN activity_type = 'payment' THEN amount_cents ELSE 0 END), 0) AS total_payments_cents,
             SUM(CASE WHEN activity_type = 'purchase' THEN 1 ELSE 0 END) AS sales_count,
             SUM(CASE WHEN activity_type = 'payment' THEN 1 ELSE 0 END) AS payment_count
           FROM client_crm_activities
           GROUP BY user_id
         ) a ON a.user_id = u.id
         ${where}
           AND s.id IS NOT NULL
         GROUP BY s.id, s.display_name, s.seller_code
         ORDER BY total_sales_cents DESC, s.display_name ASC`,
      ).bind(...values).all<{
        seller_id: string;
        seller_name: string;
        seller_code: string;
        client_count: number;
        total_sales_cents: number;
        total_payments_cents: number;
        sales_count: number;
        payment_count: number;
      }>(),
    ]);

    const result = await database.prepare(
      `SELECT u.id, u.seller_code, u.username, u.display_name, u.email, u.status,
              u.owner_id, u.created_at, u.activated_at, u.device_id, u.referral_code,
              u.access_expires_at, d.phone_e164,
              ${CRM_STATUS_SQL} AS crm_status,
              COALESCE(p.client_type, 'individual') AS client_type,
              COALESCE(p.category, 'general') AS category,
              COALESCE(p.tags_json, '[]') AS tags_json,
              COALESCE(p.notes, '') AS notes,
              p.last_activity_at,
              (
                SELECT r.id
                FROM password_reset_requests r
                WHERE r.user_id = u.id AND r.status = 'pending'
                ORDER BY r.created_at DESC
                LIMIT 1
              ) AS password_reset_request_id,
              (
                SELECT r.created_at
                FROM password_reset_requests r
                WHERE r.user_id = u.id AND r.status = 'pending'
                ORDER BY r.created_at DESC
                LIMIT 1
              ) AS password_reset_requested_at,
              s.display_name AS seller_name,
              COALESCE(a.total_sales_cents, 0) AS total_sales_cents,
              COALESCE(a.activity_count, 0) AS activity_count
       FROM users u
       LEFT JOIN payment_directory d ON d.user_id = u.id
       LEFT JOIN client_crm_profiles p ON p.user_id = u.id
       LEFT JOIN users s ON s.id = u.owner_id AND (s.role = 'seller' OR EXISTS (
         SELECT 1 FROM user_roles sr WHERE sr.user_id = s.id AND sr.role = 'seller'
       )) AND s.deleted_at IS NULL
       LEFT JOIN (
         SELECT
           user_id,
           COALESCE(SUM(CASE WHEN activity_type = 'purchase' THEN amount_cents ELSE 0 END), 0) AS total_sales_cents,
           COUNT(id) AS activity_count
         FROM client_crm_activities
         GROUP BY user_id
       ) a ON a.user_id = u.id
       ${where}
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
      summary: {
        totalClients: Number(summary?.total_clients ?? 0),
        newClients: Number(summary?.new_clients ?? 0),
        vipClients: Number(summary?.vip_clients ?? 0),
        totalSalesCents: Number(summary?.total_sales_cents ?? 0),
        totalPaymentsCents: Number(summary?.total_payments_cents ?? 0),
      },
      sellerSummaries: (sellerSummary.results ?? []).map((seller) => ({
        id: seller.seller_id,
        name: seller.seller_name,
        code: seller.seller_code,
        clientCount: Number(seller.client_count ?? 0),
        totalSalesCents: Number(seller.total_sales_cents ?? 0),
        totalPaymentsCents: Number(seller.total_payments_cents ?? 0),
        salesCount: Number(seller.sales_count ?? 0),
        paymentCount: Number(seller.payment_count ?? 0),
      })),
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
    await enforceAuthRateLimits([
      {
        bucket: "crm-create-user",
        subject: actor.id,
        limit: 40,
        windowSeconds: 60 * 60,
      },
      {
        bucket: "crm-create-ip",
        subject: await requestIpRateLimitSubject(request),
        limit: 80,
        windowSeconds: 60 * 60,
      },
    ]);
    const body = await readJson(request);
    const username = asString(body.username);
    // El nombre y el celular se completan desde los datos de la cuenta del cliente.
    // En el alta CRM usamos el usuario como nombre inicial y solo creamos el
    // registro de pago cuando se recibe un celular explícito.
    const displayName = asString(body.displayName).trim() || username.trim();
    const telegramUserId = asString(body.telegramUserId).trim();
    const rawPhone = asString(body.phone).trim();
    const phone = rawPhone ? normalizePeruvianMobile(rawPhone) : "";
    const crmStatus = asString(body.crmStatus) || "new";
    const clientType = CLIENT_TYPES.has(asString(body.clientType)) ? asString(body.clientType) : "individual";
    const category = asString(body.category).trim().slice(0, 40) || "general";
    const tags = cleanTags(body.tags);
    let saleAmountCents = 0;

    if (!/^\d{4,24}$/u.test(telegramUserId) || !validateUsername(username) || !validateDisplayName(displayName)) {
      return jsonError("Completa un Telegram ID y usuario válidos.");
    }
    if (rawPhone && !phone) return jsonError("El celular peruano no es válido.");
    if (!CRM_STATUSES.has(crmStatus)) {
      return jsonError("El estado CRM debe ser Nuevo o VIP.");
    }
    if (actor.role === "seller" && crmStatus === "vip") {
      return jsonError("Para otorgar acceso VIP, genera una key permanente usando un crédito.", 403);
    }
    if (crmStatus === "vip") {
      saleAmountCents = Math.round(Number(body.saleAmount) * 100);
      if (!Number.isSafeInteger(saleAmountCents) || saleAmountCents <= 0 || saleAmountCents > 100_000_000_00) {
        return jsonError("Ingresa un monto de venta mayor a S/ 0.");
      }
    }

    const existingTelegram = await dbBinding().prepare(
      "SELECT id FROM users WHERE telegram_user_id = ? AND deleted_at IS NULL LIMIT 1",
    ).bind(telegramUserId).first<{ id: string }>();
    if (existingTelegram) return jsonError("Ese Telegram ID ya está vinculado a una cuenta.", 409);

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

    const grantsPermanentAccess = crmStatus === "vip";
    const id = await createUser({
      sellerCode,
      username,
      displayName,
      email: "",
      password: generateTemporaryPassword(),
      phone,
      telegramUserId,
      role: "client",
      ownerId,
      status: grantsPermanentAccess ? "active" : "pending",
      accessExpiresAt: grantsPermanentAccess ? null : undefined,
      mustChangePassword: true,
    });
    const now = new Date().toISOString();
    const statements = [
      dbBinding().prepare(
        `INSERT INTO client_crm_profiles
           (user_id, crm_status, client_type, category, tags_json, notes, last_activity_at, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, '', ?, ?, ?)`,
      ).bind(id, crmStatus, clientType, category, JSON.stringify(tags), now, actor.id, now),
      dbBinding().prepare(
        `INSERT INTO manager_audit_log (id, telegram_user_id, command, outcome, created_at)
         VALUES (?, ?, 'crm_client_create', ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        actor.telegramUserId ?? actor.id,
        `${id}:${ownerId ?? "unassigned"}:${saleAmountCents}`,
        now,
      ),
    ];
    if (saleAmountCents > 0) {
      statements.splice(1, 0, dbBinding().prepare(
        `INSERT INTO client_crm_activities
           (id, user_id, activity_type, title, description, amount_cents, created_by, created_at)
         VALUES (?, ?, 'purchase', 'Venta inicial', 'Venta registrada al crear el cliente.', ?, ?, ?)`,
      ).bind(crypto.randomUUID(), id, saleAmountCents, actor.id, now));
    }
    await dbBinding().batch(statements);
    const invitation = await createInvitation(id);
    const activationUrl = new URL(invitation.activationPath, publicAppBaseUrl(request)).toString();

    return jsonOk({
      client: {
        id,
        username: username.toLowerCase(),
        displayName,
        phone,
        status: grantsPermanentAccess ? "active" : "pending",
        ownerId,
        crmStatus,
        saleAmountCents,
      },
      invitation: { activationUrl, expiresAt: invitation.expiresAt },
      message: grantsPermanentAccess
        ? "Cliente VIP creado con acceso permanente. No tiene acceso al panel administrativo."
        : ownerId
          ? "Cliente Nuevo creado. Actívalo para iniciar sus 3 días de prueba."
          : "Cliente Nuevo creado sin vendedor asignado. Actívalo para iniciar sus 3 días de prueba.",
    }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return routeError(error);
  }
}
