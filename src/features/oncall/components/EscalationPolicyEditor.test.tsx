import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../api/useEscalationPolicies", () => ({
  useCreateEscalationPolicy: vi.fn(),
  useUpdateEscalationPolicy: vi.fn(),
}));

vi.mock("./EscalationStepList", async () => {
  const actual =
    await vi.importActual<typeof import("./EscalationStepList")>("./EscalationStepList");
  return {
    ...actual,
    EscalationStepList: ({
      steps,
      onChange,
    }: {
      steps: unknown[];
      onChange: (steps: unknown[]) => void;
    }) => (
      <div data-testid="step-list">
        <span data-testid="step-count">{steps.length}</span>
        <button
          type="button"
          onClick={() =>
            onChange([
              {
                delaySeconds: 0,
                targetKind: "ON_CALL",
                targetUserId: "",
                targetScheduleId: "sched-1",
                actions: ["MENTION_IN_CHANNEL"],
              },
            ])
          }
        >
          Make step valid
        </button>
      </div>
    ),
  };
});

import { useCreateEscalationPolicy, useUpdateEscalationPolicy } from "../api/useEscalationPolicies";
import { EscalationPolicyEditor } from "./EscalationPolicyEditor";

function mockMutation(mutateAsync: ReturnType<typeof vi.fn>) {
  return { mutateAsync, isPending: false } as unknown;
}

describe("EscalationPolicyEditor", () => {
  beforeEach(() => {
    vi.mocked(useCreateEscalationPolicy).mockReset();
    vi.mocked(useUpdateEscalationPolicy).mockReset();
  });

  it("disables Create until the name is set and steps are valid", () => {
    vi.mocked(useCreateEscalationPolicy).mockReturnValue(
      mockMutation(vi.fn()) as ReturnType<typeof useCreateEscalationPolicy>,
    );
    vi.mocked(useUpdateEscalationPolicy).mockReturnValue(
      mockMutation(vi.fn()) as ReturnType<typeof useUpdateEscalationPolicy>,
    );

    render(<EscalationPolicyEditor open serverId="srv-1" onClose={vi.fn()} />);

    // Default draft step has no schedule/user selected -> invalid.
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
  });

  it("creates a policy once name is set and the step is valid", async () => {
    const createMutate = vi.fn().mockResolvedValue({ id: "policy-1" });
    vi.mocked(useCreateEscalationPolicy).mockReturnValue(
      mockMutation(createMutate) as ReturnType<typeof useCreateEscalationPolicy>,
    );
    vi.mocked(useUpdateEscalationPolicy).mockReturnValue(
      mockMutation(vi.fn()) as ReturnType<typeof useUpdateEscalationPolicy>,
    );

    const onClose = vi.fn();
    render(<EscalationPolicyEditor open serverId="srv-1" onClose={onClose} />);

    fireEvent.change(screen.getByPlaceholderText("e.g. Default SEV1 escalation"), {
      target: { value: "Default" },
    });
    fireEvent.click(screen.getByText("Make step valid"));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(createMutate).toHaveBeenCalledWith({
      serverId: "srv-1",
      name: "Default",
      steps: [
        {
          delaySeconds: 0,
          target: { kind: "ON_CALL", scheduleId: "sched-1" },
          actions: ["MENTION_IN_CHANNEL"],
        },
      ],
    });
  });

  it("editing an existing policy prefills steps sorted by position and calls update", async () => {
    const updateMutate = vi.fn().mockResolvedValue({ id: "policy-1" });
    vi.mocked(useCreateEscalationPolicy).mockReturnValue(
      mockMutation(vi.fn()) as ReturnType<typeof useCreateEscalationPolicy>,
    );
    vi.mocked(useUpdateEscalationPolicy).mockReturnValue(
      mockMutation(updateMutate) as ReturnType<typeof useUpdateEscalationPolicy>,
    );

    const existing = {
      id: "policy-1",
      serverId: "srv-1",
      name: "Default",
      createdBy: "u1",
      createdAt: "",
      updatedAt: "",
      steps: [
        {
          id: "step-2",
          policyId: "policy-1",
          position: 1,
          delaySeconds: 300,
          targetKind: "USER",
          targetUserId: "u2",
          targetScheduleId: null,
          actions: ["EMAIL"],
        },
        {
          id: "step-1",
          policyId: "policy-1",
          position: 0,
          delaySeconds: 0,
          targetKind: "ON_CALL",
          targetUserId: null,
          targetScheduleId: "sched-1",
          actions: ["MENTION_IN_CHANNEL"],
        },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- partial mock of a large generated type
    } as any;

    const onClose = vi.fn();
    render(<EscalationPolicyEditor open serverId="srv-1" onClose={onClose} existing={existing} />);

    // Prefilled from `existing.steps`, sorted by position — 2 steps, not the default 1.
    expect(screen.getByTestId("step-count")).toHaveTextContent("2");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ serverId: "srv-1", policyId: "policy-1", name: "Default" }),
    );
  });
});
