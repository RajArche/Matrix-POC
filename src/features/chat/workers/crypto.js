/* eslint-disable no-undef */
/**
 * Worker-local crypto utilities.
 *
 * Design:
 * - Generates a random AES-GCM key once per worker session.
 * - Keeps the key in memory only (session-only).
 * - Encrypts/decrypts message bodies as base64(iv) + ':' + base64(ciphertext).
 *
 * Important:
 * - Because the key is session-only, decrypted history is not guaranteed
 *   after a full reload/hard refresh.
 */

let sessionKey = null; // CryptoKey (in-memory only)

// Convert Uint8Array -> base64
const uint8ToBase64 = (u8) => {
  // Convert binary to string with chunking to avoid call stack limits.
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < u8.length; i += chunkSize) {
    const chunk = u8.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

// Convert base64 -> Uint8Array
const base64ToUint8 = (b64) => {
  const binary = atob(b64);
  const u8 = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) u8[i] = binary.charCodeAt(i);
  return u8;
};

export async function initSessionKey() {
  // AES-GCM key: 256-bit, non-extractable, only used for encrypt/decrypt.
  sessionKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export function destroySessionKey() {
  // Drop reference; key material is cleared by GC / runtime.
  sessionKey = null;
}

export async function encrypt(plaintext) {
  if (!sessionKey) throw new Error("Session key not initialized");

  // 96-bit IV (recommended for GCM).
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    sessionKey,
    encoded
  );

  return `${uint8ToBase64(iv)}:${uint8ToBase64(new Uint8Array(ciphertext))}`;
}

export async function decrypt(stored) {
  if (!sessionKey) throw new Error("Session key not initialized");
  if (!stored) return "";

  const [ivB64, ctB64] = stored.split(":");
  const iv = base64ToUint8(ivB64);
  const ct = base64ToUint8(ctB64);

  const plaintextBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    sessionKey,
    ct
  );

  return new TextDecoder().decode(plaintextBuf);
}

