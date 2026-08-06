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
import { canManageSeller, requireManagedAccount } from "@/app/lib/management-server";
import { requirePermission } from "@/app/lib/rbac";
import { activateClientTrial } from "@/app/lib/trial-activation";
import { buildFullUserDeletionStatements } from "@/app/lib/admin-user-cleanup";
import { writeSecurityEvent } from "@/app/lib/security-log";

export const dynamic = "force-dynamic";

type EditableUser = {
  id: string;
  display_name: string;
  email: string;
  role: "admin" | "seller" | "client";
  is_owner: number;
  status: "pending" | "active" | "disabled";
  owner_id: string | null;
  seller_code: string;
  access_expires_at: string | null;
  activated_at: string | null;
};

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user: actor } = await requireUnlockedSession(request, ["admin"]);
    await enforceAuthRateLimits([
      { bucket: "admin-user-patch", subject: actor.id, limit: 60, windowSeconds: 15 * 60 },
    ]);
    const { id } = await context.params;
    await requireManagedAccount(actor, id);
    const body = await readJson(request);
    const database = dbBinding();
    const current = await database.prepare(
      `SELECT id, display_name, email, role, is_owner, status, owner_id, seller_code,
              access_expires_at, activated_at
       FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    ).bind(id).first<EditableUser>();
    if (!current) return jsonError("Usuario no encontrado.", 404);
    if (current.is_owner) return jsonError("La cuenta Owner no puede modificarse desde esta acción.", 403);

    await requirePermission(
      actor,
      current.role === "admin" ? "admins:update" : current.role === "seller" ? "sellers:update" : "clients:update",
    );

    const displayName = Object.prototype.hasOwnProperty.call(body, "displayName")
      ? asString(body.displayName).trim()
      : current.display_name;
    const email = Object.prototype.hasOwnProperty.call(body, "email")
      ? asString(body.email).trim().toLowerCase()
      : current.email;
    const requestedStatus = Object.prototype.hasOwnProperty.call(body, "status")
      ? asString(body.status)
      : current.status;
    if (!validateDisplayName(displayName)) return jsonError("Ingresa un nombre válido.");
    if (!validateOptionalEmail(email)) return jsonError("Ingresa un correo válido.");
    if (!/^(pending|active|disabled)$/u.test(requestedStatus)) return jsonError("Estado inválido.");

    if (
      current.role === "client"
      && Object.prototype.hasOwnProperty.call(body, "status")
      && requestedStatus === "disabled"
      && current.status !== "disabled"
    ) {
      await requirePermission(actor, "clients:suspend");
    }

    let ownerId = current.owner_id;
    let sellerCode = current.seller_code;

    if (current.role === "client" && Object.prototype.hasOwnProperty.call(body, "sellerId")) {
      const sellerId = asString(body.sellerId).trim();
      if (!sellerId) {
        ownerId = actor.isOwner ? null : actor.id;
        sellerCode = SELF_REGISTRATION_SELLER_CODE;
      } else {
        if (!(await canManageSeller(actor, sellerId))) return jsonError("Vendedor activo no encontrado.", 404);
        const seller = await database.prepare(
          "SELECT id, seller_code FROM users WHERE id = ? AND role = 'seller' AND status = 'active' AND deleted_at IS NULL LIMIT 1",
        ).bind(sellerId).first<{ id: string; seller_code: string }>();
        if (!seller) return jsonError("Vendedor activo no encontrado.", 404);
        ownerId = seller.id;
        sellerCode = seller.seller_code;
      }
    }

    if (current.role === "seller" && Object.prototype.hasOwnProperty.call(body, "managerId")) {
      if (!actor.isOwner) return jsonError("Solo el Owner puede reasignar vendedores.", 403);
      const managerId = asString(body.managerId).trim();
      if (!managerId) {
        ownerId = actor.id;
      } else {
        const manager = await database.prepare(
          `SELECT id FROM users
           WHERE id = ? AND role = 'admin' AND is_owner = 0 AND status = 'active' AND deleted_at IS NULL LIMIT 1`,
        ).bind(managerId).first<{ id: string }>();
        if (!manager) return jsonError("Administrador activo no encontrado.", 404);
        ownerId = manager.id;
      }
    }

    const now = new Date().toISOString();
    let accessExpiresAt = current.access_expires_at;
    let activatedAt = current.activated_at;
    const requestedPermanent =
      body.accessMode === "permanent"
      || body.vip === true
      || asString(body.crmStatus) === "vip";
    // Solo Owner puede otorgar acceso permanente/VIP (alineado con CRM).
    // Admins no-Owner: se ignoran esos campos para no elevar privilegios.
    const intentionalPermanent = requestedPermanent && actor.isOwner;
    if (requestedPermanent && !actor.isOwner) {
      writeSecurityEvent(request, "admin.user_permanent_denied", "denied", {
        actorId: actor.id,
        targetId: current.id,
      });
    }

    // ADMIN-001: activar cliente sin expiry no debe quedar permanente por accidente.
    if (
      current.role === "client"
      && requestedStatus === "active"
      && current.status !== "active"
      && !intentionalPermanent
    ) {
      if (current.status === "pending" && !accessExpiresAt) {
        const trial = await activateClientTrial({
          userId: current.id,
          sellerId: ownerId ?? actor.id,
          updatedBy: actor.id,
        });
        if (trial.ok && trial.activated) {
          accessExpiresAt = trial.accessExpiresAt;
          activatedAt = trial.activatedAt;
        } else if (trial.ok && !trial.activated) {
          accessExpiresAt = trial.accessExpiresAt;
          activatedAt = trial.activatedAt;
        } else if (!accessExpiresAt) {
          accessExpiresAt = trialExpiresAt();
          activatedAt ??= now;
        }
      } else if (!accessExpiresAt) {
        const existingActivation = await database.prepare(
          "SELECT id FROM activations WHERE user_id = ? LIMIT 1",
        ).bind(current.id).first();
        accessExpiresAt = trialExpiresAt();
        activatedAt ??= now;
        if (!existingActivation) {
          await database.prepare(
            `INSERT INTO activations (id, user_id, seller_id, credits_charged, created_at)
             VALUES (?, ?, ?, 0, ?)`,
          ).bind(crypto.randomUUID(), current.id, ownerId ?? actor.id, now).run();
        }
      }
    }

    if (intentionalPermanent && current.role === "client" && requestedStatus === "active") {
      accessExpiresAt = null;
      activatedAt ??= now;
    }

    await database.batch([
      database.prepare(
        `UPDATE users SET display_name = ?, email = ?, status = ?, owner_id = ?, seller_code = ?,
             access_expires_at = ?, activated_at = ?, updated_at = ?
         WHERE id = ? AND is_owner = 0 AND deleted_at IS NULL`,
      ).bind(
        displayName,
        email,
        requestedStatus,
        ownerId,
        sellerCode,
        accessExpiresAt,
        activatedAt,
        now,
        current.id,
      ),
      database.prepare(
        `INSERT INTO manager_audit_log (id, telegram_user_id, command, outcome, created_at)
         VALUES (?, ?, 'web_update_user', ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        actor.telegramUserId ?? actor.id,
        `${current.id}:${current.role}:${requestedStatus}:${accessExpiresAt ?? "permanent"}`,
        now,
      ),
    ]);

    if (requestedStatus === "disabled" && current.status !== "disabled") {
      await revokeUserSessions(current.id);
      const revokedAt = new Date().toISOString();
      await database.batch([
        database.prepare(
          `UPDATE global_recipient_directory
           SET status = 'revoked', revoked_at = ?, revoked_reason = 'Cuenta suspendida', updated_at = ?
           WHERE submitted_by_user_id = ? AND status = 'active'`,
        ).bind(revokedAt, revokedAt, current.id),
        database.prepare(
          `UPDATE global_qr_directory
           SET status = 'revoked', revoked_at = ?, revoked_reason = 'Cuenta suspendida', updated_at = ?
           WHERE submitted_by_user_id = ? AND status = 'active'`,
        ).bind(revokedAt, revokedAt, current.id),
      ]);
    }

    return jsonOk({
      user: {
        id: current.id,
        displayName,
        email,
        role: current.role,
        status: requestedStatus,
        ownerId,
        sellerCode,
        accessExpiresAt,
      },
      message: "Datos del usuario actualizados.",
    });
  } catch (error) {
    return routeError(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user: actor } = await requireUnlockedSession(request, ["admin", "seller"]);
    await enforceAuthRateLimits([
      { bucket: "admin-user-delete", subject: actor.id, limit: 30, windowSeconds: 15 * 60 },
    ]);
    const { id } = await context.params;
    if (id === actor.id) return jsonError("No puedes eliminar tu propia cuenta.", 409);
    const target = await requireManagedAccount(actor, id);
    if (target.is_owner) return jsonError("La cuenta Owner no puede eliminarse.", 403);
    if (target.role !== "client" && target.roles?.includes("client")) {
      return jsonError("Esta cuenta también tiene acceso a la app. Retira primero el rol del panel para conservarla.", 409);
    }
    if (actor.role === "seller" && target.role !== "client") {
      return jsonError("Solo puedes eliminar clientes de tu cartera.", 403);
    }
    await requirePermission(
      actor,
      target.role === "admin" ? "admins:delete" : target.role === "seller" ? "sellers:delete" : "clients:delete",
    );
    const database = dbBinding();
    const dependents = await database.prepare(
      "SELECT COUNT(*) AS total FROM users WHERE owner_id = ? AND deleted_at IS NULL",
    ).bind(id).first<{ total: number }>();
    if (Number(dependents?.total ?? 0) > 0) {
      return jsonError("Primero reasigna o elimina las cuentas que dependen de este usuario.", 409);
    }

    const now = new Date().toISOString();
    await database.batch(buildFullUserDeletionStatements(
      database,
      id,
      actor.id,
      actor.telegramUserId,
      target.role,
      now,
    ));
    return jsonOk({
      message: "Usuario eliminado. Su Telegram ID y dispositivo quedan libres para un nuevo registro.",
    });
  } catch (error) {
    return routeError(error);
  }
}
