import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";

import { renderWithProviders } from "../../test/utils";
import { useShellStore } from "../state/useShellStore";
import { useWorkspaceStore } from "../../features/workspaces/state/useWorkspaceStore";

vi.mock("../../features/oncall/api/useServerOnCall", () => ({ useServerOnCall: vi.fn() }));
vi.mock("../../features/workspaces/hooks/useFeatureEnabled", () => ({
  useFeatureEnabled: vi.fn(() => true),
}));

import { useServerOnCall } from "../../features/oncall/api/useServerOnCall";
import { useFeatureEnabled } from "../../features/workspaces/hooks/useFeatureEnabled";
import { StatusBar } from "./StatusBar";

describe("StatusBar", () => {
  beforeEach(() => {
    useShellStore.getState().reset();
    useWorkspaceStore.setState({ workspaceId: "srv-1" });
    vi.mocked(useServerOnCall).mockReset();
    vi.mocked(useFeatureEnabled).mockReturnValue(true);
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
});
