import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../workspaces/api/useServerMembers", () => ({ useServerMembers: vi.fn() }));
vi.mock("../api/useOnCallSchedules", () => ({ useOnCallSchedules: vi.fn() }));

import { useServerMembers } from "../../workspaces/api/useServerMembers";
import { useOnCallSchedules } from "../api/useOnCallSchedules";
import {
  EscalationStepList,
  makeEmptyDraftStep,
  type DraftEscalationStep,
} from "./EscalationStepList";
import {
  EscalationActionKindGql,
  EscalationTargetKindGql,
} from "../../../core/graphql/generated/schema-types";

const members = [
  { userId: "u1", username: "alice", displayName: "Alice", memberRole: "OWNER", joinedAt: "" },
];
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

function setup(steps: DraftEscalationStep[], onChange = vi.fn()) {
  vi.mocked(useServerMembers).mockReturnValue({ data: members } as ReturnType<
    typeof useServerMembers
  >);
  vi.mocked(useOnCallSchedules).mockReturnValue({ data: schedules } as ReturnType<
    typeof useOnCallSchedules
  >);
  render(<EscalationStepList serverId="srv-1" steps={steps} onChange={onChange} />);
  return { onChange };
}

describe("EscalationStepList", () => {
  beforeEach(() => {
    vi.mocked(useServerMembers).mockReset();
    vi.mocked(useOnCallSchedules).mockReset();
  });

  it("renders the read-only stepper preview with delay + resolved target label", () => {
    const step = { ...makeEmptyDraftStep(), targetScheduleId: "sched-1" };
    setup([step]);
    expect(screen.getByText(/immediately/)).toBeInTheDocument();
    expect(screen.getByText(/@on-call \(Primary\)/)).toBeInTheDocument();
  });

  it("switching target kind to USER shows the user picker instead of the schedule picker", () => {
    const step = makeEmptyDraftStep();
    const { onChange } = setup([step]);

    fireEvent.change(screen.getByLabelText("Target kind"), {
      target: { value: EscalationTargetKindGql.USER },
    });

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ targetKind: EscalationTargetKindGql.USER }),
    ]);
  });

  it("reorders steps via the move-down button", () => {
    const stepA = { ...makeEmptyDraftStep(), delaySeconds: 0 };
    const stepB = { ...makeEmptyDraftStep(), delaySeconds: 300 };
    const { onChange } = setup([stepA, stepB]);

    fireEvent.click(screen.getByLabelText("Move step 1 down"));

    expect(onChange).toHaveBeenCalledWith([stepB, stepA]);
  });

  it("reorders steps via j/k on a focused row", () => {
    const stepA = { ...makeEmptyDraftStep(), delaySeconds: 0 };
    const stepB = { ...makeEmptyDraftStep(), delaySeconds: 300 };
    const { onChange } = setup([stepA, stepB]);

    const rows = screen.getAllByRole("listitem");
    fireEvent.keyDown(rows[0], { key: "j" });

    expect(onChange).toHaveBeenCalledWith([stepB, stepA]);
  });

  it("toggles an action checkbox", () => {
    const step = makeEmptyDraftStep();
    const { onChange } = setup([step]);

    fireEvent.click(screen.getByLabelText("Email"));

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        actions: [EscalationActionKindGql.MENTION_IN_CHANNEL, EscalationActionKindGql.EMAIL],
      }),
    ]);
  });

  it("removes a step", () => {
    const step = makeEmptyDraftStep();
    const { onChange } = setup([step]);

    fireEvent.click(screen.getByLabelText("Remove step 1"));

    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("adds a new step", () => {
    const { onChange } = setup([]);
    fireEvent.click(screen.getByText("+ Add step"));
    expect(onChange).toHaveBeenCalledWith([makeEmptyDraftStep()]);
  });
});
