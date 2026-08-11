import { asString, jsonError, jsonOk, readJson } from "@/app/lib/api-utils";
import {
  dbBinding,
  enforceAuthRateLimits,
  requireUnlockedSession,
  revokeUserSessions,
  routeError,
  SELF_REGISTRATION_SELLER_CODE,
  trialExpiresAt,
  validateDisplayName,
  validateOptionalEmail,
} from "@/app/lib/auth-server";
import { requireClientAccess } from "@/app/lib/management-server";
import { hasPermission, requirePermission } from "@/app/lib/rbac";
import { cleanTags } from "@/app/lib/crm-utils";

export const dynamic = "force-dynamic";

const CRM_STATUSES = new Set(["new", "vip"]);
const CLIENT_TYPES = new Set(["individual", "business"]);
const CRM_STATUS_SQL = "CASE WHEN u.status = 'active' AND u.access_expires_at IS NULL THEN 'vip' ELSE 'new' END";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user: actor } = await requireUnlockedSession(request, ["seller", "admin"]);
    const { id } = await context.params;
    await requireClientAccess(actor, id, "clients:update");
    await enforceAuthRateLimits([
      {
        bucket: "crm-update-user",
        subject: actor.id,
        limit: 80,
        windowSeconds: 60 * 60,
      },
    ]);
    const body = await readJson(request);
    const database = dbBinding();
    const current = await database.prepare(
      `SELECT u.id, u.display_name, u.email, u.status, u.owner_id, u.seller_code,
              u.access_expires_at, u.activated_at,
              ${CRM_STATUS_SQL} AS crm_status,
              COALESCE(p.client_type, 'individual') AS client_type,
              COALESCE(p.category, 'general') AS category,
              COALESCE(p.tags_json, '[]') AS tags_json,
              COALESCE(p.notes, '') AS notes
       FROM users u
       LEFT JOIN client_crm_profiles p ON p.user_id = u.id
       WHERE u.id = ? AND (u.role = 'client' OR EXISTS (
         SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role = 'client'
       )) AND u.deleted_at IS NULL LIMIT 1`,
    ).bind(id).first<Record<string, unknown>>();
    if (!current) return jsonError("Cliente no encontrado.", 404);

    const displayName = Object.prototype.hasOwnProperty.call(body, "displayName")
      ? asString(body.displayName).trim()
      : String(current.display_name);
    const email = Object.prototype.hasOwnProperty.call(body, "email")
      ? asString(body.email).trim().toLowerCase()
      : String(current.email);
    const accountStatus = Object.prototype.hasOwnProperty.call(body, "accountStatus")
      ? asString(body.accountStatus)
      : String(current.status);
    const crmStatus = Object.prototype.hasOwnProperty.call(body, "crmStatus")
      ? asString(body.crmStatus)
      : String(current.crm_status);
    const clientType = Object.prototype.hasOwnProperty.call(body, "clientType")
      ? asString(body.clientType)
      : String(current.client_type);
    const category = Object.prototype.hasOwnProperty.call(body, "category")
      ? asString(body.category).trim().slice(0, 40) || "general"
      : String(current.category);
    const notes = Object.prototype.hasOwnProperty.call(body, "notes")
      ? asString(body.notes).trim().slice(0, 2000)
      : String(current.notes);
    let tags = cleanTags(body.tags);
    if (!Object.prototype.hasOwnProperty.call(body, "tags")) {
      try {
        tags = cleanTags(JSON.parse(String(current.tags_json)));
      } catch {
        tags = [];
      }
    }
    if (!validateDisplayName(displayName) || !validateOptionalEmail(email)) return jsonError("Nombre o correo inválido.");
    if (!/^(pending|active|disabled)$/u.test(accountStatus)) return jsonError("Estado de cuenta inválido.");
    if (!CRM_STATUSES.has(crmStatus)) return jsonError("Estado CRM inválido.");
    if (!CLIENT_TYPES.has(clientType)) return jsonError("Tipo de cliente inválido.");
    const crmStatusChanging =
      Object.prototype.hasOwnProperty.call(body, "crmStatus")
      && crmStatus !== String(current.crm_status);
    if (crmStatusChanging && !actor.isOwner) {
      return jsonError("Solo el Owner puede cambiar manualmente el tipo de acceso.", 403);
    }

    // AUTH-003: sellers no togglean status libremente; activación vía /activate; disabled vía clients:suspend.
    const statusChanging =
      Object.prototype.hasOwnProperty.call(body, "accountStatus")
      && accountStatus !== String(current.status);
    if (statusChanging) {
      if (actor.role === "seller") {
        return jsonError("Los vendedores no pueden cambiar el estado de cuenta.", 403);
      }
      if (accountStatus === "disabled") {
        await requirePermission(actor, "clients:suspend");
      }
    }

    let ownerId = current.owner_id ? String(current.owner_id) : null;
    let sellerCode = String(current.seller_code);
    if (Object.prototype.hasOwnProperty.call(body, "sellerId")) {
      await requirePermission(actor, "clients:assign");
      const sellerId = asString(body.sellerId).trim();
      if (!sellerId) {
        ownerId = null;
        sellerCode = SELF_REGISTRATION_SELLER_CODE;
      } else {
        const canAssignGlobally = actor.isOwner || await hasPermission(actor, "clients:view_all");
        const seller = await database.prepare(
          `SELECT id, seller_code FROM users
           WHERE id = ? AND role = 'seller' AND status = 'active' AND deleted_at IS NULL
             AND (? = 1 OR owner_id = ?)
           LIMIT 1`,
        ).bind(sellerId, canAssignGlobally ? 1 : 0, actor.id).first<{ id: string; seller_code: string }>();
        if (!seller) return jsonError("Vendedor activo no encontrado.", 404);
        ownerId = seller.id;
        sellerCode = seller.seller_code;
      }
    }

    const now = new Date().toISOString();
    const currentCrmStatus = String(current.crm_status);
    const becomesVip = crmStatus === "vip" && currentCrmStatus !== "vip";
    let resolvedAccountStatus = accountStatus;
    let accessExpiresAt = current.access_expires_at ? String(current.access_expires_at) : null;
    let activatedAt = current.activated_at ? String(current.activated_at) : null;
    let vipDowngradeTrialAudit = false;

    if (becomesVip) {
      resolvedAccountStatus = "active";
      accessExpiresAt = null;
      activatedAt ??= now;
    } else if (
      crmStatus === "new"
      && resolvedAccountStatus === "active"
      && (currentCrmStatus === "vip" || String(current.status) !== "active" || !accessExpiresAt)
    ) {
      // TRIAL-001: no reiniciar el reloj si ya existe activation (salvo VIP→new auditado por owner/admin).
      const existingActivation = await database.prepare(
        "SELECT id FROM activations WHERE user_id = ? LIMIT 1",
      ).bind(id).first<{ id: string }>();

      if (existingActivation) {
        if (currentCrmStatus === "vip") {
          if (actor.role !== "admin" && !actor.isOwner) {
            return jsonError("Solo un administrador puede degradar VIP a prueba con nuevo reloj.", 403);
          }
          accessExpiresAt = trialExpiresAt();
          activatedAt ??= now;
          vipDowngradeTrialAudit = true;
        } else if (String(current.status) === "active" && accessExpiresAt) {
          // Conservar expiry existente; no regenerar clock.
        } else if (!accessExpiresAt && String(current.status) === "active") {
          // Ya era permanente/new inconsistente con activation: no forzar trial aquí.
        } else {
          // Pendiente/disabled → active con activation previa: conservar fechas si hay; si no, no inventar reloj.
        }
      } else {
        accessExpiresAt = trialExpiresAt();
        activatedAt ??= now;
      }
    }

    await database.batch([
      database.prepare(
        `UPDATE users
         SET display_name = ?, email = ?, status = ?, owner_id = ?, seller_code = ?,
             access_expires_at = ?, activated_at = ?, updated_at = ?
         WHERE id = ? AND (role = 'client' OR EXISTS (
           SELECT 1 FROM user_roles ur WHERE ur.user_id = users.id AND ur.role = 'client'
         )) AND deleted_at IS NULL`,
      ).bind(
        displayName,
        email,
        resolvedAccountStatus,
        ownerId,
        sellerCode,
        accessExpiresAt,
        activatedAt,
        now,
        id,
      ),
      database.prepare(
        `INSERT INTO client_crm_profiles
           (user_id, crm_status, client_type, category, tags_json, notes, last_activity_at, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           crm_status = excluded.crm_status,
           client_type = excluded.client_type,
           category = excluded.category,
           tags_json = excluded.tags_json,
           notes = excluded.notes,
           updated_by = excluded.updated_by,
           updated_at = excluded.updated_at`,
      ).bind(id, crmStatus, clientType, category, JSON.stringify(tags), notes, now, actor.id, now),
      database.prepare(
        `INSERT INTO manager_audit_log (id, telegram_user_id, command, outcome, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        actor.telegramUserId ?? actor.id,
        vipDowngradeTrialAudit ? "crm_vip_downgrade_trial" : "crm_client_update",
        vipDowngradeTrialAudit
          ? `${id}:vip→new:${accessExpiresAt}`
          : `${id}:${crmStatus}:${ownerId ?? "unassigned"}`,
        now,
      ),
    ]);

    if (resolvedAccountStatus === "disabled" && String(current.status) !== "disabled") {
      await revokeUserSessions(id);
    }

    return jsonOk({
      message: becomesVip
        ? `${displayName} ahora es VIP y tiene acceso permanente.`
        : vipDowngradeTrialAudit
          ? `${displayName} ahora es Nuevo y tiene 30 días de prueba (reloj regenerado por admin).`
          : currentCrmStatus === "vip" && crmStatus === "new" && resolvedAccountStatus === "active"
            ? `${displayName} ahora es Nuevo.`
            : "Perfil del cliente actualizado.",
      client: {
        id,
        ownerId,
        crmStatus,
        accountStatus: resolvedAccountStatus,
        accessExpiresAt,
        tags,
      },
    });
  } catch (error) {
    return routeError(error);
  }
}
