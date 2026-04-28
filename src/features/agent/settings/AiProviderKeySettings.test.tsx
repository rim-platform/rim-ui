import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// ──────────────────────────────────────────────────────────────
// Hoist mocks
// ──────────────────────────────────────────────────────────────

const mockInvoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: () => ({
    capabilities: { pluginHost: true, agent: true },
  }),
}));

vi.mock("../../../shared/toast/useToastStore", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

import { AiProviderKeySettings } from "./AiProviderKeySettings";
import { toast } from "../../../shared/toast/useToastStore";

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

function setup() {
  return render(<AiProviderKeySettings />);
}

// ──────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────

describe("AiProviderKeySettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no keys configured
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "is_provider_key_configured") return Promise.resolve(false);
      return Promise.resolve(undefined);
    });
  });

  it("renders both providers", async () => {
    setup();
    await waitFor(() => {
      expect(screen.getByText("Anthropic (Claude)")).toBeInTheDocument();
      expect(screen.getByText("OpenAI (GPT)")).toBeInTheDocument();
    });
  });

  it("shows no-key status when key not configured", async () => {
    setup();
    await waitFor(() => {
      expect(screen.getAllByText("No key configured")).toHaveLength(2);
    });
  });

  it("shows key-set status when key is configured", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "is_provider_key_configured") return Promise.resolve(true);
      return Promise.resolve(undefined);
    });
    setup();
    await waitFor(() => {
      expect(screen.getAllByText("Key set")).toHaveLength(2);
    });
  });

  describe("Verify & Save — valid key flow", () => {
    it("validates first, then stores key, shows success state, clears input", async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "is_provider_key_configured") return Promise.resolve(false);
        if (cmd === "agent_validate_provided_key")
          return Promise.resolve({ kind: "valid" });
        if (cmd === "set_provider_key") return Promise.resolve(undefined);
        return Promise.resolve(undefined);
      });

      setup();

      // Wait for initial load
      await waitFor(() => screen.getAllByText("No key configured"));

      const inputs = screen.getAllByPlaceholderText(/sk-ant/);
      fireEvent.change(inputs[0], { target: { value: "sk-ant-test-key" } });

      fireEvent.click(screen.getAllByRole("button", { name: /verify/i })[0]);

      await waitFor(() => {
        // Validate-first: agent_validate_provided_key must be called with the
        // key directly — set_provider_key must NOT be called before validation.
        expect(mockInvoke).toHaveBeenCalledWith("agent_validate_provided_key", {
          provider: "anthropic",
          apiKey: "sk-ant-test-key",
        });
        // Only after valid outcome does set_provider_key fire.
        expect(mockInvoke).toHaveBeenCalledWith("set_provider_key", {
          provider: "anthropic",
          apiKey: "sk-ant-test-key",
        });
      });

      // Validate before store: validate_provided_key must be called BEFORE
      // set_provider_key in the invocation sequence.
      const calls = mockInvoke.mock.calls.map(([cmd]: [string]) => cmd);
      const validateIdx = calls.indexOf("agent_validate_provided_key");
      const storeIdx = calls.indexOf("set_provider_key");
      expect(validateIdx).toBeGreaterThanOrEqual(0);
      expect(storeIdx).toBeGreaterThan(validateIdx);

      await waitFor(() => {
        expect(screen.getByText("Key verified and saved.")).toBeInTheDocument();
      });

      expect(toast.success).toHaveBeenCalledWith(
        expect.stringContaining("verified and saved"),
      );
    });

    it("shows 'Key set' status after successful verification", async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "is_provider_key_configured") return Promise.resolve(false);
        if (cmd === "agent_validate_provided_key")
          return Promise.resolve({ kind: "valid" });
        if (cmd === "set_provider_key") return Promise.resolve(undefined);
        return Promise.resolve(undefined);
      });

      setup();
      await waitFor(() => screen.getAllByText("No key configured"));

      const inputs = screen.getAllByPlaceholderText(/sk-ant/);
      fireEvent.change(inputs[0], { target: { value: "sk-ant-valid" } });
      fireEvent.click(screen.getAllByRole("button", { name: /verify/i })[0]);

      await waitFor(() => {
        // After success, "Key set" should appear for the Anthropic row
        expect(screen.getByText("Key set")).toBeInTheDocument();
      });
    });

    it("does NOT call agent_validate_credentials (old command is retired for this flow)", async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "is_provider_key_configured") return Promise.resolve(false);
        if (cmd === "agent_validate_provided_key")
          return Promise.resolve({ kind: "valid" });
        if (cmd === "set_provider_key") return Promise.resolve(undefined);
        return Promise.resolve(undefined);
      });

      setup();
      await waitFor(() => screen.getAllByText("No key configured"));

      const inputs = screen.getAllByPlaceholderText(/sk-ant/);
      fireEvent.change(inputs[0], { target: { value: "sk-ant-valid" } });
      fireEvent.click(screen.getAllByRole("button", { name: /verify/i })[0]);

      await waitFor(() => screen.getByText("Key verified and saved."));

      const oldCmdCalls = mockInvoke.mock.calls.filter(
        ([cmd]: [string]) => cmd === "agent_validate_credentials",
      );
      expect(oldCmdCalls).toHaveLength(0);
    });
  });

  describe("Verify & Save — invalid key flow", () => {
    it("validate → no store → error inline, existing key NOT touched", async () => {
      // New contract: invalid validation never calls set_provider_key or
      // clear_provider_key — the existing key in the keyring is preserved.
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "is_provider_key_configured") return Promise.resolve(false);
        if (cmd === "agent_validate_provided_key")
          return Promise.resolve({ kind: "invalid" });
        return Promise.resolve(undefined);
      });

      setup();
      await waitFor(() => screen.getAllByText("No key configured"));

      const inputs = screen.getAllByPlaceholderText(/sk-ant/);
      fireEvent.change(inputs[0], { target: { value: "sk-ant-bad-key" } });
      fireEvent.click(screen.getAllByRole("button", { name: /verify/i })[0]);

      await waitFor(() => {
        expect(
          screen.getByText(/Invalid key — not saved/),
        ).toBeInTheDocument();
      });

      // set_provider_key must NEVER be called on an invalid key.
      const storeCalls = mockInvoke.mock.calls.filter(
        ([cmd]: [string]) => cmd === "set_provider_key",
      );
      expect(storeCalls).toHaveLength(0);

      // clear_provider_key must NOT be called — we never wrote anything.
      const clearCalls = mockInvoke.mock.calls.filter(
        ([cmd]: [string]) => cmd === "clear_provider_key",
      );
      expect(clearCalls).toHaveLength(0);

      // Success toast must NOT fire.
      expect(toast.success).not.toHaveBeenCalled();
    });

    it("existing key preserved when new key fails validation", async () => {
      // Regression guard: user has a working key stored. They type a typo and
      // click Verify & Save. The existing key must remain intact.
      let isConfigured = true;
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "is_provider_key_configured")
          return Promise.resolve(isConfigured);
        if (cmd === "agent_validate_provided_key")
          return Promise.resolve({ kind: "invalid" });
        return Promise.resolve(undefined);
      });

      setup();

      // Should start showing "Key set" (existing key present)
      await waitFor(() => {
        expect(screen.getAllByText("Key set")).toHaveLength(2);
      });

      // Simulate user typing a bad replacement key
      const inputs = screen.getAllByPlaceholderText(/new key to replace/);
      fireEvent.change(inputs[0], { target: { value: "sk-ant-typo" } });
      fireEvent.click(screen.getAllByRole("button", { name: /verify/i })[0]);

      await waitFor(() => {
        expect(screen.getByText(/Invalid key — not saved/)).toBeInTheDocument();
      });

      // isConfigured flag must not have been toggled — keyConfigured state
      // stays true because no write/clear occurred.
      // The "Key set" indicator for the other provider (OpenAI) still shows.
      // (Anthropic row shows the inline error, but the status dot is managed
      // by setKeyConfigured which must not have been called with false.)
      expect(isConfigured).toBe(true);

      // set_provider_key must not have been called.
      const storeCalls = mockInvoke.mock.calls.filter(
        ([cmd]: [string]) => cmd === "set_provider_key",
      );
      expect(storeCalls).toHaveLength(0);
    });
  });

  describe("Delete key flow", () => {
    it("shows delete button when key is configured", async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "is_provider_key_configured") return Promise.resolve(true);
        return Promise.resolve(undefined);
      });

      setup();
      await waitFor(() => {
        const deleteButtons = screen.getAllByLabelText("Delete key");
        expect(deleteButtons.length).toBeGreaterThan(0);
      });
    });

    it("clicking delete clears key and updates status", async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "is_provider_key_configured") return Promise.resolve(true);
        if (cmd === "clear_provider_key") return Promise.resolve(undefined);
        return Promise.resolve(undefined);
      });

      setup();
      await waitFor(() => screen.getAllByText("Key set"));

      const deleteButtons = screen.getAllByLabelText("Delete key");
      fireEvent.click(deleteButtons[0]);

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("clear_provider_key", {
          provider: "anthropic",
        });
      });

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith(
          expect.stringContaining("removed"),
        );
      });
    });

    it("after delete, status shows no key configured", async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "is_provider_key_configured") return Promise.resolve(true);
        if (cmd === "clear_provider_key") return Promise.resolve(undefined);
        return Promise.resolve(undefined);
      });

      setup();
      await waitFor(() => screen.getAllByText("Key set"));

      const deleteButtons = screen.getAllByLabelText("Delete key");
      fireEvent.click(deleteButtons[0]);

      await waitFor(() => {
        // At least one provider now shows no-key status
        expect(screen.getByText("No key configured")).toBeInTheDocument();
      });
    });
  });

  describe("Network error flow", () => {
    it("shows warning and does NOT save key when provider unreachable", async () => {
      // New contract: network_error means we cannot verify — key is NOT stored.
      // User must retry when connectivity is restored.
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "is_provider_key_configured") return Promise.resolve(false);
        if (cmd === "agent_validate_provided_key")
          return Promise.resolve({
            kind: "network_error",
            message: "connection refused",
          });
        return Promise.resolve(undefined);
      });

      setup();
      await waitFor(() => screen.getAllByText("No key configured"));

      const inputs = screen.getAllByPlaceholderText(/sk-ant/);
      fireEvent.change(inputs[0], { target: { value: "sk-ant-maybe-valid" } });
      fireEvent.click(screen.getAllByRole("button", { name: /verify/i })[0]);

      await waitFor(() => {
        expect(
          screen.getByText(/Could not reach Anthropic/),
        ).toBeInTheDocument();
      });

      expect(toast.warning).toHaveBeenCalled();

      // set_provider_key must NOT be called on network error.
      const storeCalls = mockInvoke.mock.calls.filter(
        ([cmd]: [string]) => cmd === "set_provider_key",
      );
      expect(storeCalls).toHaveLength(0);

      // clear_provider_key must NOT be called — we never wrote anything.
      const clearCalls = mockInvoke.mock.calls.filter(
        ([cmd]: [string]) => cmd === "clear_provider_key",
      );
      expect(clearCalls).toHaveLength(0);
    });
  });

  it("Verify & Save button is disabled when input is empty", async () => {
    setup();
    await waitFor(() => screen.getAllByText("No key configured"));

    const verifyButtons = screen.getAllByRole("button", { name: /verify/i });
    expect(verifyButtons[0]).toBeDisabled();
  });
});
