import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import type { CommandDefinition } from "../types";

const OPEN_AGENT: CommandDefinition = {
  id: "workspace.open_agent",
  title: "Open AI Agent",
  description: "Open the AI agent.",
  category: "Agents",
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

import { queryClient } from "../../../core/query/queryClient";

function Providers({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

/** Opens the palette, types `query` into its search and returns the text the palette shows. */
function searchPalette(query: string): string {
  const { container } = render(<CommandPalette />, { wrapper: Providers });
  act(() => useCommandStore.getState().openCommandPalette());
  fireEvent.change(screen.getByPlaceholderText("Type a command..."), {
    target: { value: query },
  });
  return container.ownerDocument.body.textContent ?? "";
}

describe("CommandPalette and the assistant", () => {
  beforeEach(() => {
    useWorkspaceStore.getState().setWorkspaceId("ws-1");
  });

  afterEach(() => {
    act(() => useCommandStore.getState().closeCommandPalette());
    useWorkspaceStore.getState().clearWorkspaceId();
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("does not list Open Assistant on the web", () => {
    expect(searchPalette("assistant")).not.toContain("Open Assistant");
  });

  it("lists Open Assistant in the desktop app, under Assistant & Agents", () => {
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    const shown = searchPalette("assistant");
    expect(shown).toContain("Open Assistant");
    expect(shown).toContain("Open the assistant panel");
    expect(shown).toContain("Assistant & Agents");
    expect(shown).not.toContain("Open AI Agent");
  });

  it("does not list Quit RIM on the web", () => {
    expect(searchPalette("quit")).not.toContain("Quit RIM");
  });

  it("lists Quit RIM in the desktop app", () => {
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    expect(searchPalette("quit")).toContain("Quit RIM");
  });
});
