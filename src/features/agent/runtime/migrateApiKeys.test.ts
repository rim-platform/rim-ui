import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ──────────────────────────────────────────────────────────────
// Hoist mocks
// ──────────────────────────────────────────────────────────────

const mockInvoke = vi.fn();
const mockLoadApiKey = vi.fn();
const mockDeleteApiKey = vi.fn();
const mockToastInfo = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("./keyStore", () => ({
  loadApiKey: (...args: unknown[]) => mockLoadApiKey(...args),
  deleteApiKey: (...args: unknown[]) => mockDeleteApiKey(...args),
}));

vi.mock("../../../core/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../../shared/toast/useToastStore", () => ({
  toast: {
    info: (...args: unknown[]) => mockToastInfo(...args),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

import { migrateApiKeysOnce } from "./migrateApiKeys";

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

const MIGRATION_FLAG = "rim-keyring-migration-v1";

function clearFlag() {
  localStorage.removeItem(MIGRATION_FLAG);
}

function setFlag() {
  localStorage.setItem(MIGRATION_FLAG, "done");
}

// ──────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────

describe("migrateApiKeysOnce", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearFlag();

    // Safe defaults: keyring empty, Stronghold empty, set/delete succeed.
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "is_provider_key_configured") return Promise.resolve(false);
      if (cmd === "set_provider_key") return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });
    mockLoadApiKey.mockResolvedValue(null);
    mockDeleteApiKey.mockResolvedValue(undefined);
  });

  afterEach(() => {
    clearFlag();
  });

  // ── Flag gate ────────────────────────────────────────────────

  it("is a no-op (returns immediately) when migration flag is already 'done'", async () => {
    setFlag();

    await migrateApiKeysOnce();

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(mockLoadApiKey).not.toHaveBeenCalled();
  });

  // ── Skip when keyring already has key ────────────────────────

  it("skips loadApiKey when keyring already has a key for a provider", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "is_provider_key_configured") return Promise.resolve(true);
      return Promise.resolve(undefined);
    });

    await migrateApiKeysOnce();

    // loadApiKey should NOT be called because the keyring already has the key.
    expect(mockLoadApiKey).not.toHaveBeenCalled();
    // set_provider_key should NOT be called.
    const storeCalls = mockInvoke.mock.calls.filter(
      ([cmd]: [string]) => cmd === "set_provider_key",
    );
    expect(storeCalls).toHaveLength(0);
  });

  // ── Skip when Stronghold has no key ──────────────────────────

  it("does NOT call set_provider_key when Stronghold has no key", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "is_provider_key_configured") return Promise.resolve(false);
      return Promise.resolve(undefined);
    });
    mockLoadApiKey.mockResolvedValue(null);

    await migrateApiKeysOnce();

    const storeCalls = mockInvoke.mock.calls.filter(
      ([cmd]: [string]) => cmd === "set_provider_key",
    );
    expect(storeCalls).toHaveLength(0);
    // Flag still set even if nothing to migrate (new install path).
    expect(localStorage.getItem(MIGRATION_FLAG)).toBe("done");
  });

  // ── Successful copy ──────────────────────────────────────────

  it("copies key from Stronghold to keyring when keyring is empty", async () => {
    mockLoadApiKey.mockImplementation((provider: string) => {
      if (provider === "anthropic") return Promise.resolve("sk-ant-stored");
      return Promise.resolve(null);
    });

    await migrateApiKeysOnce();

    expect(mockInvoke).toHaveBeenCalledWith("set_provider_key", {
      provider: "anthropic",
      apiKey: "sk-ant-stored",
    });
  });

  it("deletes the Stronghold entry after a successful copy", async () => {
    mockLoadApiKey.mockImplementation((provider: string) => {
      if (provider === "anthropic") return Promise.resolve("sk-ant-stored");
      return Promise.resolve(null);
    });

    await migrateApiKeysOnce();

    expect(mockDeleteApiKey).toHaveBeenCalledWith("anthropic");
  });

  it("sets the migration flag after a successful run", async () => {
    mockLoadApiKey.mockResolvedValue(null); // no-op migration

    await migrateApiKeysOnce();

    expect(localStorage.getItem(MIGRATION_FLAG)).toBe("done");
  });

  it("emits toast.info when at least one key was migrated", async () => {
    mockLoadApiKey.mockImplementation((provider: string) => {
      if (provider === "anthropic") return Promise.resolve("sk-ant-stored");
      return Promise.resolve(null);
    });

    await migrateApiKeysOnce();

    expect(mockToastInfo).toHaveBeenCalledWith(expect.stringContaining("Migrated API keys"));
  });

  // ── Error handling ───────────────────────────────────────────

  it("does NOT set the flag when set_provider_key throws", async () => {
    mockLoadApiKey.mockImplementation((provider: string) => {
      if (provider === "anthropic") return Promise.resolve("sk-ant-value");
      return Promise.resolve(null);
    });
    mockInvoke.mockImplementation((cmd: string, args?: { provider?: string }) => {
      if (cmd === "is_provider_key_configured") return Promise.resolve(false);
      if (cmd === "set_provider_key" && args?.provider === "anthropic")
        return Promise.reject(new Error("keyring access denied"));
      return Promise.resolve(undefined);
    });

    await migrateApiKeysOnce();

    expect(localStorage.getItem(MIGRATION_FLAG)).not.toBe("done");
  });

  // ── Idempotency ──────────────────────────────────────────────

  it("is idempotent — calling twice with flag set is a no-op on the second call", async () => {
    mockLoadApiKey.mockResolvedValue(null);

    await migrateApiKeysOnce();
    expect(localStorage.getItem(MIGRATION_FLAG)).toBe("done");

    vi.clearAllMocks();

    await migrateApiKeysOnce();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  // ── Both providers ────────────────────────────────────────────

  it("migrates both Anthropic and OpenAI keys in one pass", async () => {
    mockLoadApiKey.mockImplementation((provider: string) => {
      if (provider === "anthropic") return Promise.resolve("sk-ant-key");
      if (provider === "openai") return Promise.resolve("sk-openai-key");
      return Promise.resolve(null);
    });

    await migrateApiKeysOnce();

    expect(mockInvoke).toHaveBeenCalledWith("set_provider_key", {
      provider: "anthropic",
      apiKey: "sk-ant-key",
    });
    expect(mockInvoke).toHaveBeenCalledWith("set_provider_key", {
      provider: "openai",
      apiKey: "sk-openai-key",
    });
  });

  it("continues migrating OpenAI when Anthropic set_provider_key fails", async () => {
    mockLoadApiKey.mockImplementation((provider: string) => {
      if (provider === "anthropic") return Promise.resolve("sk-ant-key");
      if (provider === "openai") return Promise.resolve("sk-openai-key");
      return Promise.resolve(null);
    });

    mockInvoke.mockImplementation((cmd: string, args?: { provider?: string }) => {
      if (cmd === "is_provider_key_configured") return Promise.resolve(false);
      if (cmd === "set_provider_key" && args?.provider === "anthropic")
        return Promise.reject(new Error("deny"));
      if (cmd === "set_provider_key" && args?.provider === "openai")
        return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });

    await migrateApiKeysOnce();

    // OpenAI was still stored despite Anthropic failure.
    expect(mockInvoke).toHaveBeenCalledWith("set_provider_key", {
      provider: "openai",
      apiKey: "sk-openai-key",
    });
  });
});
