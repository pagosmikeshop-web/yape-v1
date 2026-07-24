/**
 * WebAuthn / Passkeys (platform: Face ID / huella).
 *
 * Flujo de datos:
 * 1) Registro: options → browser startRegistration → verify → guardar credentialID + publicKey.
 * 2) Unlock: options → browser startAuthentication → verify → rotateAndUnlockSession (igual que PIN).
 * El PIN sigue disponible siempre como fallback.
 */

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import {
  dbBinding,
  ensureAuthSchema,
  publicAppBaseUrl,
  type AuthUser,
} from "@/app/lib/auth-server";

const CHALLENGE_TTL_MS = 5 * 60_000;

export type StoredWebAuthnCredential = {
  credential_id: string;
  public_key: string;
  counter: number;
  transports: string | null;
  device_type: string | null;
  backed_up: number;
};

function rpFromRequest(request: Request) {
  const origin = publicAppBaseUrl(request);
  const url = new URL(origin);
  return {
    rpID: url.hostname,
    rpName: "Yape",
    origin,
  };
}

async function saveChallenge(userId: string, type: "registration" | "authentication", challenge: string) {
  const now = Date.now();
  const expiresAt = new Date(now + CHALLENGE_TTL_MS).toISOString();
  await dbBinding().batch([
    dbBinding().prepare(
      `DELETE FROM webauthn_challenges WHERE user_id = ? AND type = ?`,
    ).bind(userId, type),
    dbBinding().prepare(
      `INSERT INTO webauthn_challenges (id, user_id, type, challenge, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), userId, type, challenge, expiresAt, new Date(now).toISOString()),
  ]);
}

async function consumeChallenge(userId: string, type: "registration" | "authentication") {
  const row = await dbBinding().prepare(
    `SELECT id, challenge, expires_at
     FROM webauthn_challenges
     WHERE user_id = ? AND type = ?
     ORDER BY created_at DESC
     LIMIT 1`,
  ).bind(userId, type).first<{ id: string; challenge: string; expires_at: string }>();

  if (!row) return null;
  await dbBinding().prepare(`DELETE FROM webauthn_challenges WHERE id = ?`).bind(row.id).run();
  if (Date.parse(row.expires_at) <= Date.now()) return null;
  return row.challenge;
}

export async function listUserCredentials(userId: string) {
  await ensureAuthSchema();
  const result = await dbBinding().prepare(
    `SELECT credential_id, public_key, counter, transports, device_type, backed_up
     FROM webauthn_credentials
     WHERE user_id = ?
     ORDER BY created_at DESC`,
  ).bind(userId).all<StoredWebAuthnCredential>();
  return result.results ?? [];
}

export async function userHasWebAuthn(userId: string) {
  await ensureAuthSchema();
  const row = await dbBinding().prepare(
    `SELECT 1 AS ok FROM webauthn_credentials WHERE user_id = ? LIMIT 1`,
  ).bind(userId).first<{ ok: number }>();
  return Boolean(row?.ok);
}

export async function buildRegistrationOptions(request: Request, user: AuthUser) {
  await ensureAuthSchema();
  const { rpID, rpName } = rpFromRequest(request);
  const existing = await listUserCredentials(user.id);

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: user.username,
    userDisplayName: user.displayName,
    userID: isoBase64URL.toBuffer(user.id),
    attestationType: "none",
    // Forzar biométrico local del dispositivo (Face ID / huella), no llaves USB.
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      userVerification: "required",
      residentKey: "preferred",
    },
    excludeCredentials: existing.map((credential) => ({
      id: credential.credential_id,
      transports: parseTransports(credential.transports),
    })),
  });

  await saveChallenge(user.id, "registration", options.challenge);
  return options;
}

export async function completeRegistration(
  request: Request,
  user: AuthUser,
  response: RegistrationResponseJSON,
) {
  await ensureAuthSchema();
  const expectedChallenge = await consumeChallenge(user.id, "registration");
  if (!expectedChallenge) {
    throw Response.json(
      { ok: false, error: "El desafío biométrico expiró. Inténtalo de nuevo." },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  const { rpID, origin } = rpFromRequest(request);
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw Response.json(
      { ok: false, error: "No pudimos verificar el biométrico." },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  const transports = response.response.transports ?? [];
  const now = new Date().toISOString();

  await dbBinding().prepare(
    `INSERT INTO webauthn_credentials (
      credential_id, user_id, public_key, counter, transports, device_type, backed_up, created_at, last_used_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(credential_id) DO UPDATE SET
      public_key = excluded.public_key,
      counter = excluded.counter,
      transports = excluded.transports,
      device_type = excluded.device_type,
      backed_up = excluded.backed_up,
      last_used_at = excluded.last_used_at`,
  ).bind(
    credential.id,
    user.id,
    isoBase64URL.fromBuffer(credential.publicKey),
    credential.counter,
    JSON.stringify(transports),
    credentialDeviceType,
    credentialBackedUp ? 1 : 0,
    now,
    now,
  ).run();

  return { credentialId: credential.id };
}

export async function buildAuthenticationOptions(request: Request, user: AuthUser) {
  await ensureAuthSchema();
  const { rpID } = rpFromRequest(request);
  const existing = await listUserCredentials(user.id);
  if (existing.length === 0) {
    throw Response.json(
      { ok: false, error: "No tienes biométricos registrados. Usa tu clave.", code: "WEBAUTHN_NOT_REGISTERED" },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }

  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "required",
    allowCredentials: existing.map((credential) => ({
      id: credential.credential_id,
      transports: parseTransports(credential.transports),
    })),
  });

  await saveChallenge(user.id, "authentication", options.challenge);
  return options;
}

export async function completeAuthentication(
  request: Request,
  user: AuthUser,
  response: AuthenticationResponseJSON,
) {
  await ensureAuthSchema();
  const expectedChallenge = await consumeChallenge(user.id, "authentication");
  if (!expectedChallenge) {
    throw Response.json(
      { ok: false, error: "El desafío biométrico expiró. Usa tu clave o inténtalo de nuevo." },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  const credentialId = response.id;
  const stored = await dbBinding().prepare(
    `SELECT credential_id, public_key, counter, transports, device_type, backed_up
     FROM webauthn_credentials
     WHERE user_id = ? AND credential_id = ?
     LIMIT 1`,
  ).bind(user.id, credentialId).first<StoredWebAuthnCredential>();

  if (!stored) {
    throw Response.json(
      { ok: false, error: "Credencial biométrica no reconocida. Usa tu clave." },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }

  const { rpID, origin } = rpFromRequest(request);
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
    credential: {
      id: stored.credential_id,
      publicKey: isoBase64URL.toBuffer(stored.public_key),
      counter: stored.counter,
      transports: parseTransports(stored.transports),
    },
  });

  if (!verification.verified) {
    throw Response.json(
      { ok: false, error: "No pudimos verificar el biométrico. Usa tu clave." },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  const newCounter = verification.authenticationInfo.newCounter;
  await dbBinding().prepare(
    `UPDATE webauthn_credentials
     SET counter = ?, last_used_at = ?
     WHERE credential_id = ? AND user_id = ?`,
  ).bind(newCounter, new Date().toISOString(), stored.credential_id, user.id).run();

  return { credentialId: stored.credential_id };
}

export async function deleteAllUserCredentials(userId: string) {
  await ensureAuthSchema();
  await dbBinding().batch([
    dbBinding().prepare(`DELETE FROM webauthn_credentials WHERE user_id = ?`).bind(userId),
    dbBinding().prepare(`DELETE FROM webauthn_challenges WHERE user_id = ?`).bind(userId),
  ]);
}

function parseTransports(value: string | null): AuthenticatorTransportFuture[] | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    return parsed.filter((entry): entry is AuthenticatorTransportFuture => typeof entry === "string");
  } catch {
    return undefined;
  }
}
