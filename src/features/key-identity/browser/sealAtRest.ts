/**
 * What an unlock does to the account's key record in this browser: it seals keys a signup,
 * recovery or device link wrote before the first unlock, drops the keys a confirmed recovery
 * replaced, and, when the unlock saw the server share, writes the device key's wrap under it
 * again, bringing back a device key that a new data key lost.
 */

import { privateKeyBytes, vaultHolds } from "../../../core/accountVault/accountVault";
import {
  deviceKeyWrapKey,
  fromB64,
  toB64,
  unwrapDeviceSeed,
  wrapDeviceSeed,
} from "../../../core/accountVault/crypto";
import { logger } from "../../../core/logger";
import { concat } from "./bytes";
import { changeRecord, holdsUnsealedKeys, type BrowserKeyRecord } from "./keyStore";
import { PKCS8_ED25519_PREFIX } from "./recoveryKit";

const SEED_LEN = 32;

/** The device key of a seed, extractable so that the record can seal it. */
function deviceKeyOf(seed: Uint8Array): Promise<CryptoKey> {
  const pkcs8 = concat(PKCS8_ED25519_PREFIX, seed);
  return crypto.subtle
    .importKey("pkcs8", pkcs8, { name: "Ed25519" }, true, ["sign"])
    .finally(() => pkcs8.fill(0));
}

/**
 * Brings back a lost device key from its wrap under `share`, then wraps the device key under
 * `share` again.
 *
 * @returns Whether the record changed.
 */
async function rewrapDeviceSeed(record: BrowserKeyRecord, share: Uint8Array): Promise<boolean> {
  const wrapKey = await deviceKeyWrapKey(share, record.principalId);
  try {
    if (!record.deviceKey) {
      if (!record.deviceWrap) return false;
      let seed: Uint8Array;
      try {
        seed = await unwrapDeviceSeed(
          wrapKey,
          record.principalId,
          fromB64(record.deviceWrap, "the device key's wrap"),
        );
      } catch (err) {
        logger.warn("[RIM:keys] the device key's wrap did not open:", err);
        return false;
      }
      record.deviceKey = await deviceKeyOf(seed);
      seed.fill(0);
    }
    const pkcs8 = await privateKeyBytes(record.deviceKey);
    if (!pkcs8) return false;
    try {
      const seed = pkcs8.subarray(pkcs8.length - SEED_LEN);
      record.deviceWrap = toB64(await wrapDeviceSeed(wrapKey, record.principalId, seed));
    } finally {
      pkcs8.fill(0);
    }
    return true;
  } finally {
    wrapKey.fill(0);
  }
}

/**
 * Seals the account's key record under the data key the vault now holds. With the server
 * `share` this unlock saw, the device key's wrap is written again, and a device key sealed under
 * an earlier data key comes back from it; one whose wrap does not open stays lost. Keys sealed
 * under an earlier data key are dropped only when the unlock started empty; otherwise the record
 * stays as it was. Nothing happens unless the vault holds the account. A record that cannot be
 * sealed stays as it was and is sealed at a later unlock.
 *
 * @param share - The server share, 32 bytes, when the unlock followed a login or a signup.
 * @param startedEmpty - The unlock made a new data key: what was sealed under the earlier one is
 *   gone for good.
 * @returns `false` when the record's sealed keys did not open and the unlock did not start empty;
 *   `true` otherwise, also when there is no record or the write failed.
 */
export async function sealKeysAtUnlock(
  endpoint: string,
  principalId: string,
  share: Uint8Array | null,
  startedEmpty: boolean,
): Promise<boolean> {
  if (!vaultHolds(endpoint, principalId)) return true;
  let refused = false;
  try {
    await changeRecord(endpoint, principalId, async (record, stored) => {
      const plain = holdsUnsealedKeys(record, stored);
      // Sealed under an earlier data key: what it held did not open.
      const unopened = record.unopened !== undefined;
      if (unopened && !startedEmpty) {
        refused = true;
        return undefined;
      }
      const stale = record.confirmed && record.replaced !== undefined;
      const next = { ...record };
      if (unopened) delete next.unopened;
      if (stale) delete next.replaced;
      const rewrapped = share ? await rewrapDeviceSeed(next, share) : false;
      return plain || unopened || stale || rewrapped ? next : undefined;
    });
  } catch (err) {
    logger.warn("[RIM:keys] could not seal an account's keys at its unlock:", err);
  }
  return !refused;
}
