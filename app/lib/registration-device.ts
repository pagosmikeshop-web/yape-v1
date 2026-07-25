"use client";

const ANCHOR_DB = "yape-registration-anchor";
const ANCHOR_STORE = "anchors";
const ANCHOR_KEY = "primary";
const ANCHOR_LOCAL_KEY = "yape.registration.anchor.v1";

let fingerprintAgent: Promise<{ get: () => Promise<{ visitorId: string }> }> | null = null;

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function getFingerprintId() {
  fingerprintAgent ??= import("@fingerprintjs/fingerprintjs")
    .then(({ default: FingerprintJS }) => FingerprintJS.load({ monitoring: false }));
  const agent = await fingerprintAgent;
  const result = await agent.get();
  if (!result.visitorId) throw new Error("No se pudo identificar este navegador.");
  return result.visitorId;
}

function openAnchorDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(ANCHOR_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(ANCHOR_STORE)) {
        request.result.createObjectStore(ANCHOR_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("No se pudo abrir IndexedDB."));
  });
}

async function readIndexedAnchor() {
  if (!("indexedDB" in window)) return "";
  const db = await openAnchorDb();
  try {
    return await new Promise<string>((resolve, reject) => {
      const request = db.transaction(ANCHOR_STORE, "readonly").objectStore(ANCHOR_STORE).get(ANCHOR_KEY);
      request.onsuccess = () => resolve(typeof request.result?.value === "string" ? request.result.value : "");
      request.onerror = () => reject(request.error ?? new Error("No se pudo leer el anclaje local."));
    });
  } finally {
    db.close();
  }
}

async function writeIndexedAnchor(value: string) {
  if (!("indexedDB" in window)) return;
  const db = await openAnchorDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(ANCHOR_STORE, "readwrite").objectStore(ANCHOR_STORE).put({
        id: ANCHOR_KEY,
        value,
        savedAt: new Date().toISOString(),
      });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("No se pudo guardar el anclaje local."));
    });
  } finally {
    db.close();
  }
}

async function encryptionKey(fingerprintId: string) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`yape-registration-anchor-v1:${location.origin}:${fingerprintId}`),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: new TextEncoder().encode("yape-registration-anchor-salt-v1"),
      iterations: 100_000,
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function makeEncryptedAnchor(fingerprintId: string) {
  const key = await encryptionKey(fingerprintId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const payload = new TextEncoder().encode(JSON.stringify({
    marker: "registered",
    createdAt: new Date().toISOString(),
    random: bytesToBase64Url(crypto.getRandomValues(new Uint8Array(18))),
  }));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, payload));
  return JSON.stringify({ v: 1, iv: bytesToBase64Url(iv), data: bytesToBase64Url(ciphertext) });
}

async function canDecryptAnchor(value: string, fingerprintId: string) {
  try {
    const parsed = JSON.parse(value) as { iv?: string; data?: string };
    if (!parsed.iv || !parsed.data) return false;
    const key = await encryptionKey(fingerprintId);
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64UrlToBytes(parsed.iv) }, key, base64UrlToBytes(parsed.data));
    return true;
  } catch {
    return false;
  }
}

export async function hasLocalRegistrationAnchor(fingerprintId: string) {
  const localValue = localStorage.getItem(ANCHOR_LOCAL_KEY) ?? "";
  const indexedValue = await readIndexedAnchor().catch(() => "");
  if (!localValue && !indexedValue) return false;
  return (localValue ? await canDecryptAnchor(localValue, fingerprintId) : false)
    || (indexedValue ? await canDecryptAnchor(indexedValue, fingerprintId) : false)
    || Boolean(localValue || indexedValue);
}

export async function saveLocalRegistrationAnchor(fingerprintId: string) {
  const encrypted = await makeEncryptedAnchor(fingerprintId);
  localStorage.setItem(ANCHOR_LOCAL_KEY, encrypted);
  await writeIndexedAnchor(encrypted);
}

export async function clearLocalRegistrationAnchor() {
  localStorage.removeItem(ANCHOR_LOCAL_KEY);
  if (!("indexedDB" in window)) return;
  const db = await openAnchorDb().catch(() => null);
  if (!db) return;
  try {
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(ANCHOR_STORE, "readwrite").objectStore(ANCHOR_STORE).delete(ANCHOR_KEY);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("No se pudo limpiar el anclaje local."));
    });
  } finally {
    db.close();
  }
}
