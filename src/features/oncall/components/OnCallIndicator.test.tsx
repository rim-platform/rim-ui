import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../api/useServerOnCall", () => ({ useServerOnCall: vi.fn() }));

import { useServerOnCall } from "../api/useServerOnCall";
import { useShellStore } from "../../../shell/state/useShellStore";
import { OnCallIndicator } from "./OnCallIndicator";

describe("OnCallIndicator", () => {
  beforeEach(() => {
    vi.mocked(useServerOnCall).mockReset();
    useShellStore.getState().reset();
  });

  it("renders nothing when there is no resolved current on-call", () => {
    vi.mocked(useServerOnCall).mockReturnValue({ data: [] } as ReturnType<typeof useServerOnCall>);
    const { container } = render(<OnCallIndicator serverId="srv-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the single on-call user's name", () => {
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
    render(<OnCallIndicator serverId="srv-1" />);
    expect(screen.getByText("On-call: @Alice")).toBeInTheDocument();
  });

  it("shows a count when multiple schedules have someone on call", () => {
    vi.mocked(useServerOnCall).mockReturnValue({
      data: [
        {
          scheduleId: "s1",
          shiftEndsAt: null,
          currentUser: { displayName: "Alice", username: "alice" },
          nextUser: null,
        },
        {
          scheduleId: "s2",
          shiftEndsAt: null,
          currentUser: { displayName: "Bob", username: "bob" },
          nextUser: null,
        },
      ],
    } as ReturnType<typeof useServerOnCall>);
    render(<OnCallIndicator serverId="srv-1" />);
    expect(screen.getByText("On-call: 2")).toBeInTheDocument();
  });

  it("clicking navigates to the Incidents surface's On-call sub-tab", () => {
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
    render(<OnCallIndicator serverId="srv-1" />);
    fireEvent.click(screen.getByText("On-call: @Alice"));
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "incidents", tab: "oncall" });
  });
});
