import { asString, jsonError, jsonOk, readJson } from "@/app/lib/api-utils";
import {
  dbBinding,
  enforceAuthRateLimits,
  requireUnlockedSession,
  routeError,
} from "@/app/lib/auth-server";
import { findManagedAccount } from "@/app/lib/management-server";
import { buildDisableUserStatements, buildFullUserDeletionStatements } from "@/app/lib/admin-user-cleanup";

export const dynamic = "force-dynamic";

type DataCategory = {
  key: string;
  label: string;
  description: string;
  count: number;
};

const categoryDefinitions = [
  { key: "sessions", label: "Sesiones activas", description: "Sesiones y accesos recordados de esta cuenta.", sql: "SELECT COUNT(*) AS total FROM sessions WHERE user_id = ?" },
  { key: "payment_directory", label: "Número para recibir pagos", description: "Número publicado por la cuenta para recibir pagos.", sql: "SELECT COUNT(*) AS total FROM payment_directory WHERE user_id = ?" },
  { key: "saved_payment_recipients", label: "Destinatarios guardados", description: "Números y nombres guardados en su agenda de pagos.", sql: "SELECT COUNT(*) AS total FROM saved_payment_recipients WHERE user_id = ?" },
  { key: "account_payment_profiles", label: "Datos de recepción y QR", description: "Número o QR guardado en el perfil de recepción.", sql: "SELECT COUNT(*) AS total FROM account_payment_profiles WHERE user_id = ?" },
  { key: "qr_contacts", label: "Contactos QR", description: "Destinatarios QR guardados por la cuenta.", sql: "SELECT COUNT(*) AS total FROM qr_contacts WHERE user_id = ?" },
  { key: "global_recipient_directory", label: "Publicaciones globales de celular", description: "Números que publicó en el directorio global.", sql: "SELECT COUNT(*) AS total FROM global_recipient_directory WHERE submitted_by_user_id = ?" },
  { key: "global_qr_directory", label: "Publicaciones globales de QR", description: "QR que publicó en el directorio global.", sql: "SELECT COUNT(*) AS total FROM global_qr_directory WHERE submitted_by_user_id = ?" },
  { key: "account_movements", label: "Movimientos relacionados", description: "Movimientos creados por la cuenta o que apuntan a ella.", sql: "SELECT (SELECT COUNT(*) FROM account_movements WHERE user_id = ?) + (SELECT COUNT(*) FROM account_movements WHERE recipient_user_id = ?) AS total" },
  { key: "account_balances", label: "Saldo configurado", description: "Configuración del saldo de la cuenta.", sql: "SELECT COUNT(*) AS total FROM account_balances WHERE user_id = ?" },
  { key: "account_history_state", label: "Estado del historial", description: "Preferencias de limpieza del historial.", sql: "SELECT COUNT(*) AS total FROM account_history_state WHERE user_id = ?" },
  { key: "account_feature_entitlements", label: "Permisos de funciones", description: "Habilitaciones de funciones de la cuenta.", sql: "SELECT COUNT(*) AS total FROM account_feature_entitlements WHERE user_id = ?" },
  { key: "autocomplete_key_claims", label: "Claves de autocompletado", description: "Claves de autocompletado reclamadas por la cuenta.", sql: "SELECT COUNT(*) AS total FROM autocomplete_key_claims WHERE user_id = ?" },
  { key: "activations", label: "Activaciones de acceso", description: "Registros de activación de la cuenta.", sql: "SELECT COUNT(*) AS total FROM activations WHERE user_id = ?" },
  { key: "permanent_access_tokens", label: "Claves permanentes asignadas", description: "Claves permanentes vinculadas a la cuenta.", sql: "SELECT COUNT(*) AS total FROM permanent_access_tokens WHERE user_id = ?" },
  { key: "global_permanent_access_tokens", label: "Canjes globales", description: "Canjes de claves globales realizados por la cuenta.", sql: "SELECT COUNT(*) AS total FROM global_permanent_access_tokens WHERE redeemed_by_user_id = ?" },
  { key: "password_reset", label: "Restablecimientos de contraseña", description: "Solicitudes y tokens de recuperación de esta cuenta.", sql: "SELECT (SELECT COUNT(*) FROM password_reset_requests WHERE user_id = ?) + (SELECT COUNT(*) FROM password_reset_tokens WHERE user_id = ?) AS total" },
  { key: "account_invitations", label: "Invitaciones", description: "Invitaciones de registro asociadas a la cuenta.", sql: "SELECT COUNT(*) AS total FROM account_invitations WHERE user_id = ?" },
  { key: "recipient_lookup_attempts", label: "Consultas de destinatarios", description: "Historial técnico de consultas hechas por la cuenta.", sql: "SELECT COUNT(*) AS total FROM recipient_lookup_attempts WHERE requester_user_id = ?" },
  { key: "credit_ledger", label: "Movimientos de créditos", description: "Registro de créditos asignados a esta cuenta.", sql: "SELECT COUNT(*) AS total FROM credit_ledger WHERE seller_id = ? OR created_by = ?" },
  { key: "referral_redemptions", label: "Canjes de referidos", description: "Canjes de referidos hechos o generados por la cuenta.", sql: "SELECT COUNT(*) AS total FROM referral_redemptions WHERE referrer_user_id = ? OR redeemed_by_user_id = ?" },
  { key: "rbac_permission_overrides", label: "Permisos personalizados", description: "Ajustes de permisos específicos de esta cuenta.", sql: "SELECT COUNT(*) AS total FROM rbac_permission_overrides WHERE user_id = ?" },
  { key: "client_crm_profile", label: "Perfil CRM", description: "Segmentación, etiquetas y notas del CRM.", sql: "SELECT COUNT(*) AS total FROM client_crm_profiles WHERE user_id = ?" },
  { key: "client_crm_activities", label: "Actividades CRM", description: "Actividades registradas para esta cuenta.", sql: "SELECT COUNT(*) AS total FROM client_crm_activities WHERE user_id = ?" },
  { key: "webauthn", label: "Credenciales de acceso rápido", description: "Credenciales passkey registradas para la cuenta.", sql: "SELECT (SELECT COUNT(*) FROM webauthn_credentials WHERE user_id = ?) + (SELECT COUNT(*) FROM webauthn_challenges WHERE user_id = ?) AS total" },
  { key: "telegram_data", label: "Vinculación de Telegram", description: "Vinculación y desafíos de Telegram de esta cuenta.", sql: "SELECT (SELECT COUNT(*) FROM telegram_identities WHERE user_id = ?) + (SELECT COUNT(*) FROM telegram_registration_challenges c WHERE c.telegram_user_id = (SELECT telegram_user_id FROM users WHERE id = ? LIMIT 1)) AS total" },
] as const;

const deleteStatements: Record<string, (database: D1Database, userId: string) => D1PreparedStatement[]> = {
  sessions: (db, id) => [db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id)],
  payment_directory: (db, id) => [db.prepare("DELETE FROM payment_directory WHERE user_id = ?").bind(id)],
  saved_payment_recipients: (db, id) => [db.prepare("DELETE FROM saved_payment_recipients WHERE user_id = ?").bind(id)],
  account_payment_profiles: (db, id) => [db.prepare("DELETE FROM account_payment_profiles WHERE user_id = ?").bind(id)],
  qr_contacts: (db, id) => [
    db.prepare("DELETE FROM qr_contacts WHERE user_id = ?").bind(id),
    db.prepare("UPDATE qr_contacts SET recipient_user_id = NULL WHERE recipient_user_id = ?").bind(id),
  ],
  global_recipient_directory: (db, id) => [db.prepare("DELETE FROM global_recipient_directory WHERE submitted_by_user_id = ?").bind(id)],
  global_qr_directory: (db, id) => [db.prepare("DELETE FROM global_qr_directory WHERE submitted_by_user_id = ?").bind(id)],
  account_movements: (db, id) => [
    db.prepare("DELETE FROM account_movements WHERE user_id = ?").bind(id),
    db.prepare("UPDATE account_movements SET recipient_name = 'Usuario eliminado', recipient_reference = 'Cuenta eliminada', recipient_user_id = NULL WHERE recipient_user_id = ?").bind(id),
  ],
  account_balances: (db, id) => [db.prepare("DELETE FROM account_balances WHERE user_id = ?").bind(id)],
  account_history_state: (db, id) => [db.prepare("DELETE FROM account_history_state WHERE user_id = ?").bind(id)],
  account_feature_entitlements: (db, id) => [db.prepare("DELETE FROM account_feature_entitlements WHERE user_id = ?").bind(id)],
  autocomplete_key_claims: (db, id) => [db.prepare("DELETE FROM autocomplete_key_claims WHERE user_id = ?").bind(id)],
  activations: (db, id) => [db.prepare("DELETE FROM activations WHERE user_id = ?").bind(id)],
  permanent_access_tokens: (db, id) => [db.prepare("DELETE FROM permanent_access_tokens WHERE user_id = ?").bind(id)],
  global_permanent_access_tokens: (db, id) => [db.prepare("DELETE FROM global_permanent_access_tokens WHERE redeemed_by_user_id = ?").bind(id)],
  password_reset: (db, id) => [
    db.prepare("DELETE FROM password_reset_requests WHERE user_id = ?").bind(id),
    db.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").bind(id),
  ],
  account_invitations: (db, id) => [db.prepare("DELETE FROM account_invitations WHERE user_id = ?").bind(id)],
  recipient_lookup_attempts: (db, id) => [db.prepare("DELETE FROM recipient_lookup_attempts WHERE requester_user_id = ?").bind(id)],
  credit_ledger: (db, id) => [db.prepare("DELETE FROM credit_ledger WHERE seller_id = ? OR created_by = ?").bind(id, id)],
  referral_redemptions: (db, id) => [
    db.prepare("DELETE FROM referral_redemptions WHERE referrer_user_id = ? OR redeemed_by_user_id = ?").bind(id, id),
  ],
  rbac_permission_overrides: (db, id) => [db.prepare("DELETE FROM rbac_permission_overrides WHERE user_id = ?").bind(id)],
  client_crm_profile: (db, id) => [db.prepare("DELETE FROM client_crm_profiles WHERE user_id = ?").bind(id)],
  client_crm_activities: (db, id) => [db.prepare("DELETE FROM client_crm_activities WHERE user_id = ?").bind(id)],
  webauthn: (db, id) => [
    db.prepare("DELETE FROM webauthn_credentials WHERE user_id = ?").bind(id),
    db.prepare("DELETE FROM webauthn_challenges WHERE user_id = ?").bind(id),
  ],
  telegram_data: (db, id) => [
    db.prepare("DELETE FROM telegram_identities WHERE user_id = ?").bind(id),
    db.prepare("DELETE FROM telegram_registration_challenges WHERE telegram_user_id = (SELECT telegram_user_id FROM users WHERE id = ? LIMIT 1)").bind(id),
  ],
};

async function requireOwnerClient(request: Request, id: string) {
  const { user: actor } = await requireUnlockedSession(request, ["admin"]);
  if (!actor.isOwner) throw Response.json(
    { ok: false, error: "Solo el Owner puede consultar o eliminar datos de la base de datos." },
    { status: 403, headers: { "cache-control": "no-store" } },
  );
  const target = await findManagedAccount(id);
  if (!target || target.is_owner || (target.role !== "client" && !target.roles?.includes("client"))) {
    throw Response.json(
      { ok: false, error: "Cliente no encontrado." },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }
  await enforceAuthRateLimits([{ bucket: "owner-database", subject: actor.id, limit: 120, windowSeconds: 60 * 60 }]);
  return { actor, target };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    await requireOwnerClient(request, id);
    const database = dbBinding();
    const categories: DataCategory[] = [];
    for (const definition of categoryDefinitions) {
      const args = definition.sql.includes("OR") || definition.sql.includes("+ (SELECT") ? [id, id] : [id];
      const row = await database.prepare(definition.sql).bind(...args).first<{ total: number | string }>();
      categories.push({
        key: definition.key,
        label: definition.label,
        description: definition.description,
        count: Number(row?.total ?? 0),
      });
    }
    const target = await database.prepare(
      "SELECT id, display_name, username, role, status, created_at, telegram_user_id FROM users WHERE id = ? LIMIT 1",
    ).bind(id).first<{ id: string; display_name: string; username: string; role: string; status: string; created_at: string; telegram_user_id: string | null }>();
    return jsonOk({
      user: target ? {
        id: target.id,
        displayName: target.display_name,
        username: target.username,
        role: target.role,
        status: target.status,
        createdAt: target.created_at,
        hasTelegram: Boolean(target.telegram_user_id),
      } : null,
      categories,
      sensitiveDataOmitted: true,
    });
  } catch (error) {
    return routeError(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { actor, target } = await requireOwnerClient(request, id);
    const body = await readJson(request);
    const action = body && typeof body === "object" && !Array.isArray(body)
      ? (body as { action?: unknown }).action
      : undefined;
    const categoryInput = body && typeof body === "object" && !Array.isArray(body)
      ? (body as { categories?: unknown }).categories
      : undefined;
    const requested = Array.isArray(categoryInput)
      ? [...new Set(categoryInput.map((value) => asString(value).trim()))]
      : [];
    if (!requested.length && action === undefined) return jsonError("Selecciona al menos un grupo de datos.", 400);
    const unknown = requested.filter((key) => !deleteStatements[key]);
    if (unknown.length) return jsonError("El grupo de datos seleccionado no es válido.", 400);

    if (action !== undefined && action !== "disable" && action !== "delete") {
      return jsonError("La acciÃ³n solicitada no es vÃ¡lida.", 400);
    }

    const database = dbBinding();
    const now = new Date().toISOString();
    if (action === "delete") {
      await database.batch(buildFullUserDeletionStatements(
        database,
        id,
        actor.id,
        actor.telegramUserId,
        target.role,
        now,
      ));
      return jsonOk({ message: "Cuenta y datos eliminados de forma atÃ³mica.", deletedCategories: requested, action });
    }

    const statements = requested.flatMap((key) => deleteStatements[key](database, id));
    if (action === "disable") {
      statements.push(...buildDisableUserStatements(database, id, actor.id, actor.telegramUserId, now));
    } else {
      statements.push(
        database.prepare(
          `INSERT INTO manager_audit_log (id, telegram_user_id, command, outcome, created_at)
           VALUES (?, ?, 'web_delete_user_data', ?, ?)`,
        ).bind(crypto.randomUUID(), actor.telegramUserId ?? actor.id, `${id}:${requested.join(",")}`, now),
      );
    }
    await database.batch(statements);
    return jsonOk({
      message: action === "disable" ? "Datos seleccionados eliminados y cuenta deshabilitada." : "Datos seleccionados eliminados.",
      deletedCategories: requested,
      action: action ?? "inspect",
    });
  } catch (error) {
    return routeError(error);
  }
}
