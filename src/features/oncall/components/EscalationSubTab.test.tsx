import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../workspaces/api/useMyServerRole", () => ({ useCanManageOnCall: vi.fn() }));
vi.mock("../api/useEscalationPolicies", () => ({
  useEscalationPolicies: vi.fn(),
  useSetChannelEscalationPolicy: vi.fn(),
}));
vi.mock("../../conversations/api/useChannels", () => ({ useChannels: vi.fn() }));
vi.mock("./EscalationPolicyEditor", () => ({
  EscalationPolicyEditor: ({ existing }: { existing?: { name: string } }) => (
    <div data-testid="policy-editor">{existing ? `Editing ${existing.name}` : "Creating"}</div>
  ),
}));

import { useCanManageOnCall } from "../../workspaces/api/useMyServerRole";
import { useEscalationPolicies, useSetChannelEscalationPolicy } from "../api/useEscalationPolicies";
import { useChannels } from "../../conversations/api/useChannels";
import { EscalationSubTab } from "./EscalationSubTab";
import { EscalationTargetKindGql } from "../../../core/graphql/generated/schema-types";

const policy = {
  id: "policy-1",
  serverId: "srv-1",
  name: "Default",
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
  steps: [
    {
      id: "step-1",
      policyId: "policy-1",
      position: 0,
      delaySeconds: 0,
      targetKind: EscalationTargetKindGql.ON_CALL,
      targetUserId: null,
      targetScheduleId: "sched-1",
      actions: [],
    },
  ],
};

function mockAs(canManage: boolean, policies: unknown[] = [policy]) {
  vi.mocked(useCanManageOnCall).mockReturnValue(canManage);
  vi.mocked(useEscalationPolicies).mockReturnValue({
    data: policies,
    isPending: false,
  } as ReturnType<typeof useEscalationPolicies>);
  vi.mocked(useChannels).mockReturnValue({
    data: { items: [{ id: "conv-1", title: "general" }] },
  } as ReturnType<typeof useChannels>);
  vi.mocked(useSetChannelEscalationPolicy).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useSetChannelEscalationPolicy>);
}

describe("EscalationSubTab", () => {
  beforeEach(() => {
    vi.mocked(useCanManageOnCall).mockReset();
    vi.mocked(useEscalationPolicies).mockReset();
    vi.mocked(useChannels).mockReset();
    vi.mocked(useSetChannelEscalationPolicy).mockReset();
  });

  it("shows the policy stepper and gates create/edit/channel-binding on canManageOnCall", () => {
    mockAs(true);
    render(<EscalationSubTab serverId="srv-1" />);
    expect(screen.getAllByText("Default").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /create policy/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByText("Channel default policies")).toBeInTheDocument();
  });

  it("hides create/edit/channel-binding for a Guest", () => {
    mockAs(false);
    render(<EscalationSubTab serverId="srv-1" />);
    expect(screen.queryByRole("button", { name: /create policy/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByText("Channel default policies")).not.toBeInTheDocument();
  });

  it("shows the empty state when there are no policies", () => {
    mockAs(true, []);
    render(<EscalationSubTab serverId="srv-1" />);
    expect(screen.getByText("No escalation policies yet.")).toBeInTheDocument();
  });

  it("opens the create-policy editor", () => {
    mockAs(true);
    render(<EscalationSubTab serverId="srv-1" />);
    fireEvent.click(screen.getByRole("button", { name: /create policy/i }));
    expect(screen.getByText("Creating")).toBeInTheDocument();
  });

  it("opens the edit-policy editor for an existing policy", () => {
    mockAs(true);
    render(<EscalationSubTab serverId="srv-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByText("Editing Default")).toBeInTheDocument();
  });
});
