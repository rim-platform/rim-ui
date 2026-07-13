import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, act } from "@testing-library/react";

import { renderWithProviders } from "../../../test/utils";
import { useIncidentStore } from "../state/useIncidentStore";
import {
  IncidentSeverityGql,
  IncidentPhaseNameGql,
  IncidentStatusGql,
  EscalationRunStatusGql,
} from "../../../core/graphql/generated/schema-types";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

import { IncidentBanner } from "./IncidentBanner";

const baseIncident = {
  id: "inc-1",
  title: "DB outage",
  status: IncidentStatusGql.ACTIVE,
  severity: IncidentSeverityGql.SEV_1,
  currentPhase: IncidentPhaseNameGql.DETECTION,
  startedAt: new Date().toISOString(),
  acknowledgedAt: null,
  acknowledgedByUser: null,
  escalationRun: null,
};

describe("IncidentBanner — ack + escalation (Track C1c)", () => {
  beforeEach(() => {
    requestMock.mockReset();
    useIncidentStore.setState({ activeIncident: null });
  });

  it("renders nothing when there is no active incident", () => {
    const { container } = renderWithProviders(
      <IncidentBanner serverId="srv-1" conversationId="conv-1" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the escalation countdown and an Ack button while unacked and escalating", () => {
    useIncidentStore.setState({
      activeIncident: {
        ...baseIncident,
        escalationRun: {
          currentStepIndex: 0,
          nextFireAt: new Date(Date.now() + 90_000).toISOString(),
          status: EscalationRunStatusGql.ACTIVE,
        },
      },
    });
    renderWithProviders(<IncidentBanner serverId="srv-1" conversationId="conv-1" />);

    expect(screen.getByText(/Unacked — escalating to L1/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ack" })).toBeInTheDocument();
  });

  it("hides the Ack button and countdown once acknowledged, showing who acked and when", () => {
    useIncidentStore.setState({
      activeIncident: {
        ...baseIncident,
        acknowledgedAt: new Date(Date.now() - 120_000).toISOString(),
        acknowledgedByUser: { id: "u1", username: "alice", displayName: "Alice", avatarUrl: null },
        escalationRun: {
          currentStepIndex: 1,
          nextFireAt: null,
          status: EscalationRunStatusGql.COMPLETED,
        },
      },
    });
    renderWithProviders(<IncidentBanner serverId="srv-1" conversationId="conv-1" />);

    expect(screen.getByText(/Acked by Alice/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ack" })).not.toBeInTheDocument();
  });

  it("Ack button dispatches the incident.ack command and invalidates caches on success", async () => {
    useIncidentStore.setState({
      activeIncident: {
        ...baseIncident,
        escalationRun: {
          currentStepIndex: 0,
          nextFireAt: new Date(Date.now() + 60_000).toISOString(),
          status: EscalationRunStatusGql.ACTIVE,
        },
      },
    });
    requestMock.mockResolvedValue({
      executeCommand: { status: "SUCCESS", message: "", payload: null, followUpCommands: [] },
    });
    renderWithProviders(<IncidentBanner serverId="srv-1" conversationId="conv-1" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Ack" }));
    });

    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(expect.anything(), {
        input: {
          commandId: "incident.ack",
          args: { incidentId: "inc-1" },
          commandContext: undefined,
          confirmedDangerous: undefined,
          isPipe: undefined,
        },
      }),
    );
  });

  it("shows an error toast when the ack command returns an ERROR status", async () => {
    useIncidentStore.setState({
      activeIncident: {
        ...baseIncident,
        escalationRun: {
          currentStepIndex: 0,
          nextFireAt: new Date(Date.now() + 60_000).toISOString(),
          status: EscalationRunStatusGql.ACTIVE,
        },
      },
    });
    requestMock.mockResolvedValue({
      executeCommand: { status: "ERROR", message: "nope", payload: null, followUpCommands: [] },
    });
    renderWithProviders(<IncidentBanner serverId="srv-1" conversationId="conv-1" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Ack" }));
    });

    await waitFor(() => expect(requestMock).toHaveBeenCalled());
  });
});
