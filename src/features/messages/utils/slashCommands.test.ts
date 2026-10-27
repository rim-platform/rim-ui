import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

vi.mock("../../agent/state/useAgentStore", () => ({
  useAgentStore: {
    getState: vi.fn(() => ({ open: vi.fn() })),
  },
}));

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: vi.fn() },
}));

vi.mock("../../workspaces/state/useWorkspaceStore", () => ({
  useWorkspaceStore: {
    getState: vi.fn(() => ({ workspaceId: "ws-1" })),
  },
}));

vi.mock("../../macros/api/useMacros", () => ({
  fetchMacroByName: vi.fn(),
}));

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

import { getSlashCommandSuggestions, isSlashCommand, SLASH_COMMANDS } from "./slashCommands";

/** Makes the app the desktop app, where the agent runs. */
function onDesktop() {
  (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
}

function offDesktop() {
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
}

describe("getSlashCommandSuggestions", () => {
  beforeEach(onDesktop);
  afterEach(offDesktop);

  it("returns all commands for /", () => {
    const suggestions = getSlashCommandSuggestions("/");
    expect(suggestions.length).toBe(SLASH_COMMANDS.length);
  });

  it("returns matching commands for /a", () => {
    const suggestions = getSlashCommandSuggestions("/a");
    expect(suggestions.some((c) => c.command === "/agent")).toBe(true);
  });

  it("returns matching commands for /m", () => {
    const suggestions = getSlashCommandSuggestions("/m");
    expect(suggestions.some((c) => c.command === "/macro")).toBe(true);
  });

  it("returns empty for non-matching prefix", () => {
    const suggestions = getSlashCommandSuggestions("/zzz");
    expect(suggestions).toEqual([]);
  });
});

describe("getSlashCommandSuggestions on the web", () => {
  it("does not suggest /agent on the web but still recognizes it", () => {
    expect(getSlashCommandSuggestions("/a").some((c) => c.command === "/agent")).toBe(false);
    expect(isSlashCommand("/agent hi")?.command).toBe("/agent");
  });
});

describe("isSlashCommand", () => {
  it("recognizes /agent command", () => {
    const result = isSlashCommand("/agent some question");
    expect(result).not.toBeNull();
    expect(result!.command).toBe("/agent");
  });

  it("recognizes /macro command", () => {
    const result = isSlashCommand("/macro my-macro");
    expect(result).not.toBeNull();
    expect(result!.command).toBe("/macro");
  });

  it("returns null for non-slash text", () => {
    expect(isSlashCommand("hello world")).toBeNull();
  });

  it("returns null for unknown slash command", () => {
    expect(isSlashCommand("/unknown stuff")).toBeNull();
  });

  it("is case-insensitive", () => {
    const result = isSlashCommand("/AGENT question");
    expect(result).not.toBeNull();
  });
});
