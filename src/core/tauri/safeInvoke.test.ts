/**
 * Unit tests for safeInvoke error narrowing.
 *
 * Tests feed typical Tauri error shapes directly into safeInvoke and assert
 * each maps to the correct SafeInvokeError variant. isTauri() and invoke()
 * are mocked via vi.mock so no real IPC is involved.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @tauri-apps/api/core before importing safeInvoke
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: vi.fn(),
  invoke: vi.fn(),
}));

import { safeInvoke } from "./safeInvoke";
import type { SafeInvokeError } from "./safeInvoke";
import * as tauriCore from "@tauri-apps/api/core";

// Typed references to the mocked functions
const mockIsTauri = vi.mocked(tauriCore.isTauri);
const mockInvoke = vi.mocked(tauriCore.invoke);

// ─── Helpers ────────────────────────────────────────────────────────────────

function assertError(
  result: Awaited<ReturnType<typeof safeInvoke>>,
  expectedKind: SafeInvokeError["kind"],
): SafeInvokeError {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected error result");
  expect(result.error.kind).toBe(expectedKind);
  return result.error;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("safeInvoke", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ── ipc_unavailable ────────────────────────────────────────────────────

  describe("ipc_unavailable", () => {
    it("returns ipc_unavailable when isTauri() is false (web mode)", async () => {
      mockIsTauri.mockReturnValue(false);

      const result = await safeInvoke("plugin_list", {});

      const error = assertError(result, "ipc_unavailable");
      expect(error.kind).toBe("ipc_unavailable");
      expect((error as Extract<SafeInvokeError, { kind: "ipc_unavailable" }>).message).toContain("plugin_list");
      // invoke() must NOT be called — we bail before the IPC call
      expect(mockInvoke).not.toHaveBeenCalled();
    });
  });

  // ── permission_denied ─────────────────────────────────────────────────

  describe("permission_denied", () => {
    beforeEach(() => {
      mockIsTauri.mockReturnValue(true);
    });

    it("maps structured PERMISSION_DENIED backend error", async () => {
      mockInvoke.mockRejectedValue({ kind: "PERMISSION_DENIED", message: "capability missing" });

      const result = await safeInvoke("plugin_approve_capabilities", { pluginId: "x", capabilities: [] });

      const error = assertError(result, "permission_denied");
      expect((error as Extract<SafeInvokeError, { kind: "permission_denied" }>).message).toBe("capability missing");
    });

    it("maps Tauri string error containing 'not allowed'", async () => {
      mockInvoke.mockRejectedValue("Command plugin_approve_capabilities not allowed by capability");

      const result = await safeInvoke("plugin_approve_capabilities", {});

      assertError(result, "permission_denied");
    });

    it("maps canonical ServiceError 'permission denied' string", async () => {
      mockInvoke.mockRejectedValue("permission denied");

      const result = await safeInvoke("some_command", {});

      assertError(result, "permission_denied");
    });

    it("maps canonical ServiceError 'unauthenticated' string", async () => {
      mockInvoke.mockRejectedValue("unauthenticated");

      const result = await safeInvoke("some_command", {});

      assertError(result, "permission_denied");
    });

    it("maps Tauri IPC 'explicitly denied' string", async () => {
      mockInvoke.mockRejectedValue("plugin_list explicitly denied on origin localhost");

      const result = await safeInvoke("plugin_list", {});

      assertError(result, "permission_denied");
    });

    it("maps structured CAPABILITY_MISSING backend error", async () => {
      mockInvoke.mockRejectedValue({ kind: "CAPABILITY_MISSING", message: "plugin:default not granted" });

      const result = await safeInvoke("plugin_list", {});

      assertError(result, "permission_denied");
    });
  });

  // ── invalid_args ──────────────────────────────────────────────────────

  describe("invalid_args", () => {
    beforeEach(() => {
      mockIsTauri.mockReturnValue(true);
    });

    it("maps structured INVALID_ARGS backend error", async () => {
      mockInvoke.mockRejectedValue({ kind: "INVALID_ARGS", message: "pluginId is required" });

      const result = await safeInvoke("plugin_enable", {});

      assertError(result, "invalid_args");
    });

    it("maps structured INVALID_ARGS with optional field", async () => {
      mockInvoke.mockRejectedValue({ kind: "INVALID_ARGS", message: "must be non-empty", field: "pluginId" });

      const result = await safeInvoke("plugin_enable", {});

      const error = assertError(result, "invalid_args") as Extract<SafeInvokeError, { kind: "invalid_args" }>;
      expect(error.field).toBe("pluginId");
    });

    it("maps INVALID_MANIFEST structured error to invalid_args", async () => {
      mockInvoke.mockRejectedValue({ kind: "INVALID_MANIFEST", message: "missing 'name' field" });

      const result = await safeInvoke("plugin_install", { pluginId: "bad-plugin" });

      assertError(result, "invalid_args");
    });

    it("maps serde 'invalid type:' prefix string to invalid_args", async () => {
      mockInvoke.mockRejectedValue("invalid type: integer, expected string at line 1");

      const result = await safeInvoke("plugin_enable", {});

      assertError(result, "invalid_args");
    });

    it("maps canonical ServiceError 'validation error:' prefix to invalid_args", async () => {
      mockInvoke.mockRejectedValue("validation error: name must not be empty");

      const result = await safeInvoke("plugin_install", {});

      assertError(result, "invalid_args");
    });

    it("maps canonical ServiceError 'conflict:' prefix to backend_error CONFLICT", async () => {
      mockInvoke.mockRejectedValue("conflict: channel title already exists");

      const result = await safeInvoke("channel_create", {});

      const error = assertError(result, "backend_error") as Extract<SafeInvokeError, { kind: "backend_error" }>;
      expect(error.code).toBe("CONFLICT");
      expect(error.message).toBe("conflict: channel title already exists");
    });

    it("maps serde 'missing field' string error", async () => {
      mockInvoke.mockRejectedValue("missing field `pluginId`");

      const result = await safeInvoke("plugin_enable", {});

      assertError(result, "invalid_args");
    });
  });

  // ── backend_error ─────────────────────────────────────────────────────

  describe("backend_error", () => {
    beforeEach(() => {
      mockIsTauri.mockReturnValue(true);
    });

    it("maps structured backend error with custom kind (e.g. LIFECYCLE_ERROR)", async () => {
      mockInvoke.mockRejectedValue({ kind: "LIFECYCLE_ERROR", message: "plugin crashed on startup" });

      const result = await safeInvoke("plugin_enable", { pluginId: "my-plugin" });

      const error = assertError(result, "backend_error") as Extract<SafeInvokeError, { kind: "backend_error" }>;
      expect(error.code).toBe("LIFECYCLE_ERROR");
      expect(error.message).toBe("plugin crashed on startup");
    });

    it("maps unknown string error to backend_error with code UNKNOWN", async () => {
      mockInvoke.mockRejectedValue("something went horribly wrong");

      const result = await safeInvoke("plugin_enable", {});

      const error = assertError(result, "backend_error") as Extract<SafeInvokeError, { kind: "backend_error" }>;
      expect(error.code).toBe("UNKNOWN");
    });

    it("maps Error instance to backend_error", async () => {
      mockInvoke.mockRejectedValue(new Error("network timeout"));

      const result = await safeInvoke("plugin_list", {});

      const error = assertError(result, "backend_error") as Extract<SafeInvokeError, { kind: "backend_error" }>;
      expect(error.message).toBe("network timeout");
    });

    it("maps structured error without recognisable kind to backend_error", async () => {
      mockInvoke.mockRejectedValue({ kind: "SOME_FUTURE_ERROR", message: "new error type" });

      const result = await safeInvoke("plugin_list", {});

      const error = assertError(result, "backend_error") as Extract<SafeInvokeError, { kind: "backend_error" }>;
      expect(error.code).toBe("SOME_FUTURE_ERROR");
    });
  });

  // ── canonical ServiceError round-trip + false-positive guards ─────────

  describe("narrowError — canonical ServiceError strings", () => {
    beforeEach(() => {
      mockIsTauri.mockReturnValue(true);
    });

    // All 11 canonical strings from rim_services/src/lib.rs #[error(...)]

    it("'not found' → backend_error NOT_FOUND", async () => {
      mockInvoke.mockRejectedValue("not found");
      const result = await safeInvoke("cmd", {});
      const error = assertError(result, "backend_error") as Extract<SafeInvokeError, { kind: "backend_error" }>;
      expect(error.code).toBe("NOT_FOUND");
      expect(error.message).toBe("not found");
    });

    it("'validation error: …' → invalid_args, message preserved", async () => {
      mockInvoke.mockRejectedValue("validation error: field too long");
      const result = await safeInvoke("cmd", {});
      const error = assertError(result, "invalid_args") as Extract<SafeInvokeError, { kind: "invalid_args" }>;
      expect(error.message).toBe("validation error: field too long");
    });

    it("'conflict: …' → backend_error CONFLICT, message preserved", async () => {
      mockInvoke.mockRejectedValue("conflict: duplicate key");
      const result = await safeInvoke("cmd", {});
      const error = assertError(result, "backend_error") as Extract<SafeInvokeError, { kind: "backend_error" }>;
      expect(error.code).toBe("CONFLICT");
      expect(error.message).toBe("conflict: duplicate key");
    });

    it("'validation error: …' still maps to invalid_args (regression guard — Validation != Conflict)", async () => {
      mockInvoke.mockRejectedValue("validation error: too short");
      const result = await safeInvoke("cmd", {});
      assertError(result, "invalid_args");
    });

    it("'dependency unavailable' → backend_error DEPENDENCY_UNAVAILABLE", async () => {
      mockInvoke.mockRejectedValue("dependency unavailable");
      const result = await safeInvoke("cmd", {});
      const error = assertError(result, "backend_error") as Extract<SafeInvokeError, { kind: "backend_error" }>;
      expect(error.code).toBe("DEPENDENCY_UNAVAILABLE");
    });

    it("'dependency timed out' → backend_error DEPENDENCY_TIMED_OUT", async () => {
      mockInvoke.mockRejectedValue("dependency timed out");
      const result = await safeInvoke("cmd", {});
      const error = assertError(result, "backend_error") as Extract<SafeInvokeError, { kind: "backend_error" }>;
      expect(error.code).toBe("DEPENDENCY_TIMED_OUT");
    });

    it("'permission denied' → permission_denied", async () => {
      mockInvoke.mockRejectedValue("permission denied");
      const result = await safeInvoke("cmd", {});
      assertError(result, "permission_denied");
    });

    it("'unauthenticated' → permission_denied", async () => {
      mockInvoke.mockRejectedValue("unauthenticated");
      const result = await safeInvoke("cmd", {});
      assertError(result, "permission_denied");
    });

    it("'confirmation proof is stale; please re-confirm' → confirmation_stale, message preserved", async () => {
      mockInvoke.mockRejectedValue("confirmation proof is stale; please re-confirm");
      const result = await safeInvoke("cmd", {});
      const error = assertError(result, "confirmation_stale") as Extract<SafeInvokeError, { kind: "confirmation_stale" }>;
      expect(error.message).toBe("confirmation proof is stale; please re-confirm");
    });

    it("'confirmation failed: wrong proof' → confirmation_stale", async () => {
      mockInvoke.mockRejectedValue("confirmation failed: wrong proof");
      const result = await safeInvoke("cmd", {});
      assertError(result, "confirmation_stale");
    });

    it("'rate limit exceeded; retry after 30s' → rate_limited, retryAfterMs=30000, message intact", async () => {
      mockInvoke.mockRejectedValue("rate limit exceeded; retry after 30s");
      const result = await safeInvoke("cmd", {});
      const error = assertError(result, "rate_limited") as Extract<SafeInvokeError, { kind: "rate_limited" }>;
      expect(error.retryAfterMs).toBe(30000);
      expect(error.message).toBe("rate limit exceeded; retry after 30s");
    });

    it("'rate limit exceeded; retry after 5s' → rate_limited, retryAfterMs=5000", async () => {
      mockInvoke.mockRejectedValue("rate limit exceeded; retry after 5s");
      const result = await safeInvoke("cmd", {});
      const error = assertError(result, "rate_limited") as Extract<SafeInvokeError, { kind: "rate_limited" }>;
      expect(error.retryAfterMs).toBe(5000);
    });

    it("structured RATE_LIMITED with retry_after_ms → rate_limited, retryAfterMs preserved", async () => {
      mockInvoke.mockRejectedValue({ kind: "RATE_LIMITED", message: "rate limit exceeded", retry_after_ms: 60000 });
      const result = await safeInvoke("cmd", {});
      const error = assertError(result, "rate_limited") as Extract<SafeInvokeError, { kind: "rate_limited" }>;
      expect(error.retryAfterMs).toBe(60000);
      expect(error.message).toBe("rate limit exceeded");
    });

    it("structured CONFIRMATION_STALE → confirmation_stale", async () => {
      mockInvoke.mockRejectedValue({ kind: "CONFIRMATION_STALE", message: "confirmation expired or was already used" });
      const result = await safeInvoke("cmd", {});
      const error = assertError(result, "confirmation_stale") as Extract<SafeInvokeError, { kind: "confirmation_stale" }>;
      expect(error.message).toBe("confirmation expired or was already used");
    });

    it("'internal error' → backend_error INTERNAL_ERROR", async () => {
      mockInvoke.mockRejectedValue("internal error");
      const result = await safeInvoke("cmd", {});
      const error = assertError(result, "backend_error") as Extract<SafeInvokeError, { kind: "backend_error" }>;
      expect(error.code).toBe("INTERNAL_ERROR");
    });

    // False-positive guards

    it("'toString' does NOT hit STATIC_CODES (prototype-pollution guard)", async () => {
      mockInvoke.mockRejectedValue("toString");
      const result = await safeInvoke("cmd", {});
      const error = assertError(result, "backend_error") as Extract<SafeInvokeError, { kind: "backend_error" }>;
      expect(error.code).toBe("UNKNOWN");
    });

    it("'invalid signature' does NOT trigger invalid_args (falls through to UNKNOWN)", async () => {
      // 'invalid signature' is not a serde prefix and not a ServiceError string —
      // it must not match the old loose includes("invalid") heuristic.
      mockInvoke.mockRejectedValue("invalid signature");
      const result = await safeInvoke("cmd", {});
      const error = assertError(result, "backend_error") as Extract<SafeInvokeError, { kind: "backend_error" }>;
      expect(error.code).toBe("UNKNOWN");
    });

    it("'some plugin entered invalid state' does NOT trigger invalid_args", async () => {
      mockInvoke.mockRejectedValue("some plugin entered invalid state");
      const result = await safeInvoke("cmd", {});
      const error = assertError(result, "backend_error") as Extract<SafeInvokeError, { kind: "backend_error" }>;
      expect(error.code).toBe("UNKNOWN");
    });

    it("'some random unknown rust string' → backend_error UNKNOWN", async () => {
      mockInvoke.mockRejectedValue("some random unknown rust string");
      const result = await safeInvoke("cmd", {});
      const error = assertError(result, "backend_error") as Extract<SafeInvokeError, { kind: "backend_error" }>;
      expect(error.code).toBe("UNKNOWN");
    });
  });

  // ── success path ──────────────────────────────────────────────────────

  describe("success", () => {
    beforeEach(() => {
      mockIsTauri.mockReturnValue(true);
    });

    it("returns ok: true with the resolved value", async () => {
      const mockPlugins = [{ plugin_id: "test", display_name: "Test" }];
      mockInvoke.mockResolvedValue(mockPlugins);

      const result = await safeInvoke("plugin_list", {});

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Expected ok result");
      expect(result.value).toEqual(mockPlugins);
    });

    it("passes args through to invoke", async () => {
      mockInvoke.mockResolvedValue(undefined);

      await safeInvoke("plugin_enable", { pluginId: "my-plugin" });

      expect(mockInvoke).toHaveBeenCalledWith("plugin_enable", { pluginId: "my-plugin" });
    });
  });
});
