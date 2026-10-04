import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../workspaces/api/useCurrentUser", () => ({ useCurrentUser: vi.fn() }));
vi.mock("../../workspaces/api/useServerMembers", () => ({ useServerMembers: vi.fn() }));
vi.mock("../api/useOnCallSchedules", () => ({
  useOnCallSchedules: vi.fn(),
  useCreateOnCallOverride: vi.fn(),
}));
vi.mock("../api/useWhoIsOnCall", () => ({ useWhoIsOnCall: vi.fn() }));

import { useCurrentUser } from "../../workspaces/api/useCurrentUser";
import { useServerMembers } from "../../workspaces/api/useServerMembers";
import { useOnCallSchedules, useCreateOnCallOverride } from "../api/useOnCallSchedules";
import { useWhoIsOnCall } from "../api/useWhoIsOnCall";
import { OverrideModal } from "./OverrideModal";

const me = {
  id: "u1",
  username: "alice",
  displayName: "Alice",
  avatarUrl: null,
  statusText: null,
  bio: null,
};
const schedules = [
  {
    id: "sched-1",
    serverId: "srv-1",
    name: "Primary",
    timezone: "UTC",
    createdBy: "u1",
    createdAt: "",
    updatedAt: "",
  },
];

function setupMocks({
  shiftEndsAt = "2026-07-09T12:00:00Z",
  mutate = vi.fn(),
  isPending = false,
  isError = false,
}: {
  shiftEndsAt?: string;
  mutate?: ReturnType<typeof vi.fn>;
  isPending?: boolean;
  isError?: boolean;
} = {}) {
  vi.mocked(useCurrentUser).mockReturnValue({ data: me } as ReturnType<typeof useCurrentUser>);
  vi.mocked(useServerMembers).mockReturnValue({
    data: [
      { userId: "u2", username: "bob", displayName: "Bob", memberRole: "GUEST", joinedAt: "" },
    ],
  } as ReturnType<typeof useServerMembers>);
  vi.mocked(useOnCallSchedules).mockReturnValue({ data: schedules } as ReturnType<
    typeof useOnCallSchedules
  >);
  vi.mocked(useWhoIsOnCall).mockReturnValue({ data: { shiftEndsAt } } as ReturnType<
    typeof useWhoIsOnCall
  >);
  vi.mocked(useCreateOnCallOverride).mockReturnValue({
    mutate,
    isPending,
    isError,
  } as unknown as ReturnType<typeof useCreateOnCallOverride>);
  return { mutate };
}

describe("OverrideModal", () => {
  beforeEach(() => {
    vi.mocked(useCurrentUser).mockReset();
    vi.mocked(useServerMembers).mockReset();
    vi.mocked(useOnCallSchedules).mockReset();
    vi.mocked(useWhoIsOnCall).mockReset();
    vi.mocked(useCreateOnCallOverride).mockReset();
  });

  it("defaults 'who' to me and shows the schedule picker when no schedule is preselected", () => {
    setupMocks();
    render(<OverrideModal open serverId="srv-1" onClose={vi.fn()} />);
    expect(screen.getByText("Schedule")).toBeInTheDocument();
    expect(screen.getByText("Alice (me)")).toBeInTheDocument();
  });

  it("hides the schedule picker when a schedule is preselected", () => {
    setupMocks();
    render(<OverrideModal open serverId="srv-1" onClose={vi.fn()} initialScheduleId="sched-1" />);
    expect(screen.queryByText("Schedule")).not.toBeInTheDocument();
  });

  it("shows the default window as now -> the schedule's shiftEndsAt", () => {
    setupMocks({ shiftEndsAt: "2026-07-09T12:00:00Z" });
    render(<OverrideModal open serverId="srv-1" onClose={vi.fn()} initialScheduleId="sched-1" />);
    expect(screen.getByText(/Now → end of current shift/)).toBeInTheDocument();
  });

  it("confirms with the default now/shiftEndsAt window on submit", async () => {
    const { mutate } = setupMocks({ shiftEndsAt: "2026-07-09T12:00:00Z" });
    const onClose = vi.fn();
    render(<OverrideModal open serverId="srv-1" onClose={onClose} initialScheduleId="sched-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Take shift" }));

    expect(mutate).toHaveBeenCalledTimes(1);
    const [args, opts] = mutate.mock.calls[0];
    expect(args).toMatchObject({ scheduleId: "sched-1", userId: "u1" });
    expect(new Date(args.endAt).toISOString()).toBe(new Date("2026-07-09T12:00:00Z").toISOString());

    opts.onSuccess();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("lets the user pick someone else ('cover for')", () => {
    const { mutate } = setupMocks();
    render(<OverrideModal open serverId="srv-1" onClose={vi.fn()} initialScheduleId="sched-1" />);

    fireEvent.change(screen.getByDisplayValue("Alice (me)"), { target: { value: "u2" } });
    fireEvent.click(screen.getByRole("button", { name: "Take shift" }));

    expect(mutate.mock.calls[0][0]).toMatchObject({ userId: "u2" });
  });

  it("submits a custom time range when toggled on", () => {
    const { mutate } = setupMocks();
    render(<OverrideModal open serverId="srv-1" onClose={vi.fn()} initialScheduleId="sched-1" />);

    fireEvent.click(screen.getByLabelText("Custom time range"));
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "2026-08-01T00:00" } });
    fireEvent.change(screen.getByLabelText("End"), { target: { value: "2026-08-02T00:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Take shift" }));

    const [args] = mutate.mock.calls[0];
    expect(new Date(args.startAt).toISOString()).toBe(new Date("2026-08-01T00:00").toISOString());
    expect(new Date(args.endAt).toISOString()).toBe(new Date("2026-08-02T00:00").toISOString());
  });

  it("shows an error message when the mutation fails", () => {
    setupMocks({ isError: true });
    render(<OverrideModal open serverId="srv-1" onClose={vi.fn()} initialScheduleId="sched-1" />);
    expect(screen.getByText("Failed to create override.")).toBeInTheDocument();
  });
});
