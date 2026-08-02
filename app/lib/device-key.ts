"use client";

import { bytesToBase64Url } from "@/app/lib/base64url";
import { canonicalPublicKey } from "@/app/lib/webauthn-utils";

const DB_NAME = "mi-banco-device";
const STORE_NAME = "credentials";
const KEY_ID = "primary-device-key";

type StoredDeviceKey = {
  id: string;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
};

export type DeviceProof = {
  deviceId: string;
  publicKey: JsonWebKey;
  proof: string;
  proofTimestamp: number;
};

function openDeviceDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("No se pudo abrir el almacenamiento seguro del dispositivo."));
  });
}

async function readStoredKey(): Promise<StoredDeviceKey | null> {
  const db = await openDeviceDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(KEY_ID);
      request.onsuccess = () => resolve((request.result as StoredDeviceKey | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error("No se pudo leer la clave del dispositivo."));
    });
  } finally {
    db.close();
  }
}

async function writeStoredKey(value: StoredDeviceKey) {
  const db = await openDeviceDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(value);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("No se pudo guardar la clave del dispositivo."));
    });
  } finally {
    db.close();
  }
}

async function createStoredKey(): Promise<StoredDeviceKey> {
  const generated = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const privateJwk = await crypto.subtle.exportKey("jwk", generated.privateKey);
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    privateJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const value = { id: KEY_ID, privateKey, publicKey: generated.publicKey };
  await writeStoredKey(value);
  return value;
}

async function getStoredKey() {
  return (await readStoredKey()) ?? createStoredKey();
}

export async function createDeviceProof(sellerId: string, username: string): Promise<DeviceProof> {
  if (!globalThis.crypto?.subtle || !globalThis.indexedDB) {
    throw new Error("Este dispositivo no admite el almacenamiento seguro requerido por la aplicación.");
  }

  const stored = await getStoredKey();
  const publicKey = await crypto.subtle.exportKey("jwk", stored.publicKey);
  const encodedPublicKey = new TextEncoder().encode(canonicalPublicKey(publicKey));
  const deviceDigest = new Uint8Array(await crypto.subtle.digest("SHA-256", encodedPublicKey));
  const deviceId = bytesToBase64Url(deviceDigest);
  const proofTimestamp = Date.now();
  const payload = new TextEncoder().encode(
    `mi-banco-device-proof-v1\n${sellerId.trim().toUpperCase()}\n${username.trim().toLowerCase()}\n${deviceId}\n${proofTimestamp}`,
  );
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, stored.privateKey, payload));

  return {
    deviceId,
    publicKey,
    proof: bytesToBase64Url(signature),
    proofTimestamp,
  };
}
