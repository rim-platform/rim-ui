/**
 * Whether this browser can hold a device key: WebCrypto with Ed25519 for a non-extractable key,
 * and IndexedDB to keep it in. Probed once per page and cached.
 */

let probe: Promise<boolean> | null = null;

async function canHoldDeviceKey(): Promise<boolean> {
  if (!globalThis.crypto?.subtle || !globalThis.indexedDB) return false;
  try {
    const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const raw = await crypto.subtle.exportKey("raw", pair.publicKey);
    return raw.byteLength === 32 && !pair.privateKey.extractable;
  } catch {
    return false;
  }
}

/** Whether this browser has WebCrypto Ed25519 and IndexedDB for a device key. */
export function browserDeviceKeysSupported(): Promise<boolean> {
  probe ??= canHoldDeviceKey();
  return probe;
}
