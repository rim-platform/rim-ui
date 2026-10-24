import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isVaultUnlocked,
  lockVault,
  onVaultLock,
  onVaultUnlock,
  openValue,
  privateKeyBytes,
  sealValue,
  unlockVault,
  unlockVaultWithStoreKey,
  unwrapCryptoKey,
  vaultDataKey,
  vaultHolds,
  VaultLockedError,
  wrapCryptoKey,
} from "./accountVault";
import { webStoreKey } from "./crypto";

const ACCOUNT = { endpoint: "http://localhost:8080/api", principalId: "rimp1_a" };
const DATA_KEY = new Uint8Array(32).fill(0x44);

async function signingPair(): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
}

afterEach(() => lockVault());

describe("the account vault", () => {
  it("seals nothing and opens nothing while locked", async () => {
    expect(isVaultUnlocked()).toBe(false);
    await expect(sealValue({ a: 1 }, "aad")).rejects.toBeInstanceOf(VaultLockedError);
    await unlockVault(ACCOUNT, DATA_KEY);
    const sealed = await sealValue({ a: 1 }, "aad");
    lockVault();
    await expect(openValue(sealed, "aad")).rejects.toBeInstanceOf(VaultLockedError);
    expect(vaultDataKey()).toBeNull();
  });

  it("opens a value only under its associated data and data key", async () => {
    await unlockVault(ACCOUNT, DATA_KEY);
    const sealed = await sealValue({ text: "secret" }, "rim-e2ee/messages/[1]");
    expect(JSON.stringify(sealed)).not.toContain("secret");
    expect(await openValue(sealed, "rim-e2ee/messages/[1]")).toEqual({ text: "secret" });
    expect(await openValue(sealed, "rim-e2ee/messages/[2]")).toBeNull();
    await unlockVault(ACCOUNT, new Uint8Array(32).fill(1));
    expect(await openValue(sealed, "rim-e2ee/messages/[1]")).toBeNull();
  });

  it("opens with the store key alone what the data key sealed, as the desktop hands it over", async () => {
    await unlockVault(ACCOUNT, DATA_KEY);
    const sealed = await sealValue("kept", "aad");
    await unlockVaultWithStoreKey(ACCOUNT, await webStoreKey(DATA_KEY));
    expect(await openValue(sealed, "aad")).toBe("kept");
    expect(vaultDataKey()).toBeNull();
  });

  it("wraps a key and unwraps it non-extractable, and can wrap that key again", async () => {
    await unlockVault(ACCOUNT, DATA_KEY);
    const pair = await signingPair();
    const wrapped = await wrapCryptoKey(pair.privateKey, "first");
    const key = await unwrapCryptoKey(wrapped, "first", ["sign"]);
    if (!key) throw new Error("the wrap did not open");
    expect(key.extractable).toBe(false);
    const data = new TextEncoder().encode("signed");
    const signature = await crypto.subtle.sign("Ed25519", key, data);
    expect(await crypto.subtle.verify("Ed25519", pair.publicKey, signature, data)).toBe(true);

    expect(await wrapCryptoKey(key, "first")).toEqual(wrapped);
    const moved = await wrapCryptoKey(key, "second");
    expect(await unwrapCryptoKey(moved, "first", ["sign"])).toBeNull();
    expect(await unwrapCryptoKey(moved, "second", ["sign"])).not.toBeNull();
    expect(await privateKeyBytes(key)).toEqual(
      new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey)),
    );

    const stranger = (
      (await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign"])) as CryptoKeyPair
    ).privateKey;
    await expect(wrapCryptoKey(stranger, "first")).rejects.toThrow(/cannot be stored/);
  });

  it("runs the unlock hooks before it reads as unlocked, and the lock hooks after", async () => {
    const seen: string[] = [];
    const offUnlock = onVaultUnlock(async (account) => {
      seen.push(
        `unlock ${account.principalId} ${isVaultUnlocked()} ${vaultHolds(ACCOUNT.endpoint, "rimp1_a")}`,
      );
    });
    const offLock = onVaultLock(() => seen.push(`lock ${isVaultUnlocked()}`));
    await unlockVault(ACCOUNT, DATA_KEY);
    expect(isVaultUnlocked()).toBe(true);
    lockVault();
    lockVault();
    offUnlock();
    offLock();
    expect(seen).toEqual(["unlock rimp1_a false true", "lock false"]);
  });

  it("does not finish an unlock that a lock overtook", async () => {
    const hook = vi.fn(async () => {
      lockVault();
    });
    const off = onVaultUnlock(hook);
    await unlockVault(ACCOUNT, DATA_KEY);
    off();
    expect(hook).toHaveBeenCalledTimes(1);
    expect(isVaultUnlocked()).toBe(false);
  });
});
