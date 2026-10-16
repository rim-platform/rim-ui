import { describe, it, expect, beforeEach } from "vitest";
import { act, screen } from "@testing-library/react";

import { renderWithProviders } from "../../test/utils";
import { useShellStore } from "../state/useShellStore";
import { useWorkspaceStore } from "../../features/workspaces/state/useWorkspaceStore";
import { useLayoutPresetStore } from "../state/useLayoutPresetStore";
import { BUILT_IN_PRESETS } from "../types/layoutPreset";
import { useKeybindProfileStore } from "../../features/commands/state/useKeybindProfileStore";
import { useVimStore } from "../../features/commands/state/useVimStore";
import { useConnectionStore } from "../../features/system/state/useConnectionStore";
import { StatusBar } from "./StatusBar";

describe("StatusBar", () => {
  beforeEach(() => {
    useShellStore.getState().reset();
    useWorkspaceStore.setState({ workspaceId: "srv-1" });
    useLayoutPresetStore.setState({ activePresetId: null });
  });

  it("shows the WebSocket's state, and none while no subscription uses it", () => {
    useConnectionStore.setState({ status: "connecting" });
    renderWithProviders(<StatusBar />);
    expect(screen.getByText("Connecting")).toBeInTheDocument();

    act(() => useConnectionStore.setState({ status: "connected" }));
    expect(screen.getByText("Connected")).toBeInTheDocument();
    act(() => useConnectionStore.setState({ status: "disconnected" }));
    expect(screen.getByText("Offline")).toBeInTheDocument();
    act(() => useConnectionStore.setState({ status: "idle" }));
    for (const label of ["Connecting", "Connected", "Offline"]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });

  it("shows the active layout preset", () => {
    useLayoutPresetStore.setState({ activePresetId: BUILT_IN_PRESETS[0].id });
    renderWithProviders(<StatusBar />);
    expect(screen.getByText(BUILT_IN_PRESETS[0].name)).toBeInTheDocument();
  });

  it("shows no preset label when no preset is active", () => {
    renderWithProviders(<StatusBar />);
    for (const preset of BUILT_IN_PRESETS) {
      expect(screen.queryByText(preset.name)).not.toBeInTheDocument();
    }
  });

  it("shows the Vim mode and a half-typed command only while Vim mode is on", () => {
    useVimStore.setState({ mode: "normal", pending: "" });
    renderWithProviders(<StatusBar />);
    expect(screen.getByText("COMPOSE")).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: /Vim/ })).not.toBeInTheDocument();

    act(() => useKeybindProfileStore.getState().setVimMode(true));
    try {
      expect(screen.getByRole("status", { name: "Vim normal mode" })).toHaveTextContent("NORMAL");
      expect(screen.queryByText("COMPOSE")).not.toBeInTheDocument();
      act(() => useVimStore.setState({ mode: "normal", pending: "3g" }));
      expect(screen.getByRole("status", { name: "Vim normal mode" })).toHaveTextContent("NORMAL3g");
      act(() => useVimStore.setState({ mode: "insert", pending: "" }));
      expect(screen.getByRole("status", { name: "Vim insert mode" })).toHaveTextContent("INSERT");
    } finally {
      act(() => useKeybindProfileStore.getState().setVimMode(false));
    }
  });
});
