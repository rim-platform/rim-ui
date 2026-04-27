/**
 * safeInvoke — typed Tauri IPC wrapper with discriminated-union error narrowing.
 *
 * Replaces the duplicated try/catch + swallow pattern scattered across plugin
 * API hooks. Callers get a Result<T, SafeInvokeError> and can distinguish
 * error variants without brittle string-matching.
 *
 * Tauri 2 error shapes observed in this codebase:
 *   - IPC unavailable (web mode): invoke() itself is not present / window.__TAURI_INTERNALS__
 *     is absent — detected before the call.
 *   - Permission denied: Tauri capability system rejects the command. Tauri 2 serialises
 *     these as a plain string: "Command foo not allowed by capability".
 *   - Invalid args: Rust serde rejects the payload. Typically a plain string:
 *     "invalid type: …" or a structured object with `field`.
 *   - Backend error (Rust returned Err): Commands in this repo use `LifecycleError` / custom
 *     enums that serialize as `{ kind: "SCREAMING_SNAKE", message?: string, data?: unknown }`.
 *     usePluginAiConsent.ts documented this shape via `PluginCommandError`.
 *
 * The narrower inspects the raw thrown value and maps it to the union below.
 * Unknown shapes fall through to `backend_error` with a stringified message so
 * nothing is silently swallowed.
 */

import { isTauri, invoke } from "@tauri-apps/api/core";
import type { InvokeArgs } from "@tauri-apps/api/core";

// Hoisted at module scope — Map is immune to prototype-pollution unlike plain object.
const STATIC_ERROR_CODES = new Map<string, string>([
  ["not found", "NOT_FOUND"],
  ["dependency unavailable", "DEPENDENCY_UNAVAILABLE"],
  ["dependency timed out", "DEPENDENCY_TIMED_OUT"],
  ["internal error", "INTERNAL_ERROR"],
]);

// ─── Result type ────────────────────────────────────────────────────────────

export type SafeInvokeOk<T> = { ok: true; value: T };
export type SafeInvokeErr = { ok: false; error: SafeInvokeError };
export type SafeInvokeResult<T> = SafeInvokeOk<T> | SafeInvokeErr;

// ─── Discriminated-union error type ─────────────────────────────────────────

/**
 * Discriminated union of all failure modes for a safeInvoke call.
 *
 * - `ipc_unavailable` — running in web mode; window.__TAURI_INTERNALS__ absent.
 * - `permission_denied` — Tauri capability system blocked the command.
 * - `invalid_args` — Rust/serde rejected the arguments; optionally names the field.
 * - `rate_limited` — server-side rate limit hit; `retryAfterMs` gives the backoff duration.
 * - `confirmation_stale` — confirmation token expired or already used; caller should re-prompt.
 * - `backend_error` — Rust command returned an Err; carries a structured code + message.
 *
 * TODO(P8-FE-04): `rate_limited.retryAfterMs` and `confirmation_stale` are consumed by
 * ConfirmCommandModal / rate-limit banner in Phase 4. Until then callers fall back to
 * generic error rendering.
 */
export type SafeInvokeError =
  | { kind: "ipc_unavailable"; message: string }
  | { kind: "permission_denied"; message: string }
  | { kind: "invalid_args"; message: string; field?: string }
  | { kind: "rate_limited"; retryAfterMs: number; message: string }
  | { kind: "confirmation_stale"; message: string }
  | { kind: "backend_error"; code: string; message: string };

// ─── Shape guards ───────────────────────────────────────────────────────────

/** Tauri 2 backend errors serialised from Rust Err variants. */
interface TauriBackendErrorShape {
  kind: string;
  message?: string;
  data?: unknown;
  field?: string;
}

function isTauriBackendErrorShape(err: unknown): err is TauriBackendErrorShape {
  return (
    typeof err === "object" &&
    err !== null &&
    "kind" in err &&
    typeof (err as Record<string, unknown>)["kind"] === "string"
  );
}

/**
 * Narrow an unknown caught value into a SafeInvokeError variant.
 *
 * Decision tree:
 *   1. Structured object with `kind` → backend_error (Rust Err serialisation).
 *   2. Plain string from the Tauri IPC capability layer ("not allowed", "explicitly denied").
 *   3. Plain string matching a canonical Rust ServiceError display string (exact prefix/whole-word).
 *   4. Plain string matching serde deserialisation error prefixes ("invalid type:", "missing field").
 *   5. Everything else → backend_error with a stringified message.
 *
 * Canonical ServiceError strings are from rim_services/src/lib.rs #[error(...)] attributes.
 * Serde error strings are from the serde_json deserialiser.
 * Tauri IPC capability strings are from tauri/src/ipc/authority.rs.
 */
function narrowError(err: unknown): SafeInvokeError {
  // Rust structured error: { kind, message?, field?, data? }
  if (isTauriBackendErrorShape(err)) {
    const code = err.kind;
    const message = typeof err.message === "string" ? err.message : JSON.stringify(err);
    // permission-class backend codes
    if (
      code === "PERMISSION_DENIED" ||
      code === "CAPABILITY_MISSING" ||
      code === "UNAUTHORIZED"
    ) {
      return { kind: "permission_denied", message };
    }
    // invalid-args-class backend codes
    if (code === "INVALID_ARGS" || code === "INVALID_MANIFEST" || code === "SCHEMA_VALIDATION") {
      const field = typeof err.field === "string" ? err.field : undefined;
      return { kind: "invalid_args", message, field };
    }
    // Rate-limited: structured variant carries retry_after_ms (u64 from Rust, i64 in JSON).
    if (code === "RATE_LIMITED") {
      const raw = (err as unknown as Record<string, unknown>)["retry_after_ms"];
      const retryAfterMs = typeof raw === "number" ? raw : 0;
      return { kind: "rate_limited", retryAfterMs, message };
    }
    // Confirmation token expired — caller should re-prompt.
    if (code === "CONFIRMATION_STALE") {
      return { kind: "confirmation_stale", message };
    }
    // Everything else with a structured shape → backend_error
    return { kind: "backend_error", code, message };
  }

  // Plain string path — checked in specificity order
  if (typeof err === "string") {
    // Tauri IPC capability layer strings (authority.rs):
    //   "… not allowed …", "… explicitly denied on origin …"
    // These are variable-format strings generated by the Tauri framework itself.
    if (err.includes("not allowed") || err.includes("explicitly denied")) {
      return { kind: "permission_denied", message: err };
    }

    // Canonical Rust ServiceError display strings (rim_services/src/lib.rs).
    // Exact whole-word or startsWith matches — no substring guessing.
    if (err === "permission denied" || err === "unauthenticated") {
      return { kind: "permission_denied", message: err };
    }
    if (err.startsWith("validation error:")) {
      return { kind: "invalid_args", message: err };
    }
    if (err.startsWith("conflict:")) {
      return { kind: "backend_error", code: "CONFLICT", message: err };
    }
    const staticCode = STATIC_ERROR_CODES.get(err);
    if (staticCode !== undefined) {
      return { kind: "backend_error", code: staticCode, message: err };
    }
    if (err.startsWith("confirmation proof is stale") || err.startsWith("confirmation failed:")) {
      // TODO(P8-FE-04): `confirmation_stale` consumed by ConfirmCommandModal in Phase 4.
      return { kind: "confirmation_stale", message: err };
    }
    if (err.startsWith("rate limit exceeded")) {
      // Parse "rate limit exceeded; retry after {N}s" — extract N in milliseconds.
      // TODO(P8-FE-04): `retryAfterMs` consumed by rate-limit banner/backoff in Phase 4.
      const match = /retry after (\d+)s/.exec(err);
      const retryAfterMs = match ? parseInt(match[1], 10) * 1000 : 0;
      return { kind: "rate_limited", retryAfterMs, message: err };
    }

    // Serde deserialisation error prefixes (from serde_json output format):
    //   "invalid type: …", "missing field `…`", "unknown field `…`"
    // These are anchored to well-known serde_json format strings, not loose "invalid" substrings.
    if (
      err.startsWith("invalid type:") ||
      err.startsWith("missing field") ||
      err.startsWith("unknown field")
    ) {
      return { kind: "invalid_args", message: err };
    }

    // Unknown string — treat as backend_error
    return { kind: "backend_error", code: "UNKNOWN", message: err };
  }

  // Error instance or other JS value
  const message = err instanceof Error ? err.message : String(err);
  return { kind: "backend_error", code: "UNKNOWN", message };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Invoke a Tauri command and return a typed Result instead of throwing.
 *
 * On success: `{ ok: true, value: T }`
 * On failure: `{ ok: false, error: SafeInvokeError }` — never throws.
 *
 * @example
 * ```ts
 * const result = await safeInvoke<PluginInfo[]>("plugin_list", {});
 * if (!result.ok) {
 *   if (result.error.kind === "ipc_unavailable") return MOCK_DATA;
 *   logger.warn("plugin_list failed:", result.error);
 *   return [];
 * }
 * return result.value;
 * ```
 */
export async function safeInvoke<T>(
  command: string,
  args: InvokeArgs = {},
): Promise<SafeInvokeResult<T>> {
  // Check IPC availability before invoking — avoids a confusing "command not found"
  // error in web mode when the user never has Tauri at all.
  if (!isTauri()) {
    return {
      ok: false,
      error: { kind: "ipc_unavailable", message: `IPC not available (web mode) — command: ${command}` },
    };
  }

  try {
    const value = await invoke<T>(command, args);
    return { ok: true, value };
  } catch (err) {
    return { ok: false, error: narrowError(err) };
  }
}

/**
 * Convenience helper: same as safeInvoke but re-throws SafeInvokeError instead
 * of returning it. Use this when the call site already has its own error boundary
 * (e.g. TanStack Query's mutationFn) and needs to throw rather than check the Result.
 *
 * Filters `ipc_unavailable` errors by default (treats them as a no-op in web mode).
 * Pass `throwOnUnavailable: true` to override.
 */
export async function safeInvokeOrThrow<T>(
  command: string,
  args: InvokeArgs = {},
  options: { throwOnUnavailable?: boolean } = {},
): Promise<T | undefined> {
  const result = await safeInvoke<T>(command, args);
  if (result.ok) return result.value;

  const { error } = result;
  if (error.kind === "ipc_unavailable" && !options.throwOnUnavailable) {
    // Web-mode no-op — callers that need fallback data handle it after the call.
    return undefined;
  }
  throw error;
}
