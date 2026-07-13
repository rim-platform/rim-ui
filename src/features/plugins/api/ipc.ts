/**
 * Plugin IPC shim — re-exports the central safeInvoke with plugin-specific
 * type aliases for backwards compatibility.
 *
 * All error narrowing logic lives in src/core/tauri/safeInvoke.ts.
 */

import { safeInvokeOrThrow } from "../../../core/tauri/safeInvoke";
import type { SafeInvokeError } from "../../../core/tauri/safeInvoke";

/**
 * Plugin-specific error type alias — structurally identical to SafeInvokeError.
 * Exported for TanStack Query mutation error typing in plugin hooks.
 */
export type PluginIpcError = SafeInvokeError;

/**
 * Invoke a Tauri command for plugin operations.
 *
 * - Returns `undefined` on success.
 * - Throws `PluginIpcError` on typed backend failures (permission_denied, invalid_args, backend_error).
 * - Silently swallows `ipc_unavailable` errors (web mode / dev without Tauri runtime).
 */
export async function safeInvoke(command: string, args: Record<string, unknown>): Promise<void> {
  await safeInvokeOrThrow<void>(command, args);
}
