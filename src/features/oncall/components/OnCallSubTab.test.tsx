import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../workspaces/api/useMyServerRole", () => ({ useCanManageOnCall: vi.fn() }));
vi.mock("../api/useOnCallSchedules", () => ({ useOnCallSchedules: vi.fn() }));
vi.mock("../api/useServerOnCall", () => ({ useServerOnCall: vi.fn() }));
vi.mock("../api/useOnCallShifts", () => ({ useOnCallShifts: vi.fn() }));
vi.mock("./ScheduleEditor", () => ({
  ScheduleEditor: ({ existing }: { existing?: { name: string } }) => (
    <div data-testid="schedule-editor">{existing ? `Editing ${existing.name}` : "Creating"}</div>
  ),
}));
vi.mock("./OverrideModal", () => ({
  OverrideModal: () => <div data-testid="override-modal">Override modal</div>,
}));

import { useCanManageOnCall } from "../../workspaces/api/useMyServerRole";
import { useOnCallSchedules } from "../api/useOnCallSchedules";
import { useServerOnCall } from "../api/useServerOnCall";
import { useOnCallShifts } from "../api/useOnCallShifts";
import { OnCallSubTab } from "./OnCallSubTab";

const schedule = {
  id: "sched-1",
  serverId: "srv-1",
  name: "Primary",
  timezone: "UTC",
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
};

function mockAs(canManage: boolean, schedules: unknown[] = [schedule]) {
  vi.mocked(useCanManageOnCall).mockReturnValue(canManage);
  vi.mocked(useOnCallSchedules).mockReturnValue({ data: schedules, isPending: false } as ReturnType<
    typeof useOnCallSchedules
  >);
  vi.mocked(useServerOnCall).mockReturnValue({
    data: [
      {
        scheduleId: "sched-1",
        shiftEndsAt: "",
        currentUser: { displayName: "Alice", username: "alice" },
        nextUser: null,
      },
    ],
  } as ReturnType<typeof useServerOnCall>);
  vi.mocked(useOnCallShifts).mockReturnValue({ data: [] } as ReturnType<typeof useOnCallShifts>);
}

describe("OnCallSubTab", () => {
  beforeEach(() => {
    vi.mocked(useCanManageOnCall).mockReset();
    vi.mocked(useOnCallSchedules).mockReset();
    vi.mocked(useServerOnCall).mockReset();
    vi.mocked(useOnCallShifts).mockReset();
  });

  it("shows create/take-shift affordances for Owner/Moderator", () => {
    mockAs(true);
    render(<OnCallSubTab serverId="srv-1" />);
    expect(screen.getByRole("button", { name: /create schedule/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /take shift/i })).toBeInTheDocument();
  });

  it("hides create/take-shift affordances for a Guest", () => {
    mockAs(false);
    render(<OnCallSubTab serverId="srv-1" />);
    expect(screen.queryByRole("button", { name: /create schedule/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /take shift/i })).not.toBeInTheDocument();
  });

  it("shows the current on-call user resolved from the batch resolver", () => {
    mockAs(true);
    render(<OnCallSubTab serverId="srv-1" />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("shows the empty state when there are no schedules", () => {
    mockAs(true, []);
    render(<OnCallSubTab serverId="srv-1" />);
    expect(screen.getByText("No on-call schedules yet.")).toBeInTheDocument();
  });

  it("opens the create-schedule editor", () => {
    mockAs(true);
    render(<OnCallSubTab serverId="srv-1" />);
    fireEvent.click(screen.getByRole("button", { name: /create schedule/i }));
    expect(screen.getByText("Creating")).toBeInTheDocument();
  });

  it("opens the take-shift override modal", () => {
    mockAs(true);
    render(<OnCallSubTab serverId="srv-1" />);
    fireEvent.click(screen.getByRole("button", { name: /take shift/i }));
    expect(screen.getByTestId("override-modal")).toBeInTheDocument();
  });
});
