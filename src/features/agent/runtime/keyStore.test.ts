import { describe, it, expect, vi, beforeEach } from "vitest";

// ──────────────────────────────────────────────────────────────
// Hoist mocks — must precede any import that transitively loads the module
// ──────────────────────────────────────────────────────────────

vi.mock("../../../core/logger", () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../../shared/toast/useToastStore", () => ({
  toast: {
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}));

// Stronghold and path — simulate unavailable (throw on load)
vi.mock("@tauri-apps/plugin-stronghold", () => ({
  Stronghold: {
    load: vi.fn().mockRejectedValue(new Error("Stronghold init failed")),
  },
}));

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: vi.fn().mockResolvedValue("/tmp/test-app-data"),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue("test-stronghold-password"),
  isTauri: vi.fn().mockReturnValue(true),
}));

import { saveApiKey, loadApiKey, deleteApiKey } from "./keyStore";
import { logger } from "../../../core/logger";
import { toast } from "../../../shared/toast/useToastStore";

// ──────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────

describe("keyStore — Stronghold fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module-level strongholdWarningEmitted flag between tests by
    // re-importing the module fresh. We do this by clearing the module cache.
    vi.resetModules();
  });

  it("saveApiKey: emits logger.error with security target on Stronghold failure", async () => {
    // Re-import after resetModules to get fresh module state
    const { saveApiKey: save } = await import("./keyStore");
    await save("anthropic", "sk-test");

    const { logger: l } = await import("../../../core/logger");
    expect(l.error).toHaveBeenCalledWith(
      expect.stringContaining("[keyStore] Stronghold unavailable"),
      expect.objectContaining({ target: "security" }),
    );
  });

  it("saveApiKey: emits toast.warning on first Stronghold failure", async () => {
    const { saveApiKey: save } = await import("./keyStore");
    await save("anthropic", "sk-test");

    const { toast: t } = await import("../../../shared/toast/useToastStore");
    expect(t.warning).toHaveBeenCalledWith(
      expect.stringContaining("Secure storage unavailable"),
    );
  });

  it("saveApiKey: toast emitted only once across multiple failures", async () => {
    const { saveApiKey: save } = await import("./keyStore");
    await save("anthropic", "sk-test-1");
    await save("openai", "sk-test-2");

    const { toast: t } = await import("../../../shared/toast/useToastStore");
    expect(t.warning).toHaveBeenCalledTimes(1);
  });

  it("saveApiKey: falls back to in-memory store and key is retrievable", async () => {
    const { saveApiKey: save, loadApiKey: load } = await import("./keyStore");
    await save("anthropic", "sk-fallback");
    const key = await load("anthropic");
    expect(key).toBe("sk-fallback");
  });

  it("loadApiKey: emits logger.error on Stronghold failure", async () => {
    const { loadApiKey: load } = await import("./keyStore");
    await load("anthropic");

    const { logger: l } = await import("../../../core/logger");
    expect(l.error).toHaveBeenCalledWith(
      expect.stringContaining("[keyStore] Stronghold unavailable"),
      expect.objectContaining({ target: "security", error: expect.any(Error) }),
    );
  });

  it("loadApiKey: returns null when no fallback key exists", async () => {
    const { loadApiKey: load } = await import("./keyStore");
    const key = await load("nonexistent-provider");
    expect(key).toBeNull();
  });

  it("deleteApiKey: emits logger.error on Stronghold failure", async () => {
    const { deleteApiKey: del } = await import("./keyStore");
    await del("anthropic");

    const { logger: l } = await import("../../../core/logger");
    expect(l.error).toHaveBeenCalledWith(
      expect.stringContaining("[keyStore] Stronghold unavailable"),
      expect.objectContaining({ target: "security" }),
    );
  });
});
