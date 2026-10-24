/**
 * The web app's account password check: `rim_opaque` compiled to WebAssembly (`./wasm/`),
 * loaded on first use by the screens that ask for the password (sign-in, signup, change and
 * reset), never at start. A failed step throws an `Error` whose `name` is its code
 * (`OPAQUE_WRONG_PASSWORD`, …).
 */

import type * as Wasm from "./wasm/rim_opaque_wasm";

export type OpaqueModule = typeof Wasm;
export type OpaqueRegistration = Wasm.OpaqueRegistration;
export type OpaqueLogin = Wasm.OpaqueLogin;

let loading: Promise<OpaqueModule> | null = null;

/**
 * The module, loaded and initialized once per page. A load that fails is tried again on the
 * next call.
 *
 * @returns The module's exports.
 */
export function loadOpaque(): Promise<OpaqueModule> {
  loading ??= (async () => {
    const opaque = await import("./wasm/rim_opaque_wasm");
    await opaque.default();
    return opaque;
  })().catch((err: unknown) => {
    loading = null;
    throw err;
  });
  return loading;
}

/**
 * The code of a failed step (`OPAQUE_…`), or `undefined` for anything else.
 *
 * @param err - What the step threw.
 */
export function opaqueCode(err: unknown): string | undefined {
  return err instanceof Error && err.name.startsWith("OPAQUE_") ? err.name : undefined;
}
