import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ──────────────────────────────────────────────────────────────
// Hoist mocks — vi.hoisted() runs before vi.mock() factories
// ──────────────────────────────────────────────────────────────

const { mockSafeInvoke, mockOnData, mockTerminal } = vi.hoisted(() => {
  const mockOnData = vi.fn().mockReturnValue({ dispose: vi.fn() });
  const mockTerminal = {
    loadAddon: vi.fn(),
    open: vi.fn(),
    onData: mockOnData,
    write: vi.fn(),
    dispose: vi.fn(),
    options: {} as Record<string, unknown>,
    cols: 80,
    rows: 24,
  };
  return {
    mockSafeInvoke: vi.fn(),
    mockOnData,
    mockTerminal,
  };
});

vi.mock("../../../core/tauri/safeInvoke", () => ({
  safeInvoke: mockSafeInvoke,
}));

vi.mock("../../../core/logger", () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => undefined),
}));

vi.mock("../terminalTheme", () => ({
  buildTerminalTheme: vi.fn().mockReturnValue({}),
}));

vi.mock("../state/useTerminalStore", () => ({
  useTerminalStore: {
    getState: vi.fn().mockReturnValue({ fontFamily: "", fontSize: 13 }),
    subscribe: vi.fn().mockReturnValue(() => undefined),
  },
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn().mockImplementation(function () {
    return mockTerminal;
  }),
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn().mockImplementation(function () {
    return { fit: vi.fn() };
  }),
}));

// jsdom does not implement ResizeObserver — stub it with a class so `new` works
class ResizeObserverStub {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
global.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

import { logger } from "../../../core/logger";
import type { SafeInvokeError } from "../../../core/tauri/safeInvoke";
import { useTerminalSession } from "./useTerminalSession";

// ──────────────────────────────────────────────────────────────
// Helper to build SafeInvokeResult
// ──────────────────────────────────────────────────────────────

function okResult() {
  return { ok: true as const, value: undefined };
}

function errResult(error: SafeInvokeError) {
  return { ok: false as const, error };
}

// ──────────────────────────────────────────────────────────────
// Tests for logTerminalInvokeError via safeInvoke failure paths
// These exercise the discriminated-union switch in the helper.
// ──────────────────────────────────────────────────────────────

describe("useTerminalSession — safeInvoke error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSafeInvoke.mockResolvedValue(okResult());
    // Restore onData return value after clearAllMocks
    mockOnData.mockReturnValue({ dispose: vi.fn() });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── terminal_resize tests ──
  // We let setup() run inside the effect. The initial fit inside
  // requestAnimationFrame triggers safeInvoke("terminal_resize").
  // We wait long enough for the async chain to settle.

  it("terminal_resize: ipc_unavailable is silently suppressed (no log)", async () => {
    mockSafeInvoke.mockImplementation((command: string) => {
      if (command === "terminal_resize") {
        return Promise.resolve(errResult({ kind: "ipc_unavailable", message: "web mode" }));
      }
      return Promise.resolve(okResult());
    });

    const containerRef = { current: document.createElement("div") };
    renderHook(() => useTerminalSession({ sessionId: "s1", containerRef }));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("terminal_resize: permission_denied logs at warn level", async () => {
    mockSafeInvoke.mockImplementation((command: string) => {
      if (command === "terminal_resize") {
        return Promise.resolve(
          errResult({ kind: "permission_denied", message: "terminal resize not allowed" }),
        );
      }
      return Promise.resolve(okResult());
    });

    const containerRef = { current: document.createElement("div") };
    renderHook(() => useTerminalSession({ sessionId: "s2", containerRef }));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("terminal_resize permission denied"),
      expect.objectContaining({ sessionId: "s2" }),
    );
  });

  it("terminal_resize: backend_error logs at warn level with code", async () => {
    mockSafeInvoke.mockImplementation((command: string) => {
      if (command === "terminal_resize") {
        return Promise.resolve(
          errResult({
            kind: "backend_error",
            code: "SESSION_NOT_FOUND",
            message: "no such session",
          }),
        );
      }
      return Promise.resolve(okResult());
    });

    const containerRef = { current: document.createElement("div") };
    renderHook(() => useTerminalSession({ sessionId: "s3", containerRef }));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("terminal_resize backend error"),
      expect.objectContaining({ sessionId: "s3", code: "SESSION_NOT_FOUND" }),
    );
  });

  // ── terminal_write tests ──
  // After setup() completes, terminal.onData callback is registered.
  // We capture it and call it to trigger safeInvoke("terminal_write").

  it("terminal_write: ipc_unavailable is suppressed (web mode no-op)", async () => {
    mockSafeInvoke.mockImplementation((command: string) => {
      if (command === "terminal_write") {
        return Promise.resolve(errResult({ kind: "ipc_unavailable", message: "web mode" }));
      }
      return Promise.resolve(okResult());
    });

    const containerRef = { current: document.createElement("div") };
    renderHook(() => useTerminalSession({ sessionId: "s4", containerRef }));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const onDataCb = mockOnData.mock.calls[0]?.[0] as ((data: string) => void) | undefined;
    if (onDataCb) {
      await act(async () => {
        onDataCb("hello");
        await new Promise((r) => setTimeout(r, 0));
      });
    }

    expect(logger.error).not.toHaveBeenCalled();
  });

  it("terminal_write: backend_error logs at error level", async () => {
    mockSafeInvoke.mockImplementation((command: string) => {
      if (command === "terminal_write") {
        return Promise.resolve(
          errResult({ kind: "backend_error", code: "WRITE_FAILED", message: "pty gone" }),
        );
      }
      return Promise.resolve(okResult());
    });

    const containerRef = { current: document.createElement("div") };
    renderHook(() => useTerminalSession({ sessionId: "s5", containerRef }));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const onDataCb = mockOnData.mock.calls[0]?.[0] as ((data: string) => void) | undefined;
    if (onDataCb) {
      await act(async () => {
        onDataCb("hello");
        await new Promise((r) => setTimeout(r, 0));
      });
    }

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("terminal_write backend error"),
      expect.objectContaining({ sessionId: "s5", code: "WRITE_FAILED" }),
    );
  });
});
