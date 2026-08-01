import { dbBinding, publicSha256 } from "@/app/lib/auth-server";
import {
  isAutocompleteKey,
  normalizeAutocompleteKey,
} from "@/app/lib/autocomplete-credits";

export type AutocompleteStatus = {
  enabled: boolean;
  /** null representa el token maestro histórico, sin key asignada. */
  credits: number | null;
  keyClaimed: boolean;
};

export type AutocompleteReservation = {
  keyId: string | null;
};

export async function autocompleteKeyHash(value: string) {
  return publicSha256(`autocomplete-key-v1\n${normalizeAutocompleteKey(value)}`);
}

export async function getAutocompleteStatus(userId: string): Promise<AutocompleteStatus> {
  const database = dbBinding();
  const entitlement = await database.prepare(
    `SELECT enabled FROM account_feature_entitlements
     WHERE user_id = ? AND kind = 'auto' LIMIT 1`,
  ).bind(userId).first<{ enabled: number }>();
  const claim = await database.prepare(
    `SELECT k.credits_remaining, k.revoked_at
     FROM autocomplete_key_claims c
     JOIN autocomplete_keys k ON k.id = c.key_id
     WHERE c.user_id = ?
     ORDER BY c.claimed_at ASC LIMIT 1`,
  ).bind(userId).first<{ credits_remaining: number; revoked_at: string | null }>();
  const keyClaimed = Boolean(claim);
  const credits = claim?.revoked_at ? 0 : Number(claim?.credits_remaining ?? 0);
  const enabled = keyClaimed
    ? credits > 0
    : Boolean(entitlement?.enabled);
  return {
    enabled,
    credits: keyClaimed ? credits : null,
    keyClaimed,
  };
}

/** Reclama una key y la vincula de forma permanente a una sola cuenta. */
export async function claimAutocompleteKey(userId: string, rawToken: string) {
  const normalized = normalizeAutocompleteKey(rawToken);
  if (!isAutocompleteKey(normalized)) return null;
  const tokenHash = await autocompleteKeyHash(normalized);
  const database = dbBinding();
  const key = await database.prepare(
    `SELECT id, credits_remaining FROM autocomplete_keys
     WHERE token_hash = ? AND revoked_at IS NULL LIMIT 1`,
  ).bind(tokenHash).first<{ id: string; credits_remaining: number }>();
  if (!key) return null;
  if (Number(key.credits_remaining) <= 0) {
    throw new Error("AUTOCOMPLETE_KEY_EXHAUSTED");
  }

  const existingClaim = await database.prepare(
    "SELECT user_id FROM autocomplete_key_claims WHERE key_id = ? LIMIT 1",
  ).bind(key.id).first<{ user_id: string }>();
  if (existingClaim && existingClaim.user_id !== userId) {
    throw new Error("AUTOCOMPLETE_KEY_CLAIMED");
  }

  const now = new Date().toISOString();
  try {
    await database.prepare(
      `INSERT OR IGNORE INTO autocomplete_key_claims (key_id, user_id, claimed_at)
       VALUES (?, ?, ?)`,
    ).bind(key.id, userId, now).run();
  } catch (error) {
    if (!/unique|primary/iu.test(error instanceof Error ? error.message : "")) throw error;
    throw new Error("AUTOCOMPLETE_KEY_CLAIMED");
  }

  const claimAfterInsert = await database.prepare(
    "SELECT user_id FROM autocomplete_key_claims WHERE key_id = ? LIMIT 1",
  ).bind(key.id).first<{ user_id: string }>();
  if (!claimAfterInsert || claimAfterInsert.user_id !== userId) {
    throw new Error("AUTOCOMPLETE_KEY_CLAIMED");
  }

  await database.prepare(
    `INSERT INTO account_feature_entitlements (user_id, kind, enabled, validated_at, updated_at)
     VALUES (?, 'auto', 1, ?, ?)
     ON CONFLICT(user_id, kind) DO UPDATE SET
       enabled = 1,
       validated_at = excluded.validated_at,
       updated_at = excluded.updated_at`,
  ).bind(userId, now, now).run();
  return getAutocompleteStatus(userId);
}

/** Reserva un crédito justo antes de llamar al proveedor externo. */
export async function reserveAutocompleteCredit(userId: string): Promise<AutocompleteReservation | null> {
  const database = dbBinding();
  const claims = await database.prepare(
    `SELECT c.key_id, k.credits_remaining
     FROM autocomplete_key_claims c
     JOIN autocomplete_keys k ON k.id = c.key_id
     WHERE c.user_id = ? AND k.revoked_at IS NULL AND k.credits_remaining > 0
     ORDER BY k.created_at ASC`,
  ).bind(userId).all<{ key_id: string; credits_remaining: number }>();
  const claimCount = await database.prepare(
    "SELECT COUNT(*) AS count FROM autocomplete_key_claims WHERE user_id = ?",
  ).bind(userId).first<{ count: number }>();
  for (const claim of claims.results ?? []) {
    const result = await database.prepare(
      `UPDATE autocomplete_keys
       SET credits_remaining = credits_remaining - 1
       WHERE id = ? AND revoked_at IS NULL AND credits_remaining > 0`,
    ).bind(claim.key_id).run();
    if (Number(result.meta.changes ?? 0) === 1) return { keyId: claim.key_id };
  }

  // Compatibilidad con el token maestro anterior: no tiene bolsa ni consume
  // créditos. Las keys reclamadas siempre pasan por la reserva anterior.
  if (Number(claimCount?.count ?? 0) === 0) {
    const entitlement = await database.prepare(
      `SELECT enabled FROM account_feature_entitlements
       WHERE user_id = ? AND kind = 'auto' LIMIT 1`,
    ).bind(userId).first<{ enabled: number }>();
    if (entitlement?.enabled) return { keyId: null };
  }
  return null;
}

export async function refundAutocompleteCredit(reservation: AutocompleteReservation) {
  if (!reservation.keyId) return;
  await dbBinding().prepare(
    `UPDATE autocomplete_keys
     SET credits_remaining = credits_remaining + 1
     WHERE id = ? AND revoked_at IS NULL AND credits_remaining < credits_total`,
  ).bind(reservation.keyId).run();
}
