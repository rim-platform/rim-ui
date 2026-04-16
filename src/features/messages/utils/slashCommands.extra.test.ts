import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../agent/state/useAgentStore", () => ({
  useAgentStore: {
    getState: vi.fn(() => ({ open: vi.fn() })),
  },
}));

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: vi.fn(),
  },
}));

vi.mock("../../workspaces/state/useWorkspaceStore", () => ({
  useWorkspaceStore: {
    getState: vi.fn(() => ({ workspaceId: "ws-1" })),
  },
}));

vi.mock("../../macros/api/useMacros", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../macros/api/useMacros")>();
  return {
    ...actual,
    fetchMacroByName: vi.fn(),
  };
});

vi.mock("../../../shared/toast", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
    dismissAll: vi.fn(),
  },
}));

import { graphqlClient } from "../../../core/graphql/client";
import { fetchMacroByName } from "../../macros/api/useMacros";
import { toast } from "../../../shared/toast";
import { getSlashCommandSuggestions, isSlashCommand, SLASH_COMMANDS } from "./slashCommands";

const mockGraphqlRequest = vi.mocked(graphqlClient.request);
const mockFetchMacroByName = vi.mocked(fetchMacroByName);
const mockToast = vi.mocked(toast);

describe("slashCommands (extra coverage)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("SLASH_COMMANDS array", () => {
    it("contains at least /agent and /macro", () => {
      const commands = SLASH_COMMANDS.map((c) => c.command);
      expect(commands).toContain("/agent");
      expect(commands).toContain("/macro");
    });

    it("each command has required fields", () => {
      for (const cmd of SLASH_COMMANDS) {
        expect(cmd.command).toMatch(/^\//);
        expect(cmd.label).toBeTruthy();
        expect(cmd.description).toBeTruthy();
      }
    });
  });

  describe("getSlashCommandSuggestions", () => {
    it("returns all commands for '/' prefix", () => {
      const results = getSlashCommandSuggestions("/");
      expect(results.length).toBe(SLASH_COMMANDS.length);
    });

    it("returns agent command for '/a'", () => {
      const results = getSlashCommandSuggestions("/a");
      expect(results.some((c) => c.command === "/agent")).toBe(true);
    });

    it("returns macro command for '/m'", () => {
      const results = getSlashCommandSuggestions("/m");
      expect(results.some((c) => c.command === "/macro")).toBe(true);
    });

    it("returns empty array for non-matching prefix", () => {
      const results = getSlashCommandSuggestions("/zzz");
      expect(results).toHaveLength(0);
    });

    it("is case insensitive", () => {
      const results = getSlashCommandSuggestions("/Agent");
      // The function lowercases the partial, so /Agent becomes /agent
      expect(results.some((c) => c.command === "/agent")).toBe(true);
    });
  });

  describe("isSlashCommand", () => {
    it("returns command for '/agent ask me something'", () => {
      const result = isSlashCommand("/agent ask me something");
      expect(result).not.toBeNull();
      expect(result?.command).toBe("/agent");
    });

    it("returns command for '/macro run-task'", () => {
      const result = isSlashCommand("/macro run-task");
      expect(result).not.toBeNull();
      expect(result?.command).toBe("/macro");
    });

    it("returns null for regular text", () => {
      expect(isSlashCommand("hello world")).toBeNull();
    });

    it("returns null for unknown slash command", () => {
      expect(isSlashCommand("/unknown foo")).toBeNull();
    });

    it("returns command for exact match without args", () => {
      const result = isSlashCommand("/agent");
      expect(result).not.toBeNull();
      expect(result?.command).toBe("/agent");
    });

    it("is case insensitive", () => {
      const result = isSlashCommand("/AGENT test");
      expect(result).not.toBeNull();
    });
  });

  describe("/macro handler — name-to-ID resolution", () => {
    const macroHandler = SLASH_COMMANDS.find((c) => c.command === "/macro")!.handler!;

    it("does nothing for empty args", () => {
      macroHandler("   ");
      expect(mockFetchMacroByName).not.toHaveBeenCalled();
    });

    it("resolves macro name to ID before executing", async () => {
      mockFetchMacroByName.mockResolvedValueOnce({
        id: "macro-123",
        name: "deploy-all",
        description: "Deploys everything",
        steps: [],
      });
      mockGraphqlRequest.mockResolvedValueOnce({
        executeMacro: { status: "SUCCESS", message: "Done" },
      });

      macroHandler("deploy-all");

      await vi.waitFor(() => {
        expect(mockFetchMacroByName).toHaveBeenCalledWith("ws-1", "deploy-all");
      });

      await vi.waitFor(() => {
        expect(mockGraphqlRequest).toHaveBeenCalledWith(
          expect.anything(),
          {
            input: {
              macroId: "macro-123",
              commandContext: { workspaceId: "ws-1" },
            },
          },
        );
      });
    });

    it("shows error toast when macro not found", async () => {
      mockFetchMacroByName.mockResolvedValueOnce(null);

      macroHandler("nonexistent");

      await vi.waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith(
          'Macro not found: "nonexistent"',
        );
      });
    });

    it("shows error toast on network failure", async () => {
      mockFetchMacroByName.mockRejectedValueOnce(new Error("Network error"));

      macroHandler("deploy-all");

      await vi.waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith(
          "Failed to execute macro: Network error",
        );
      });
    });

    it("shows success toast after execution", async () => {
      mockFetchMacroByName.mockResolvedValueOnce({
        id: "macro-456",
        name: "test-macro",
        description: "",
        steps: [],
      });
      mockGraphqlRequest.mockResolvedValueOnce({
        executeMacro: { status: "SUCCESS", message: "OK" },
      });

      macroHandler("test-macro");

      await vi.waitFor(() => {
        expect(mockToast.success).toHaveBeenCalledWith(
          'Macro "test-macro" executed',
        );
      });
    });

    it("shows error toast when macro execution returns ERROR status", async () => {
      mockFetchMacroByName.mockResolvedValueOnce({
        id: "macro-789",
        name: "broken-macro",
        description: "",
        steps: [],
      });
      mockGraphqlRequest.mockResolvedValueOnce({
        executeMacro: { status: "ERROR", message: "Step 2 failed" },
      });

      macroHandler("broken-macro");

      await vi.waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith(
          "Macro failed: Step 2 failed",
        );
      });
    });
  });
});
