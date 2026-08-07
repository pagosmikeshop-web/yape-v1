/**
 * Statements shared by the owner cleanup endpoint and the legacy delete route.
 * Keeping the full cleanup in one batch prevents the account from being
 * partially deleted when one of the statements fails.
 */
export function buildFullUserDeletionStatements(
  database: D1Database,
  id: string,
  actorId: string,
  actorTelegramUserId: string | null | undefined,
  targetRole: string,
  now: string,
  auditCommand: "web_delete_user" | "web_ban_user" = "web_delete_user",
) {
  return [
    database.prepare("DELETE FROM user_roles WHERE user_id = ?").bind(id),
    database.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id),
    database.prepare("DELETE FROM payment_directory WHERE user_id = ?").bind(id),
    database.prepare("DELETE FROM saved_payment_recipients WHERE user_id = ?").bind(id),
    database.prepare("DELETE FROM account_payment_profiles WHERE user_id = ?").bind(id),
    database.prepare("DELETE FROM global_recipient_directory WHERE submitted_by_user_id = ?").bind(id),
    database.prepare("DELETE FROM global_qr_directory WHERE submitted_by_user_id = ?").bind(id),
    database.prepare(
      `UPDATE global_qr_directory
       SET recipient_user_id = NULL, holder_name = 'Usuario eliminado', phone_e164 = NULL,
           status = 'revoked', revoked_at = ?, revoked_reason = 'Cuenta eliminada', updated_at = ?
       WHERE recipient_user_id = ?`,
    ).bind(now, now, id),
    database.prepare("DELETE FROM recipient_lookup_attempts WHERE requester_user_id = ?").bind(id),
    database.prepare("DELETE FROM account_movements WHERE user_id = ?").bind(id),
    database.prepare(
      `UPDATE account_movements
       SET recipient_name = 'Usuario eliminado', recipient_reference = 'Cuenta eliminada', recipient_user_id = NULL
       WHERE recipient_user_id = ?`,
    ).bind(id),
    database.prepare("DELETE FROM account_balances WHERE user_id = ?").bind(id),
    database.prepare("DELETE FROM account_history_state WHERE user_id = ?").bind(id),
    database.prepare("DELETE FROM account_feature_entitlements WHERE user_id = ?").bind(id),
    // These keys are owned by the account that created them. They do not have
    // ON DELETE CASCADE so they must be removed before the users row.
    database.prepare("DELETE FROM autocomplete_keys WHERE created_by = ?").bind(id),
    database.prepare("DELETE FROM autocomplete_key_claims WHERE user_id = ?").bind(id),
    database.prepare("DELETE FROM activations WHERE user_id = ? OR seller_id = ?").bind(id, id),
    database.prepare("DELETE FROM permanent_access_tokens WHERE user_id = ? OR seller_id = ? OR created_by = ?").bind(id, id, id),
    database.prepare("DELETE FROM global_permanent_access_tokens WHERE created_by = ? OR redeemed_by_user_id = ?").bind(id, id),
    database.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").bind(id),
    database.prepare("UPDATE password_reset_requests SET approved_by = NULL WHERE approved_by = ?").bind(id),
    database.prepare("DELETE FROM password_reset_requests WHERE user_id = ? OR seller_id = ?").bind(id, id),
    database.prepare("DELETE FROM account_invitations WHERE user_id = ?").bind(id),
    database.prepare("DELETE FROM telegram_identities WHERE user_id = ?").bind(id),
    database.prepare(
      "DELETE FROM telegram_registration_challenges WHERE telegram_user_id = (SELECT telegram_user_id FROM users WHERE id = ? LIMIT 1)",
    ).bind(id),
    database.prepare(
      "DELETE FROM telegram_group_members WHERE telegram_user_id = (SELECT telegram_user_id FROM users WHERE id = ? LIMIT 1)",
    ).bind(id),
    database.prepare("DELETE FROM referral_redemptions WHERE referrer_user_id = ?").bind(id),
    database.prepare("UPDATE referral_redemptions SET redeemed_by_user_id = NULL WHERE redeemed_by_user_id = ?").bind(id),
    database.prepare("DELETE FROM credit_ledger WHERE seller_id = ? OR created_by = ?").bind(id, id),
    database.prepare("UPDATE rbac_permission_overrides SET updated_by = ?, updated_at = ? WHERE updated_by = ? AND user_id <> ?").bind(actorId, now, id, id),
    database.prepare("DELETE FROM rbac_permission_overrides WHERE user_id = ?").bind(id),
    database.prepare("UPDATE client_crm_activities SET created_by = ? WHERE created_by = ? AND user_id <> ?").bind(actorId, id, id),
    database.prepare("DELETE FROM client_crm_activities WHERE user_id = ?").bind(id),
    database.prepare("UPDATE client_crm_profiles SET updated_by = ?, updated_at = ? WHERE updated_by = ? AND user_id <> ?").bind(actorId, now, id, id),
    database.prepare("DELETE FROM client_crm_profiles WHERE user_id = ?").bind(id),
    database.prepare("DELETE FROM webauthn_credentials WHERE user_id = ?").bind(id),
    database.prepare("DELETE FROM webauthn_challenges WHERE user_id = ?").bind(id),
    database.prepare("DELETE FROM qr_contacts WHERE user_id = ?").bind(id),
    database.prepare("UPDATE qr_contacts SET recipient_user_id = NULL WHERE recipient_user_id = ?").bind(id),
    // Physical deletion is intentional: retaining a DELETED-* tombstone leaves
    // the identity in Supabase and can make a later registration ambiguous.
    database.prepare(
      `DELETE FROM users
       WHERE id = ? AND is_owner = 0 AND deleted_at IS NULL`,
    ).bind(id),
    database.prepare(
      `INSERT INTO manager_audit_log (id, telegram_user_id, command, outcome, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), actorTelegramUserId ?? actorId, auditCommand, `${id}:${targetRole}`, now),
  ];
}

/**
 * Ban and delete are one database batch. The blacklist row is written first;
 * if any cleanup statement fails, the transaction rolls back and the account
 * remains intact instead of becoming partially deleted.
 */
export function buildBanUserStatements(
  database: D1Database,
  id: string,
  telegramUserId: string,
  actorId: string,
  actorTelegramUserId: string | null | undefined,
  targetRole: string,
  now: string,
  reason = "Baneado por el propietario",
) {
  return [
    database.prepare(
      `INSERT INTO account_blacklist (id, telegram_user_id, reason, banned_by_user_id, banned_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (telegram_user_id) DO UPDATE SET
         reason = excluded.reason,
         banned_by_user_id = excluded.banned_by_user_id,
         banned_at = excluded.banned_at`,
    ).bind(crypto.randomUUID(), telegramUserId, reason, actorId, now, now),
    ...buildFullUserDeletionStatements(
      database,
      id,
      actorId,
      actorTelegramUserId,
      targetRole,
      now,
      "web_ban_user",
    ),
  ];
}

export function buildDisableUserStatements(
  database: D1Database,
  id: string,
  actorId: string,
  actorTelegramUserId: string | null | undefined,
  now: string,
) {
  return [
    database.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id),
    database.prepare(
      `UPDATE global_recipient_directory
       SET status = 'revoked', revoked_at = ?, revoked_reason = 'Cuenta suspendida', updated_at = ?
       WHERE submitted_by_user_id = ? AND status = 'active'`,
    ).bind(now, now, id),
    database.prepare(
      `UPDATE global_qr_directory
       SET status = 'revoked', revoked_at = ?, revoked_reason = 'Cuenta suspendida', updated_at = ?
       WHERE submitted_by_user_id = ? AND status = 'active'`,
    ).bind(now, now, id),
    database.prepare(
      `UPDATE users SET status = 'disabled', updated_at = ?
       WHERE id = ? AND is_owner = 0 AND deleted_at IS NULL`,
    ).bind(now, id),
    database.prepare(
      `INSERT INTO manager_audit_log (id, telegram_user_id, command, outcome, created_at)
       VALUES (?, ?, 'web_disable_user', ?, ?)`,
    ).bind(crypto.randomUUID(), actorTelegramUserId ?? actorId, id, now),
  ];
}
