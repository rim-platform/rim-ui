import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import type { CommandDefinition } from "../types";

const OPEN_AGENT: CommandDefinition = {
  id: "workspace.open_agent",
  title: "Open AI Agent",
  description: "Open the AI agent.",
  category: "Agent",
  sourceKind: "BUILT_IN",
  executionTarget: "DESKTOP_LOCAL",
  requiredContext: [],
  requiredCapabilities: [],
  visibleInPalette: true,
  visibleInContextMenus: false,
  keybindCapable: true,
  dangerous: false,
};

vi.mock("../api/useCommands", () => ({
  useCommands: vi.fn(() => ({ data: [OPEN_AGENT], isLoading: false })),
  useExecuteCommandMutation: vi.fn(() => ({ mutateAsync: vi.fn() })),
}));

vi.mock("../../plugins/api/usePluginCommands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../plugins/api/usePluginCommands")>()),
  usePluginCommands: vi.fn(() => []),
}));

vi.mock("../../plugins/registry/palette", () => ({
  isRegistryPaletteItem: () => false,
  useRegistryPaletteItems: vi.fn(() => []),
}));

vi.mock("../runtime/effectiveKeybinds", () => ({
  useEffectiveKeybinds: vi.fn(() => []),
}));

import { CommandPalette } from "./CommandPalette";
import { useCommandStore } from "../state/useCommandStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";

/** Opens the palette, types `query` into its search and returns the text the palette shows. */
function searchPalette(query: string): string {
  const { container } = render(<CommandPalette />);
  act(() => useCommandStore.getState().openCommandPalette());
  fireEvent.change(screen.getByPlaceholderText("Type a command..."), {
    target: { value: query },
  });
  return container.ownerDocument.body.textContent ?? "";
}

describe("CommandPalette and the AI agent", () => {
  beforeEach(() => {
    useWorkspaceStore.getState().setWorkspaceId("ws-1");
  });

  afterEach(() => {
    act(() => useCommandStore.getState().closeCommandPalette());
    useWorkspaceStore.getState().clearWorkspaceId();
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("does not list Open AI Agent on the web", () => {
    expect(searchPalette("agent")).not.toContain("Open AI Agent");
  });

  it("lists Open AI Agent in the desktop app", () => {
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    expect(searchPalette("agent")).toContain("Open AI Agent");
  });
});
