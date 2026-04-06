import { describe, it, expect, vi } from "vitest";

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

import { getSlashCommandSuggestions, isSlashCommand, SLASH_COMMANDS } from "./slashCommands";

describe("slashCommands (extra coverage)", () => {
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
});
