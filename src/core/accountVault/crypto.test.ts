import { describe, expect, it } from "vitest";

import { utf8 } from "../../features/key-identity/browser/bytes";
import {
  deviceKeyWrapKey,
  fromB64,
  open,
  openTransport,
  recoveryWrapKey,
  seal,
  toB64,
  UnauthenticError,
  unwrapDataKey,
  unwrapDeviceSeed,
  unwrapRewrap,
  webStoreKey,
  wrapDataKey,
} from "./crypto";

const PRINCIPAL = "rimp1_gCe9rL-U8tJXIPz_3ZZlu1yhaGJ6cv7zXgpTQjg9FUI";

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (text: string) =>
  Uint8Array.from(text.match(/../g) ?? [], (pair) => parseInt(pair, 16));
const filled = (length: number, byte: number) => new Uint8Array(length).fill(byte);

// The derivations the desktop's `rim_opaque` asserts in its own tests, from the same inputs.
const UNLOCK_KEY = "dab909ad5f58275d96715d167bd23bf9b30a3cd567446f57c49c67b71423fe6e";
const TRANSPORT_SERVER_SHARE = "ca8fab1028bbcf27ddfa98049a0c497eb71258628aabf13b16874e3ba22959e7";
const RECOVERY_WRAP_KEY = "7e1bf5365264e430df3d5af3bfd7024f5de77b80ac230bbfdb742decf70bcb3e";
const STORE_WEB = "d07ad1cdb29904ad5a2622f9cc73e3a50dd68665dd37bfaad0a4faec8602c7d4";

// Sealed independently with Python's `cryptography` (AES-256-GCM, nonce 00 01 … 0b).
const DEVICE_KEY_WRAP_KEY = "5065f83739e596250f269046b2a99f7979778d012df018c89b7b703b445dcd2c";
/** The data key 0x44… wrapped under the unlock key above, for the password. */
const PASSWORD_WRAP =
  "AAECAwQFBgcICQoLWRXl3edbO4n2E-_IKXnoDc8_lJfXtF5yTEqOAK5EtKCzt5qXCsUNngjp6Z_SOY_F";
/** The old unlock key 0x77… sealed under the unlock key above. */
const REWRAP = "AAECAwQFBgcICQoLaibW7tRoCLrFINz7GkrbPvwMp6Tkh21Bf3m9M513h5O2uWU9wrQhKAZwCpPXp1yv";
/** The device key seed 0x66… wrapped under the device key wrap key of the share 0x33…. */
const DEVICE_WRAP =
  "AAECAwQFBgcICQoL02vCupIa-Y1JE27fZ2G7398Ov-hN1_qBHEQBQNlFzcH62pnPiYGKX2q1Y3CnOggY";
/** The server share 0x33… sealed under the transport key above, as the server returns it. */
const SEALED_SHARE =
  "AAECAwQFBgcICQoL8el0UoM_0zlp4eFcc4MjAniFJLHVqUk1HN2VcteAl2weV5YI1BM4jQ9nylAFzmiP";

describe("the web account lock's keys", () => {
  it("derives the same keys as the desktop", async () => {
    expect(hex(await recoveryWrapKey(filled(16, 0x55)))).toBe(RECOVERY_WRAP_KEY);
    expect(hex(await webStoreKey(filled(32, 0x44)))).toBe(STORE_WEB);
    expect(hex(await deviceKeyWrapKey(filled(32, 0x33), PRINCIPAL))).toBe(DEVICE_KEY_WRAP_KEY);
  });

  it("opens what another implementation sealed, byte for byte", async () => {
    const unlockKey = fromHex(UNLOCK_KEY);
    expect(
      hex(await unwrapDataKey(unlockKey, "password", PRINCIPAL, fromB64(PASSWORD_WRAP, "w"))),
    ).toBe("44".repeat(32));
    expect(hex(await unwrapRewrap(unlockKey, PRINCIPAL, fromB64(REWRAP, "w")))).toBe(
      "77".repeat(32),
    );
    expect(
      hex(
        await unwrapDeviceSeed(fromHex(DEVICE_KEY_WRAP_KEY), PRINCIPAL, fromB64(DEVICE_WRAP, "w")),
      ),
    ).toBe("66".repeat(32));
    expect(hex(await openTransport(fromHex(TRANSPORT_SERVER_SHARE), SEALED_SHARE))).toBe(
      "33".repeat(32),
    );
  });

  it("binds a wrap to its kind and principal", async () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const dataKey = crypto.getRandomValues(new Uint8Array(32));
    const wrap = await wrapDataKey(key, "keep", PRINCIPAL, dataKey);
    expect(wrap).toHaveLength(12 + 32 + 16);
    expect(await unwrapDataKey(key, "keep", PRINCIPAL, wrap)).toEqual(dataKey);
    await expect(unwrapDataKey(key, "password", PRINCIPAL, wrap)).rejects.toBeInstanceOf(
      UnauthenticError,
    );
    await expect(unwrapDataKey(key, "keep", "rimp1_someone_else", wrap)).rejects.toBeInstanceOf(
      UnauthenticError,
    );
    expect(await open(key, utf8(`rim.dk.v1|keep|${PRINCIPAL}`), wrap)).toEqual(dataKey);
  });

  it("seals under a fresh nonce and refuses a changed or short value", async () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const sealed = await seal(key, utf8("aad"), utf8("the share"));
    expect(toB64(sealed)).not.toBe(toB64(await seal(key, utf8("aad"), utf8("the share"))));
    const altered = new Uint8Array(sealed);
    altered[20] ^= 1;
    await expect(open(key, utf8("aad"), altered)).rejects.toBeInstanceOf(UnauthenticError);
    await expect(open(key, utf8("aad"), sealed.subarray(0, 27))).rejects.toBeInstanceOf(
      UnauthenticError,
    );
    await expect(open(key, utf8("other"), sealed)).rejects.toBeInstanceOf(UnauthenticError);
  });
});
