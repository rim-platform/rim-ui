/**
 * The web app's MLS engine: `rim_mls` compiled to WebAssembly (`../wasm/`), loaded once per
 * page. A failed operation throws an `Error` whose `name` is its code (`E2EE_NO_GROUP`, …); a
 * panic inside the module traps instead, and the module is not used again in this page.
 */

import { logger } from "../../../core/logger";
import type * as Wasm from "../wasm/rim_mls_wasm";

export type MlsModule = typeof Wasm;
export type MlsEngine = Wasm.Engine;

let loading: Promise<MlsModule | null> | null = null;
let trapped = false;

/** The module, or `null` when this browser cannot run it. */
export function loadMls(): Promise<MlsModule | null> {
  if (trapped) return Promise.resolve(null);
  loading ??= (async () => {
    if (typeof WebAssembly === "undefined") return null;
    try {
      const mls = await import("../wasm/rim_mls_wasm");
      await mls.default();
      return mls;
    } catch (err) {
      logger.warn("[RIM:e2ee] the MLS module did not load:", err);
      return null;
    }
  })();
  return loading;
}

/** The code of an engine failure (`E2EE_…`), or `undefined` for anything else. */
export function mlsCode(err: unknown): string | undefined {
  return err instanceof Error && err.name.startsWith("E2EE_") ? err.name : undefined;
}

/** The epoch an `E2EE_AWAITING_READD` failure names. */
export function mlsEpoch(err: unknown): number | null {
  const epoch = (err as { epoch?: unknown } | null)?.epoch;
  return typeof epoch === "number" ? epoch : null;
}

/** Whether `err` is the module trapping (a Rust panic): its memory can no longer be trusted. */
export function isTrap(err: unknown): boolean {
  return typeof WebAssembly !== "undefined" && err instanceof WebAssembly.RuntimeError;
}

/** Stop using the module in this page after it trapped. */
export function noteTrap() {
  trapped = true;
  loading = null;
}
