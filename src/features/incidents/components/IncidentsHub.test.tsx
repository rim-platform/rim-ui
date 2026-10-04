import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("./IncidentHistoryPage", () => ({
  IncidentHistoryPage: ({ embedded }: { embedded?: boolean }) => (
    <div data-testid="incident-history-page">History (embedded={String(embedded)})</div>
  ),
}));
vi.mock("../../oncall/components/OnCallSubTab", () => ({
  OnCallSubTab: ({ serverId }: { serverId: string }) => (
    <div data-testid="oncall-subtab">On-call for {serverId}</div>
  ),
}));
vi.mock("../../oncall/components/EscalationSubTab", () => ({
  EscalationSubTab: ({ serverId }: { serverId: string }) => (
    <div data-testid="escalation-subtab">Escalation for {serverId}</div>
  ),
}));

import { useShellStore } from "../../../shell/state/useShellStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useDisclosureStore, SkillTier } from "../../disclosure/state/useDisclosureStore";
import { IncidentsHub } from "./IncidentsHub";

describe("IncidentsHub", () => {
  beforeEach(() => {
    useShellStore.getState().reset();
    useWorkspaceStore.setState({ workspaceId: "srv-1" });
    useDisclosureStore.setState({
      isLoaded: true,
      skillTier: SkillTier.INTERMEDIATE,
      featuresUsed: new Set(),
    });
  });

  it("defaults to the History sub-tab, rendering IncidentHistoryPage embedded", () => {
    render(<IncidentsHub />);
    expect(screen.getByTestId("incident-history-page")).toHaveTextContent("embedded=true");
  });

  it("switches to the On-call sub-tab and passes the current serverId", () => {
    render(<IncidentsHub />);
    fireEvent.click(screen.getByRole("button", { name: "On-call" }));
    expect(screen.getByTestId("oncall-subtab")).toHaveTextContent("On-call for srv-1");
  });

  it("switches to the Escalation sub-tab and passes the current serverId", () => {
    render(<IncidentsHub />);
    fireEvent.click(screen.getByRole("button", { name: "Escalation" }));
    expect(screen.getByTestId("escalation-subtab")).toHaveTextContent("Escalation for srv-1");
  });

  it("hides the Escalation tab for a BEGINNER skill tier (DisclosureGate)", () => {
    useDisclosureStore.setState({
      isLoaded: true,
      skillTier: SkillTier.BEGINNER,
      featuresUsed: new Set(),
    });
    render(<IncidentsHub />);
    expect(screen.queryByRole("button", { name: "Escalation" })).not.toBeInTheDocument();
  });

  it("respects the deep-linked tab from mainSurface", () => {
    useShellStore.getState().setMainSurface({ kind: "incidents", tab: "oncall" });
    render(<IncidentsHub />);
    expect(screen.getByTestId("oncall-subtab")).toBeInTheDocument();
  });

  it("gates the Escalation tab BODY too, not just its entry-point button — a BEGINNER deep-linked straight to it sees nothing", () => {
    useDisclosureStore.setState({
      isLoaded: true,
      skillTier: SkillTier.BEGINNER,
      featuresUsed: new Set(),
    });
    useShellStore.getState().setMainSurface({ kind: "incidents", tab: "escalation" });
    render(<IncidentsHub />);
    expect(screen.queryByTestId("escalation-subtab")).not.toBeInTheDocument();
  });

  it("closing returns to the conversation surface", () => {
    render(<IncidentsHub />);
    fireEvent.click(screen.getByRole("button", { name: "Close incidents" }));
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "conversation" });
  });
});
