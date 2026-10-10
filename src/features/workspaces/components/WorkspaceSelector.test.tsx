import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { expectReachableByKeyboard } from "../../../test/keyboard";

const setWorkspaceId = vi.fn();
const workspace = vi.hoisted(() => ({ id: null as string | null }));

vi.mock("../state/useWorkspaceStore", () => ({
  useWorkspaceStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ workspaceId: workspace.id, setWorkspaceId }),
}));

vi.mock("../api/useMyServers", () => ({
  useMyServers: () => ({
    data: [
      { id: "ws-1", name: "Alpha" },
      { id: "ws-2", name: "Beta" },
    ],
    isPending: false,
    isError: false,
  }),
}));

import { WorkspaceSelector } from "./WorkspaceSelector";

describe("WorkspaceSelector", () => {
  beforeEach(() => {
    setWorkspaceId.mockClear();
    // A workspace is already chosen, so the selector does not pick the first one itself.
    workspace.id = "ws-1";
  });

  it("reaches every workspace by keyboard and picks one with Enter", async () => {
    const user = userEvent.setup();
    render(<WorkspaceSelector />);
    const beta = screen.getByRole("button", { name: /Beta/ });
    await expectReachableByKeyboard(user, [screen.getByRole("button", { name: /Alpha/ }), beta]);
    beta.focus();
    await user.keyboard("{Enter}");
    expect(setWorkspaceId).toHaveBeenCalledWith("ws-2");
  });
});
