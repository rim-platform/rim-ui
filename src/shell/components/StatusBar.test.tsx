import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";

import { renderWithProviders } from "../../test/utils";
import { useShellStore } from "../state/useShellStore";
import { useWorkspaceStore } from "../../features/workspaces/state/useWorkspaceStore";
import { SkillTier, useDisclosureStore } from "../../features/disclosure/state/useDisclosureStore";
import { useLayoutPresetStore } from "../state/useLayoutPresetStore";
import { BUILT_IN_PRESETS } from "../types/layoutPreset";

vi.mock("../../features/oncall/api/useServerOnCall", () => ({ useServerOnCall: vi.fn() }));
vi.mock("../../features/workspaces/hooks/useFeatureEnabled", () => ({
  useFeatureEnabled: vi.fn(() => true),
}));

import { useServerOnCall } from "../../features/oncall/api/useServerOnCall";
import { useFeatureEnabled } from "../../features/workspaces/hooks/useFeatureEnabled";
import { StatusBar } from "./StatusBar";
import { act } from "@testing-library/react";
import { useKeybindProfileStore } from "../../features/commands/state/useKeybindProfileStore";
import { useVimStore } from "../../features/commands/state/useVimStore";

describe("StatusBar", () => {
  beforeEach(() => {
    useShellStore.getState().reset();
    useWorkspaceStore.setState({ workspaceId: "srv-1" });
    vi.mocked(useServerOnCall).mockReset();
    vi.mocked(useFeatureEnabled).mockReturnValue(true);
    useDisclosureStore.setState({
      skillTier: SkillTier.BEGINNER,
      featuresUsed: new Set(),
      isLoaded: true,
    });
    useLayoutPresetStore.setState({ activePresetId: null });
  });

  it("hides the active layout preset from BEGINNER users (DisclosureGate)", () => {
    vi.mocked(useServerOnCall).mockReturnValue({ data: [] } as ReturnType<typeof useServerOnCall>);
    useLayoutPresetStore.setState({ activePresetId: BUILT_IN_PRESETS[0].id });
    renderWithProviders(<StatusBar />);
    expect(screen.queryByText(BUILT_IN_PRESETS[0].name)).not.toBeInTheDocument();
  });

  it("shows the active layout preset to ADVANCED users", () => {
    vi.mocked(useServerOnCall).mockReturnValue({ data: [] } as ReturnType<typeof useServerOnCall>);
    useDisclosureStore.setState({ skillTier: SkillTier.ADVANCED });
    useLayoutPresetStore.setState({ activePresetId: BUILT_IN_PRESETS[0].id });
    renderWithProviders(<StatusBar />);
    expect(screen.getByText(BUILT_IN_PRESETS[0].name)).toBeInTheDocument();
  });

  it("renders without the on-call indicator when no schedule has a current on-call", () => {
    vi.mocked(useServerOnCall).mockReturnValue({ data: [] } as ReturnType<typeof useServerOnCall>);
    renderWithProviders(<StatusBar />);
    expect(screen.queryByText(/On-call:/)).not.toBeInTheDocument();
  });

  it("renders the on-call indicator in the right cluster when someone is on call", () => {
    vi.mocked(useServerOnCall).mockReturnValue({
      data: [
        {
          scheduleId: "s1",
          shiftEndsAt: null,
          currentUser: { displayName: "Alice", username: "alice" },
          nextUser: null,
        },
      ],
    } as ReturnType<typeof useServerOnCall>);
    renderWithProviders(<StatusBar />);
    expect(screen.getByText("On-call: @Alice")).toBeInTheDocument();
  });

  it("hides the on-call indicator when the incidents module is off", () => {
    vi.mocked(useFeatureEnabled).mockReturnValue(false);
    vi.mocked(useServerOnCall).mockReturnValue({
      data: [
        {
          scheduleId: "s1",
          shiftEndsAt: null,
          currentUser: { displayName: "Alice", username: "alice" },
          nextUser: null,
        },
      ],
    } as ReturnType<typeof useServerOnCall>);
    renderWithProviders(<StatusBar />);
    expect(screen.queryByText(/On-call:/)).not.toBeInTheDocument();
  });

  it("shows the Vim mode and a half-typed command only while Vim mode is on", () => {
    vi.mocked(useServerOnCall).mockReturnValue({ data: [] } as ReturnType<typeof useServerOnCall>);
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
