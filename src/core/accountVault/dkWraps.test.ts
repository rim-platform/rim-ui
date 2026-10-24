import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";

import { utf8 } from "../../features/key-identity/browser/bytes";
import { fromB64, open, seal, toB64 } from "./crypto";
import {
  addRecoveryWrap,
  dropKeepWrap,
  NeedsRecoveryError,
  openAfterLogin,
  openKept,
  openWithRecovery,
  readWraps,
  setKeepWrap,
  wrapsAfterSignup,
} from "./dkWraps";

const ENDPOINT = "http://localhost:8080/api/";
const PRINCIPAL = "rimp1_a";

const random = () => crypto.getRandomValues(new Uint8Array(32));

/** The rewrap a password change leaves at the server: the old unlock key under the new one. */
async function rewrap(newKey: Uint8Array, oldKey: Uint8Array): Promise<string> {
  return toB64(await seal(newKey, utf8(`rim.uk-rewrap.v1|${PRINCIPAL}`), oldKey));
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe("the data key wraps", () => {
  it("make a data key at the first unlock and open the same one at the next", async () => {
    const unlockKey = random();
    const first = await openAfterLogin(ENDPOINT, PRINCIPAL, unlockKey, []);
    expect(first.startedEmpty).toBe(true);
    const stored = await readWraps(ENDPOINT, PRINCIPAL);
    expect(stored).toMatchObject({ endpoint: "http://localhost:8080/api", principalId: PRINCIPAL });
    // The wrap is AES-256-GCM under the unlock key, bound to its kind and principal.
    expect(
      await open(
        unlockKey,
        utf8(`rim.dk.v1|password|${PRINCIPAL}`),
        fromB64(stored?.passwordWrap ?? "", "wrap"),
      ),
    ).toEqual(first.dataKey);

    const again = await openAfterLogin(ENDPOINT, PRINCIPAL, unlockKey, []);
    expect(again).toEqual({ dataKey: first.dataKey, startedEmpty: false });
  });

  it("open through the rewraps of password changes and wrap under the newest key", async () => {
    const [k1, k2, k3] = [random(), random(), random()];
    const { dataKey } = await openAfterLogin(ENDPOINT, PRINCIPAL, k1, []);
    const rewraps = [await rewrap(k3, k2), await rewrap(k2, k1), "not base64url!"];
    expect(await openAfterLogin(ENDPOINT, PRINCIPAL, k3, rewraps)).toEqual({
      dataKey,
      startedEmpty: false,
    });
    expect(await openAfterLogin(ENDPOINT, PRINCIPAL, k3, [])).toEqual({
      dataKey,
      startedEmpty: false,
    });
  });

  it("ask for the recovery phrase instead of starting empty when a recovery wrap exists", async () => {
    const entropy = crypto.getRandomValues(new Uint8Array(16));
    const dataKey = await wrapsAfterSignup(ENDPOINT, PRINCIPAL, random(), entropy);
    const before = await readWraps(ENDPOINT, PRINCIPAL);
    const otherKey = random();

    await expect(openAfterLogin(ENDPOINT, PRINCIPAL, otherKey, [])).rejects.toBeInstanceOf(
      NeedsRecoveryError,
    );
    expect(await readWraps(ENDPOINT, PRINCIPAL)).toEqual(before);

    // The phrase opens the data key; the login then wraps it under its unlock key.
    const recovered = await openWithRecovery(ENDPOINT, PRINCIPAL, entropy);
    expect(recovered).toEqual(dataKey);
    expect(await openAfterLogin(ENDPOINT, PRINCIPAL, otherKey, [], { held: recovered })).toEqual({
      dataKey,
      startedEmpty: false,
    });
    expect((await readWraps(ENDPOINT, PRINCIPAL))?.recoveryWrap).toBe(before?.recoveryWrap);
    expect(await openWithRecovery(ENDPOINT, PRINCIPAL, new Uint8Array(16))).toBeNull();
  });

  it("start empty when asked, or when no recovery wrap exists", async () => {
    const entropy = crypto.getRandomValues(new Uint8Array(16));
    const dataKey = await wrapsAfterSignup(ENDPOINT, PRINCIPAL, random(), entropy);
    const fresh = await openAfterLogin(ENDPOINT, PRINCIPAL, random(), [], { startEmpty: true });
    expect(fresh.startedEmpty).toBe(true);
    expect(fresh.dataKey).not.toEqual(dataKey);
    expect((await readWraps(ENDPOINT, PRINCIPAL))?.recoveryWrap).toBeUndefined();

    const again = await openAfterLogin(ENDPOINT, PRINCIPAL, random(), []);
    expect(again.startedEmpty).toBe(true);
  });

  it("keep a session's wrap until the next login or until it is dropped", async () => {
    const unlockKey = random();
    const { dataKey } = await openAfterLogin(ENDPOINT, PRINCIPAL, unlockKey, []);
    const keepKey = random();
    expect(await openKept(ENDPOINT, PRINCIPAL, keepKey)).toBeNull();
    await setKeepWrap(ENDPOINT, PRINCIPAL, dataKey, keepKey);
    expect(await openKept(ENDPOINT, PRINCIPAL, keepKey)).toEqual(dataKey);
    expect(await openKept(ENDPOINT, PRINCIPAL, random())).toBeNull();

    await dropKeepWrap(ENDPOINT, PRINCIPAL);
    expect(await openKept(ENDPOINT, PRINCIPAL, keepKey)).toBeNull();

    await setKeepWrap(ENDPOINT, PRINCIPAL, dataKey, keepKey);
    await openAfterLogin(ENDPOINT, PRINCIPAL, unlockKey, []);
    expect(await openKept(ENDPOINT, PRINCIPAL, keepKey)).toBeNull();
  });

  it("add a recovery wrap on a browser that now holds the phrase", async () => {
    const { dataKey } = await openAfterLogin(ENDPOINT, PRINCIPAL, random(), []);
    const entropy = crypto.getRandomValues(new Uint8Array(16));
    expect(await openWithRecovery(ENDPOINT, PRINCIPAL, entropy)).toBeNull();
    await addRecoveryWrap(ENDPOINT, PRINCIPAL, dataKey, entropy);
    expect(await openWithRecovery(ENDPOINT, PRINCIPAL, entropy)).toEqual(dataKey);
  });
});
