import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import {
  initSync,
  OpaqueLogin,
  OpaqueRegistration,
  transportKey,
  unlockKey,
} from "./wasm/rim_opaque_wasm";
import { opaqueCode } from "./opaqueModule";

const PRINCIPAL = "rimp1_gCe9rL-U8tJXIPz_3ZZlu1yhaGJ6cv7zXgpTQjg9FUI";

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

function thrown(f: () => unknown): unknown {
  try {
    f();
  } catch (err) {
    return err;
  }
  return undefined;
}

describe("the committed OPAQUE module", () => {
  beforeAll(() => {
    initSync({
      module: readFileSync(
        join(process.cwd(), "src/features/auth/opaque/wasm/rim_opaque_wasm_bg.wasm"),
      ),
    });
  });

  it("derives the unlock key and the transport keys the server agrees on", () => {
    expect(
      hex(unlockKey(new Uint8Array(64).fill(0x22), new Uint8Array(32).fill(0x33), PRINCIPAL)),
    ).toBe("dab909ad5f58275d96715d167bd23bf9b30a3cd567446f57c49c67b71423fe6e");
    expect(hex(transportKey(new Uint8Array(64).fill(0x11), "server share"))).toBe(
      "ca8fab1028bbcf27ddfa98049a0c497eb71258628aabf13b16874e3ba22959e7",
    );
  });

  it("starts both flows with a request", () => {
    const registration = new OpaqueRegistration("a password");
    expect(registration.request()).toHaveLength(32);
    registration.free();
    const login = new OpaqueLogin("a password");
    expect(login.request()).toHaveLength(96);
    login.free();
  });

  it("throws errors named by their code", () => {
    expect(opaqueCode(thrown(() => transportKey(new Uint8Array(64), "keep")))).toBe(
      "OPAQUE_INVALID",
    );
    expect(
      opaqueCode(thrown(() => unlockKey(new Uint8Array(32), new Uint8Array(32), PRINCIPAL))),
    ).toBe("OPAQUE_INVALID");
    const login = new OpaqueLogin("a password");
    expect(opaqueCode(thrown(() => login.finish(new Uint8Array(10))))).toBe("OPAQUE_MALFORMED");
    expect(opaqueCode(thrown(() => login.finish(new Uint8Array(10))))).toBe("OPAQUE_USED");
    login.free();
    expect(opaqueCode(new Error("other"))).toBeUndefined();
  });
});
