import { sql } from "drizzle-orm";
import { bigint, check, index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  sellerCode: text("seller_code").notNull(),
  username: text("username").notNull(),
  displayName: text("display_name").notNull(),
  email: text("email").notNull().default(""),
  role: text("role").notNull(),
  isOwner: integer("is_owner").notNull().default(0),
  ownerId: text("owner_id"),
  status: text("status").notNull().default("pending"),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  pinHash: text("pin_hash"),
  pinSalt: text("pin_salt"),
  credits: bigint("credits", { mode: "number" }).notNull().default(0),
  deviceId: text("device_id"),
  devicePublicKey: text("device_public_key"),
  fingerprintIdHash: text("fingerprint_id_hash"),
  telegramUserId: text("telegram_user_id"),
  referralCode: text("referral_code"),
  referredByUserId: text("referred_by_user_id"),
  accessExpiresAt: text("access_expires_at"),
  referralRedemptionCount: integer("referral_redemption_count").notNull().default(0),
  mustChangePassword: integer("must_change_password").notNull().default(0),
  mustSetPin: integer("must_set_pin").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  activatedAt: text("activated_at"),
  deletedAt: text("deleted_at"),
}, (table) => [
  uniqueIndex("users_login_unique").on(table.sellerCode, table.username),
  uniqueIndex("users_device_unique").on(table.deviceId),
  uniqueIndex("users_fingerprint_unique").on(table.fingerprintIdHash),
  uniqueIndex("users_telegram_user_unique").on(table.telegramUserId),
  uniqueIndex("users_referral_code_unique").on(table.referralCode),
  index("users_owner_role_idx").on(table.ownerId, table.role, table.deletedAt),
]);
/** Roles adicionales de una misma cuenta. `users.role` conserva el rol
 * operativo principal para compatibilidad con las consultas existentes. */
export const userRoles = pgTable("user_roles", {
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  grantedBy: text("granted_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("user_roles_user_role_unique").on(table.userId, table.role),
  index("user_roles_role_idx").on(table.role, table.userId),
  check("user_roles_role_check", sql`${table.role} in ('admin', 'seller', 'client')`),
]);

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  pinVerifiedAt: text("pin_verified_at"),
  unlockedUntil: text("unlocked_until"),
});

export const authRateLimits = pgTable("auth_rate_limits", {
  bucket: text("bucket").notNull(),
  subjectHash: text("subject_hash").notNull(),
  windowStartedAt: integer("window_started_at").notNull(),
  attemptCount: integer("attempt_count").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("auth_rate_limits_subject_unique").on(table.bucket, table.subjectHash),
  index("auth_rate_limits_updated_idx").on(table.updatedAt),
]);

export const paymentDirectory = pgTable("payment_directory", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  phoneE164: text("phone_e164").notNull(),
  discoverable: integer("discoverable").notNull().default(1),
  verifiedAt: text("verified_at").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("payment_directory_user_unique").on(table.userId),
  uniqueIndex("payment_directory_phone_unique").on(table.phoneE164),
]);

export const recipientLookupAttempts = pgTable("recipient_lookup_attempts", {
  id: text("id").primaryKey(),
  requesterUserId: text("requester_user_id").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("recipient_lookup_requester_idx").on(table.requesterUserId, table.createdAt)]);

export const savedPaymentRecipients = pgTable("saved_payment_recipients", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  phoneE164: text("phone_e164").notNull(),
  displayName: text("display_name").notNull().default("NÃºmero nuevo"),
  source: text("source").notNull().default("manual"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("saved_payment_recipients_user_phone_unique").on(table.userId, table.phoneE164),
  index("saved_payment_recipients_user_updated_idx").on(table.userId, table.updatedAt),
]);

/** Directorio global de destinatarios publicado con aceptación de términos. */
export const globalRecipientDirectory = pgTable("global_recipient_directory", {
  id: text("id").primaryKey(),
  phoneE164: text("phone_e164").notNull(),
  displayName: text("display_name").notNull(),
  provider: text("provider").notNull().default("Yape"),
  source: text("source").notNull().default("manual"),
  submittedByUserId: text("submitted_by_user_id").notNull(),
  termsVersion: text("terms_version").notNull(),
  termsAcceptedAt: text("terms_accepted_at").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  revokedAt: text("revoked_at"),
  revokedReason: text("revoked_reason"),
}, (table) => [
  uniqueIndex("global_recipient_directory_phone_provider_unique").on(table.phoneE164, table.provider),
  index("global_recipient_directory_submitter_idx").on(table.submittedByUserId, table.updatedAt),
  index("global_recipient_directory_active_idx").on(table.phoneE164, table.status),
  check("global_recipient_directory_source_check", sql`${table.source} in ('manual', 'qr')`),
  check("global_recipient_directory_provider_check", sql`${table.provider} in ('Yape', 'Plin', 'BCP', 'BBVA', 'Interbank', 'Scotiabank', 'Bim', 'Banco Falabella', 'Banco Pichincha', 'Dale!', 'Izipay', 'Agora / Oh!', 'Tunki')`),
  check("global_recipient_directory_status_check", sql`${table.status} in ('active', 'revoked')`),
]);

/** QR global publicado con payload cifrado y aceptación de términos. */
export const globalQrDirectory = pgTable("global_qr_directory", {
  id: text("id").primaryKey(),
  holderName: text("holder_name").notNull(),
  phoneE164: text("phone_e164"),
  provider: text("provider").notNull(),
  recipientUserId: text("recipient_user_id"),
  submittedByUserId: text("submitted_by_user_id").notNull(),
  qrPayloadCiphertext: text("qr_payload_ciphertext").notNull(),
  qrPayloadIv: text("qr_payload_iv").notNull(),
  payloadHash: text("payload_hash").notNull(),
  encryptionVersion: integer("encryption_version").notNull().default(1),
  termsVersion: text("terms_version").notNull(),
  termsAcceptedAt: text("terms_accepted_at").notNull(),
  status: text("status").notNull().default("active"),
    expiresAt: text("expires_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  revokedAt: text("revoked_at"),
  revokedReason: text("revoked_reason"),
}, (table) => [
  uniqueIndex("global_qr_directory_payload_unique").on(table.payloadHash),
  index("global_qr_directory_submitter_idx").on(table.submittedByUserId, table.updatedAt),
  index("global_qr_directory_phone_idx").on(table.phoneE164, table.status),
  index("global_qr_directory_recipient_idx").on(table.recipientUserId),
  check("global_qr_directory_encryption_version_check", sql`${table.encryptionVersion} = 1`),
  check("global_qr_directory_status_check", sql`${table.status} in ('active', 'revoked')`),
]);

/** Registro inmutable de cada intento de lectura del lector QR. */
export const qrScanEvents = pgTable("qr_scan_events", {
  id: text("id").primaryKey(),
  qrId: text("qr_id").references(() => globalQrDirectory.id, { onDelete: "set null" }),
  scannedValueHash: text("scanned_value_hash").notNull(),
  scannedByUserId: text("scanned_by_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  idempotencyKey: text("idempotency_key").notNull(),
  scanStatus: text("scan_status").notNull(),
  errorCode: text("error_code"),
  responsePayload: text("response_payload"),
  deviceInformation: text("device_information"),
  userAgent: text("user_agent"),
  scannedAt: text("scanned_at").notNull(),
}, (table) => [
  uniqueIndex("qr_scan_events_idempotency_unique").on(table.scannedByUserId, table.idempotencyKey),
  index("qr_scan_events_qr_time_idx").on(table.qrId, table.scannedAt),
  index("qr_scan_events_user_time_idx").on(table.scannedByUserId, table.scannedAt),
    check("qr_scan_events_status_check", sql`${table.scanStatus} in ('valid', 'invalid')`),
]);

export const accountBalances = pgTable("account_balances", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  balanceCents: bigint("balance_cents", { mode: "number" }).notNull().default(3913),
  isConfigured: integer("is_configured").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  check("account_balances_non_negative_check", sql`${table.balanceCents} >= 0`),
  check("account_balances_maximum_check", sql`${table.balanceCents} <= 99999999999`),
]);

export const accountMovements = pgTable("account_movements", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  recipientName: text("recipient_name").notNull(),
  recipientReference: text("recipient_reference").notNull(),
  recipientUserId: text("recipient_user_id").references(() => users.id, { onDelete: "set null" }),
  savedRecipientId: text("saved_recipient_id").references(() => savedPaymentRecipients.id, { onDelete: "set null" }),
  destination: text("destination").notNull().default("Yape"),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  message: text("message").notNull().default(""),
  securityCode: text("security_code").notNull(),
  operationNumber: text("operation_number").notNull(),
  idempotencyKey: text("idempotency_key"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("account_movements_operation_unique").on(table.operationNumber),
  uniqueIndex("account_movements_user_idempotency_unique").on(table.userId, table.idempotencyKey),
  index("account_movements_user_created_idx").on(table.userId, table.createdAt),
  index("account_movements_recipient_user_idx").on(table.recipientUserId),
  check("account_movements_positive_amount_check", sql`${table.amountCents} > 0`),
]);

export const accountHistoryState = pgTable("account_history_state", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  clearedAt: text("cleared_at").notNull(),
});

export const accountFeatureEntitlements = pgTable("account_feature_entitlements", {
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["sms", "auto"] }).notNull(),
  enabled: integer("enabled").notNull().default(1),
  validatedAt: text("validated_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("account_feature_entitlements_user_kind_unique").on(table.userId, table.kind),
  index("account_feature_entitlements_user_idx").on(table.userId, table.kind),
  check("account_feature_entitlements_enabled_check", sql`${table.enabled} in (0, 1)`),
]);

/** Claves emitidas desde el panel que financian el autocompletado de una cuenta. */
export const autocompleteKeys = pgTable("autocomplete_keys", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull(),
  tokenHint: text("token_hint").notNull(),
  creditsTotal: bigint("credits_total", { mode: "number" }).notNull(),
  creditsRemaining: bigint("credits_remaining", { mode: "number" }).notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  revokedAt: text("revoked_at"),
  tokenCiphertext: text("token_ciphertext"),
}, (table) => [
  uniqueIndex("autocomplete_keys_hash_unique").on(table.tokenHash),
  index("autocomplete_keys_created_idx").on(table.createdAt),
  check("autocomplete_keys_credits_check", sql`${table.creditsTotal} > 0 AND ${table.creditsRemaining} >= 0`),
]);

/** A claim binds a generated key to exactly one account. The first account
 * receives the full credit balance, and no other account can claim it. */
export const autocompleteKeyClaims = pgTable("autocomplete_key_claims", {
  keyId: text("key_id")
    .notNull()
    .primaryKey()
    .references(() => autocompleteKeys.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  claimedAt: text("claimed_at").notNull(),
}, (table) => [
  index("autocomplete_key_claims_user_idx").on(table.userId, table.claimedAt),
]);

export const creditLedger = pgTable("credit_ledger", {
  id: text("id").primaryKey(),
  sellerId: text("seller_id").notNull(),
  delta: bigint("delta", { mode: "number" }).notNull(),
  balanceAfter: bigint("balance_after", { mode: "number" }).notNull(),
  reason: text("reason").notNull(),
  referenceId: text("reference_id").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("credit_ledger_reference_unique").on(table.reason, table.referenceId)]);

export const activations = pgTable("activations", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().unique(),
  sellerId: text("seller_id").notNull(),
  creditsCharged: bigint("credits_charged", { mode: "number" }).notNull().default(1),
  createdAt: text("created_at").notNull(),
});

export const permanentAccessTokens = pgTable("permanent_access_tokens", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull(),
  tokenHint: text("token_hint").notNull(),
  sellerId: text("seller_id").notNull(),
  userId: text("user_id").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  redeemedAt: text("redeemed_at"),
}, (table) => [
  uniqueIndex("permanent_access_tokens_hash_unique").on(table.tokenHash),
  index("permanent_access_tokens_seller_idx").on(table.sellerId, table.createdAt),
  index("permanent_access_tokens_user_idx").on(table.userId, table.createdAt),
]);

export const globalPermanentAccessTokens = pgTable("global_permanent_access_tokens", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull(),
  tokenHint: text("token_hint").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  redeemedAt: text("redeemed_at"),
  redeemedByUserId: text("redeemed_by_user_id"),
  tokenCiphertext: text("token_ciphertext"),
}, (table) => [
  uniqueIndex("global_permanent_access_tokens_hash_unique").on(table.tokenHash),
  index("global_permanent_access_tokens_created_idx").on(table.createdAt),
  index("global_permanent_access_tokens_redeemed_idx").on(table.redeemedAt),
]);

export const passwordResetRequests = pgTable("password_reset_requests", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  sellerId: text("seller_id").notNull(),
  status: text("status").notNull().default("pending"),
  priceCredits: bigint("price_credits", { mode: "number" }).notNull().default(1),
  createdAt: text("created_at").notNull(),
  approvedAt: text("approved_at"),
  approvedBy: text("approved_by"),
}, (table) => [
  index("password_reset_seller_idx").on(table.sellerId, table.status),
  index("password_reset_user_idx").on(table.userId, table.status, table.createdAt),
]);

export const accountPaymentProfiles = pgTable("account_payment_profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  phoneE164: text("phone_e164"),
  qrPayloadCiphertext: text("qr_payload_ciphertext"),
  qrPayloadIv: text("qr_payload_iv"),
  accuracyConfirmedAt: text("accuracy_confirmed_at").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("account_payment_profiles_phone_unique").on(table.phoneE164),
  index("account_payment_profiles_updated_idx").on(table.updatedAt),
  check(
    "account_payment_profiles_contact_check",
    sql`${table.phoneE164} is not null or ${table.qrPayloadCiphertext} is not null`,
  ),
  check(
    "account_payment_profiles_qr_pair_check",
    sql`(${table.qrPayloadCiphertext} is null and ${table.qrPayloadIv} is null) or (${table.qrPayloadCiphertext} is not null and ${table.qrPayloadIv} is not null)`,
  ),
]);

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  subjectHash: text("subject_hash").notNull(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"),
  consumedBy: text("consumed_by"),
}, (table) => [
  uniqueIndex("password_reset_tokens_hash_unique").on(table.tokenHash),
  index("password_reset_tokens_user_idx").on(table.userId, table.createdAt),
  index("password_reset_tokens_expiry_idx").on(table.expiresAt),
]);

export const accountInvitations = pgTable("account_invitations", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"),
  consumedBy: text("consumed_by"),
}, (table) => [
  uniqueIndex("account_invitations_token_unique").on(table.tokenHash),
  index("account_invitations_user_idx").on(table.userId, table.createdAt),
  index("account_invitations_expiry_idx").on(table.expiresAt),
]);

export const qrContacts = pgTable("qr_contacts", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  holderName: text("holder_name").notNull(),
  phoneE164: text("phone_e164"),
  provider: text("provider").notNull(),
  recipientUserId: text("recipient_user_id")
    .references(() => users.id, { onDelete: "set null" }),
  qrPayloadCiphertext: text("qr_payload_ciphertext").notNull(),
  qrPayloadIv: text("qr_payload_iv").notNull(),
  payloadHash: text("payload_hash").notNull(),
  encryptionVersion: integer("encryption_version").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("qr_contacts_user_payload_unique").on(table.userId, table.payloadHash),
  index("qr_contacts_user_updated_idx").on(table.userId, table.updatedAt),
  index("qr_contacts_recipient_idx").on(table.recipientUserId),
  check("qr_contacts_provider_check", sql`${table.provider} in ('Mi Banco','Yape','Plin','BCP','BBVA','Interbank','Scotiabank','Bim','Banco Falabella','Banco Pichincha','Dale!','Izipay','Agora / Oh!','Tunki')`),
  check("qr_contacts_encryption_version_check", sql`${table.encryptionVersion} = 1`),
]);

export const telegramIdentities = pgTable("telegram_identities", {
  telegramUserId: text("telegram_user_id").primaryKey(),
  userId: text("user_id").notNull().unique(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("telegram_identity_user_idx").on(table.userId)]);

export const telegramUpdates = pgTable("telegram_updates", {
  updateId: text("update_id").primaryKey(),
  receivedAt: text("received_at").notNull(),
});

export const telegramRegistrationChallenges = pgTable("telegram_registration_challenges", {
  id: text("id").primaryKey(),
  codeHash: text("code_hash").notNull().unique(),
  telegramUserId: text("telegram_user_id").notNull(),
  fingerprintHash: text("fingerprint_hash").notNull(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  verifiedAt: text("verified_at"),
  consumedAt: text("consumed_at"),
}, (table) => [
  index("telegram_registration_challenges_lookup_idx").on(
    table.telegramUserId,
    table.fingerprintHash,
    table.expiresAt,
  ),
  index("telegram_registration_challenges_expiry_idx").on(table.expiresAt),
]);

export const telegramGroupMembers = pgTable("telegram_group_members", {
  telegramUserId: text("telegram_user_id").primaryKey(),
  chatId: text("chat_id").notNull(),
  username: text("username"),
  displayName: text("display_name"),
  firstSeenAt: text("first_seen_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
}, (table) => [
  index("telegram_group_members_chat_idx").on(table.chatId, table.lastSeenAt),
]);

export const referralRedemptions = pgTable("referral_redemptions", {
  id: text("id").primaryKey(),
  referrerUserId: text("referrer_user_id").notNull(),
  redeemerTelegramUserId: text("redeemer_telegram_user_id").notNull(),
  redeemedByUserId: text("redeemed_by_user_id"),
  monthKey: text("month_key").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("referral_redemptions_unique").on(table.referrerUserId, table.redeemerTelegramUserId, table.monthKey),
  index("referral_redemptions_referrer_month_idx").on(table.referrerUserId, table.monthKey),
]);

export const managerAuditLog = pgTable("manager_audit_log", {
  id: text("id").primaryKey(),
  telegramUserId: text("telegram_user_id").notNull(),
  command: text("command").notNull(),
  outcome: text("outcome").notNull(),
  createdAt: text("created_at").notNull(),
});

export const rbacPermissionOverrides = pgTable("rbac_permission_overrides", {
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  permission: text("permission").notNull(),
  effect: text("effect").notNull(),
  updatedBy: text("updated_by").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("rbac_permission_overrides_unique").on(table.userId, table.permission),
  index("rbac_permission_overrides_user_idx").on(table.userId),
]);

export const clientCrmProfiles = pgTable("client_crm_profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  crmStatus: text("crm_status").notNull().default("new"),
  clientType: text("client_type").notNull().default("individual"),
  category: text("category").notNull().default("general"),
  tagsJson: text("tags_json").notNull().default("[]"),
  notes: text("notes").notNull().default(""),
  lastActivityAt: text("last_activity_at"),
  updatedBy: text("updated_by"),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("client_crm_profiles_status_idx").on(table.crmStatus, table.category),
  index("client_crm_profiles_activity_idx").on(table.lastActivityAt),
]);

export const clientCrmActivities = pgTable("client_crm_activities", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  activityType: text("activity_type").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull().default(0),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("client_crm_activities_user_idx").on(table.userId, table.createdAt),
  index("client_crm_activities_type_idx").on(table.activityType, table.createdAt),
]);

export const webauthnCredentials = pgTable("webauthn_credentials", {
  credentialId: text("credential_id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  publicKey: text("public_key").notNull(),
  counter: integer("counter").notNull().default(0),
  transports: text("transports"),
  deviceType: text("device_type"),
  backedUp: integer("backed_up").notNull().default(0),
  createdAt: text("created_at").notNull(),
  lastUsedAt: text("last_used_at"),
}, (table) => [
  index("webauthn_credentials_user_idx").on(table.userId),
]);

export const webauthnChallenges = pgTable("webauthn_challenges", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  challenge: text("challenge").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("webauthn_challenges_user_type_idx").on(table.userId, table.type),
  index("webauthn_challenges_expiry_idx").on(table.expiresAt),
]);
