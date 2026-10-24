/**
 * The account vault: the signed-in account's data key and the key derived from it that seals
 * what this app keeps for the account in IndexedDB ("web stores"), held in memory only while the
 * account is unlocked.
 *
 * A sealed value is `{ v: 1, iv, ct }`: AES-256-GCM under the store key with a random 12-byte
 * nonce, both base64url, authenticating the associated data its caller names. Ed25519 private
 * keys are wrapped the same way, as pkcs8, and unwrapped as non-extractable keys; the vault
 * remembers which wrap each unwrapped key came from, so it can be written again without ever
 * being extractable.
 */

import { useSyncExternalStore } from "react";

import { utf8 } from "../../features/key-identity/browser/bytes";
import { logger } from "../logger";
import { aesKey, fromB64, toB64, webStoreKey } from "./crypto";

/** The account whose keys the vault holds. */
export interface VaultAccount {
  /** The GraphQL endpoint, as the key store writes it. */
  endpoint: string;
  principalId: string;
}

/** A value sealed under the store key. */
export interface SealedValue {
  v: 1;
  /** The 12-byte nonce, base64url. */
  iv: string;
  /** Ciphertext and tag, base64url. */
  ct: string;
}

/** What the vault says while nothing is unlocked. */
export const VAULT_LOCKED = "VAULT_LOCKED";

/** The account is locked: nothing it sealed opens and nothing is sealed for it. */
export class VaultLockedError extends Error {
  constructor() {
    super("this account is locked on this device; sign in to unlock it");
    this.name = VAULT_LOCKED;
  }
}

/** The vault as the interface reads it. */
export interface VaultSnapshot {
  /** The unlocked account, once everything that opens with it is ready; else `null`. */
  account: VaultAccount | null;
}

type UnlockHook = (account: VaultAccount) => Promise<void> | void;
type LockHook = (account: VaultAccount) => void;

interface Held {
  account: VaultAccount;
  dataKey: Uint8Array | null;
  storeKey: CryptoKey;
}

const STORE_USAGES: KeyUsage[] = ["encrypt", "decrypt", "wrapKey", "unwrapKey"];

let held: Held | null = null;
let snapshot: VaultSnapshot = { account: null };
/** Counts unlocks and locks, so an unlock overtaken by a lock does not finish. */
let generation = 0;
const listeners = new Set<() => void>();
const unlockHooks = new Set<UnlockHook>();
const lockHooks = new Set<LockHook>();
/** Each unwrapped key's wrap: its associated data and sealed pkcs8. */
let wrapsOf = new WeakMap<CryptoKey, { aad: string; sealed: SealedValue }>();

function publish(next: VaultSnapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

function sameAccount(a: VaultAccount, b: VaultAccount): boolean {
  return a.endpoint === b.endpoint && a.principalId === b.principalId;
}

/**
 * Runs `hook` after each unlock, before the vault reads as unlocked: what the vault seals
 * already opens while it runs. A failing hook is logged and does not stop the unlock.
 *
 * @returns A function that removes the hook.
 */
export function onVaultUnlock(hook: UnlockHook): () => void {
  unlockHooks.add(hook);
  return () => unlockHooks.delete(hook);
}

/**
 * Runs `hook` at each lock, after the keys left memory.
 *
 * @returns A function that removes the hook.
 */
export function onVaultLock(hook: LockHook): () => void {
  lockHooks.add(hook);
  return () => lockHooks.delete(hook);
}

async function hold(account: VaultAccount, dataKey: Uint8Array | null, storeKeyRaw: Uint8Array) {
  if (held && !sameAccount(held.account, account)) lockVault();
  const turn = ++generation;
  const storeKey = await aesKey(storeKeyRaw, STORE_USAGES);
  storeKeyRaw.fill(0);
  if (turn !== generation) return;
  held?.dataKey?.fill(0);
  wrapsOf = new WeakMap();
  const mine: Held = {
    account: { ...account },
    dataKey: dataKey && new Uint8Array(dataKey),
    storeKey,
  };
  held = mine;
  for (const hook of unlockHooks) {
    try {
      await hook(mine.account);
    } catch (err) {
      logger.warn("[RIM:vault] a step after unlocking failed:", err);
    }
    if (turn !== generation) return;
  }
  publish({ account: mine.account });
}

/**
 * Unlocks `account` with its data key: derives the store key, runs the unlock hooks, then
 * reads as unlocked. Another account held before is locked first.
 *
 * @param dataKey - The account's 32-byte data key; the vault keeps its own copy.
 */
export async function unlockVault(account: VaultAccount, dataKey: Uint8Array): Promise<void> {
  await hold(account, dataKey, await webStoreKey(dataKey));
}

/**
 * Unlocks `account` with the store key alone, as the desktop app hands it to the webview: the
 * data key itself stays in the desktop's process.
 *
 * @param storeKey - The 32-byte "web stores" key; wiped once imported.
 */
export async function unlockVaultWithStoreKey(
  account: VaultAccount,
  storeKey: Uint8Array,
): Promise<void> {
  await hold(account, null, new Uint8Array(storeKey));
}

/** Locks the vault: the keys leave memory, then the lock hooks run. Locking twice is harmless. */
export function lockVault(): void {
  generation += 1;
  const was = held;
  if (!was) return;
  was.dataKey?.fill(0);
  held = null;
  wrapsOf = new WeakMap();
  publish({ account: null });
  for (const hook of lockHooks) {
    try {
      hook(was.account);
    } catch (err) {
      logger.warn("[RIM:vault] a step after locking failed:", err);
    }
  }
}

/** Whether an account is unlocked and ready. */
export function isVaultUnlocked(): boolean {
  return snapshot.account !== null;
}

/** Whether the vault holds the keys of this account, ready or still running its unlock hooks. */
export function vaultHolds(endpoint: string, principalId: string): boolean {
  return held?.account.endpoint === endpoint && held.account.principalId === principalId;
}

/** The account whose keys the vault holds, ready or not. */
export function vaultAccount(): VaultAccount | null {
  return held ? { ...held.account } : null;
}

/**
 * A copy of the unlocked account's data key; `null` while locked, or on the desktop, where the
 * vault holds only the store key. The caller wipes it.
 */
export function vaultDataKey(): Uint8Array | null {
  return held?.dataKey ? new Uint8Array(held.dataKey) : null;
}

function storeKey(): CryptoKey {
  if (!held) throw new VaultLockedError();
  return held.storeKey;
}

function params(iv: Uint8Array<ArrayBuffer>, aad: string): AesGcmParams {
  return { name: "AES-GCM", iv, additionalData: utf8(aad) };
}

function sealedOf(iv: Uint8Array, ct: ArrayBuffer): SealedValue {
  return { v: 1, iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}

/** Whether `value` has the shape of a {@link SealedValue}. */
export function isSealed(value: unknown): value is SealedValue {
  const v = value as Partial<SealedValue> | null;
  return (
    typeof v === "object" &&
    v !== null &&
    v.v === 1 &&
    typeof v.iv === "string" &&
    typeof v.ct === "string"
  );
}

/**
 * Seals `value`, as JSON, under the store key.
 *
 * @param aad - What the value is bound to: opening it under other associated data fails.
 * @throws VaultLockedError while locked.
 */
export async function sealValue(value: unknown, aad: string): Promise<SealedValue> {
  const key = storeKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(params(iv, aad), key, utf8(JSON.stringify(value)));
  return sealedOf(iv, ct);
}

async function openBytes(sealed: SealedValue, aad: string): Promise<Uint8Array> {
  const key = storeKey();
  const plain = await crypto.subtle.decrypt(
    params(fromB64(sealed.iv, "a sealed value's nonce"), aad),
    key,
    fromB64(sealed.ct, "a sealed value"),
  );
  return new Uint8Array(plain);
}

/**
 * Opens a value {@link sealValue} sealed under the same `aad`.
 *
 * @returns The value, or `null` when it does not open: sealed under another data key, bound to
 *   other associated data, or damaged.
 * @throws VaultLockedError while locked.
 */
export async function openValue<T>(sealed: SealedValue, aad: string): Promise<T | null> {
  try {
    return JSON.parse(new TextDecoder().decode(await openBytes(sealed, aad))) as T;
  } catch (err) {
    if (err instanceof VaultLockedError) throw err;
    return null;
  }
}

/**
 * Wraps an Ed25519 private key under the store key, as pkcs8. An extractable key is wrapped
 * afresh; a key {@link unwrapCryptoKey} gave keeps its wrap, sealed again under `aad` when that
 * changed.
 *
 * @throws VaultLockedError while locked; Error for a non-extractable key the vault did not
 *   unwrap.
 */
export async function wrapCryptoKey(key: CryptoKey, aad: string): Promise<SealedValue> {
  const wrapping = storeKey();
  const known = wrapsOf.get(key);
  if (known?.aad === aad) return known.sealed;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  let sealed: SealedValue;
  if (key.extractable) {
    sealed = sealedOf(iv, await crypto.subtle.wrapKey("pkcs8", key, wrapping, params(iv, aad)));
  } else if (known) {
    const pkcs8 = await openBytes(known.sealed, known.aad);
    try {
      sealed = sealedOf(iv, await crypto.subtle.encrypt(params(iv, aad), wrapping, pkcs8));
    } finally {
      pkcs8.fill(0);
    }
  } else {
    throw new Error("this key cannot be stored: it was made unexportable outside the vault");
  }
  return sealed;
}

/**
 * Unwraps a key {@link wrapCryptoKey} wrapped, as a non-extractable Ed25519 key.
 *
 * @param usages - What the key may do, `["sign"]` for a private key.
 * @returns The key, or `null` when the wrap does not open.
 * @throws VaultLockedError while locked.
 */
export async function unwrapCryptoKey(
  sealed: SealedValue,
  aad: string,
  usages: KeyUsage[],
): Promise<CryptoKey | null> {
  const wrapping = storeKey();
  try {
    const key = await crypto.subtle.unwrapKey(
      "pkcs8",
      fromB64(sealed.ct, "a wrapped key"),
      wrapping,
      params(fromB64(sealed.iv, "a wrapped key's nonce"), aad),
      { name: "Ed25519" },
      false,
      usages,
    );
    wrapsOf.set(key, { aad, sealed });
    return key;
  } catch {
    return null;
  }
}

/**
 * The pkcs8 bytes of an Ed25519 private key: exported when it is extractable, opened from its
 * wrap when the vault unwrapped it. The caller wipes them.
 *
 * @returns The bytes, or `null` for a non-extractable key the vault did not unwrap.
 * @throws VaultLockedError while locked and the key is not extractable.
 */
export async function privateKeyBytes(key: CryptoKey): Promise<Uint8Array | null> {
  if (key.extractable) return new Uint8Array(await crypto.subtle.exportKey("pkcs8", key));
  const known = wrapsOf.get(key);
  return known ? openBytes(known.sealed, known.aad) : null;
}

/**
 * Be told when the vault becomes ready or locks.
 *
 * @returns A function that stops telling `listener`.
 */
export function subscribeVault(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The vault, read again whenever it becomes ready or locks. */
export function useAccountVault(): VaultSnapshot {
  return useSyncExternalStore(subscribeVault, () => snapshot);
}
