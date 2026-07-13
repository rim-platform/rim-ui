import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";

import { renderWithProviders } from "../../../test/utils";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import {
  IncidentSeverityGql,
  IncidentStatusGql,
} from "../../../core/graphql/generated/schema-types";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

import { IncidentHistoryPage } from "./IncidentHistoryPage";

const baseIncident = {
  serverId: "ws-1",
  conversationId: "conv-A",
  startedBy: "user-1",
  originalTopic: null,
  postmortemDraft: null,
  mitigatedAt: null,
  resolvedAt: null,
  createdAt: "2026-04-22T10:00:00Z",
  updatedAt: "2026-04-22T10:00:00Z",
};

function makePage(
  items: Array<{
    id: string;
    title: string;
    status: IncidentStatusGql;
    severity: IncidentSeverityGql | null;
    conversationId?: string;
    startedAt?: string;
    resolvedAt?: string | null;
  }>,
  opts: {
    hasPrev?: boolean;
    hasNext?: boolean;
    next?: { createdAt: string; incidentId: string } | null;
    prev?: { createdAt: string; incidentId: string } | null;
  } = {},
) {
  return {
    listIncidents: {
      items: items.map((i) => ({
        ...baseIncident,
        ...i,
        conversationId: i.conversationId ?? baseIncident.conversationId,
        startedAt: i.startedAt ?? "2026-04-22T09:30:00Z",
      })),
      next: opts.next ?? null,
      prev: opts.prev ?? null,
      pageInfo: {
        hasNext: opts.hasNext ?? false,
        hasPrev: opts.hasPrev ?? false,
      },
    },
  };
}

describe("IncidentHistoryPage", () => {
  beforeEach(() => {
    requestMock.mockReset();
    useShellStore.getState().reset();
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
  });

  it("renders skeleton rows while loading", () => {
    requestMock.mockImplementation(() => new Promise(() => {}));
    renderWithProviders(<IncidentHistoryPage />);
    expect(screen.getByLabelText("Loading incidents")).toBeInTheDocument();
  });

  it("renders incident rows with title, severity, status", async () => {
    requestMock.mockResolvedValueOnce(
      makePage([
        {
          id: "inc-1",
          title: "DB outage",
          status: IncidentStatusGql.RESOLVED,
          severity: IncidentSeverityGql.SEV_1,
        },
        {
          id: "inc-2",
          title: "Slow API",
          status: IncidentStatusGql.ACTIVE,
          severity: IncidentSeverityGql.SEV_3,
        },
      ]),
    );

    renderWithProviders(<IncidentHistoryPage />);

    await waitFor(() => {
      expect(screen.getByText("DB outage")).toBeInTheDocument();
    });
    expect(screen.getByText("Slow API")).toBeInTheDocument();
    // Query within the row to disambiguate badges from the filter chips
    // (chip buttons share the "SEV1" / "Active" text content).
    const inc1Row = screen.getByTestId("incident-row-inc-1");
    expect(inc1Row).toHaveTextContent("SEV1");
    expect(inc1Row).toHaveTextContent("Resolved");
    const inc2Row = screen.getByTestId("incident-row-inc-2");
    expect(inc2Row).toHaveTextContent("SEV3");
    expect(inc2Row).toHaveTextContent("Active");
  });

  it("renders empty state when no items", async () => {
    requestMock.mockResolvedValueOnce(makePage([]));
    renderWithProviders(<IncidentHistoryPage />);

    await waitFor(() => {
      expect(screen.getByText("No incidents yet.")).toBeInTheDocument();
    });
  });

  it("renders filter-aware empty state when filters are active", async () => {
    requestMock.mockResolvedValueOnce(makePage([]));
    renderWithProviders(<IncidentHistoryPage />);

    await waitFor(() => {
      expect(screen.getByText("No incidents yet.")).toBeInTheDocument();
    });

    requestMock.mockResolvedValueOnce(makePage([]));
    fireEvent.click(screen.getByRole("button", { name: "Active", pressed: false }));

    await waitFor(() => {
      expect(screen.getByText("No incidents match these filters.")).toBeInTheDocument();
    });
  });

  it("renders error state with retry", async () => {
    requestMock.mockRejectedValueOnce(new Error("boom"));
    renderWithProviders(<IncidentHistoryPage />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    });
  });

  it("toggles status filter chip and re-queries with the selected enum", async () => {
    requestMock.mockResolvedValue(makePage([]));
    renderWithProviders(<IncidentHistoryPage />);

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    expect(requestMock.mock.calls[0][1]).toMatchObject({
      serverId: "ws-1",
      statusFilter: null,
      severityFilter: null,
      dir: "AFTER",
    });

    fireEvent.click(screen.getByRole("button", { name: "Mitigated", pressed: false }));

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    expect(requestMock.mock.calls[1][1]).toMatchObject({
      statusFilter: [IncidentStatusGql.MITIGATED],
      severityFilter: null,
    });
  });

  it("toggles severity filter chip and re-queries with the selected enum", async () => {
    requestMock.mockResolvedValue(makePage([]));
    renderWithProviders(<IncidentHistoryPage />);

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "SEV1", pressed: false }));

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    expect(requestMock.mock.calls[1][1]).toMatchObject({
      severityFilter: [IncidentSeverityGql.SEV_1],
    });
  });

  it("clear filters resets both filter arrays", async () => {
    requestMock.mockResolvedValue(makePage([]));
    renderWithProviders(<IncidentHistoryPage />);

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Active", pressed: false }));
    fireEvent.click(screen.getByRole("button", { name: "SEV2", pressed: false }));

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(3));

    // Both the toolbar and the empty-state can render a "Clear filters"
    // button when filters are active and result set is empty. Either is fine
    // — click the first (toolbar).
    const clearButtons = screen.getAllByRole("button", { name: "Clear filters" });
    fireEvent.click(clearButtons[0]);

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(4));
    expect(requestMock.mock.calls[3][1]).toMatchObject({
      statusFilter: null,
      severityFilter: null,
    });
  });

  it("Older button advances cursor with dir=AFTER", async () => {
    requestMock.mockResolvedValueOnce(
      makePage(
        [
          {
            id: "inc-1",
            title: "A",
            status: IncidentStatusGql.RESOLVED,
            severity: IncidentSeverityGql.SEV_2,
          },
        ],
        {
          hasNext: true,
          next: { createdAt: "2026-04-22T08:00:00Z", incidentId: "inc-1" },
        },
      ),
    );
    renderWithProviders(<IncidentHistoryPage />);

    await waitFor(() => expect(screen.getByText("A")).toBeInTheDocument());

    requestMock.mockResolvedValueOnce(
      makePage([
        {
          id: "inc-2",
          title: "B",
          status: IncidentStatusGql.RESOLVED,
          severity: IncidentSeverityGql.SEV_4,
        },
      ]),
    );

    fireEvent.click(screen.getByRole("button", { name: /Older/ }));

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    expect(requestMock.mock.calls[1][1]).toMatchObject({
      dir: "AFTER",
      cursor: { createdAt: "2026-04-22T08:00:00Z", incidentId: "inc-1" },
    });
  });

  it("Newer button uses prev cursor with dir=BEFORE", async () => {
    requestMock.mockResolvedValueOnce(
      makePage(
        [
          {
            id: "inc-1",
            title: "A",
            status: IncidentStatusGql.RESOLVED,
            severity: IncidentSeverityGql.SEV_2,
          },
        ],
        {
          hasPrev: true,
          prev: { createdAt: "2026-04-22T11:00:00Z", incidentId: "inc-0" },
        },
      ),
    );
    renderWithProviders(<IncidentHistoryPage />);

    await waitFor(() => expect(screen.getByText("A")).toBeInTheDocument());

    requestMock.mockResolvedValueOnce(makePage([]));
    fireEvent.click(screen.getByRole("button", { name: /Newer/ }));

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    expect(requestMock.mock.calls[1][1]).toMatchObject({
      dir: "BEFORE",
      cursor: { createdAt: "2026-04-22T11:00:00Z", incidentId: "inc-0" },
    });
  });

  it("clicking a row navigates to the incident's conversation", async () => {
    requestMock.mockResolvedValueOnce(
      makePage([
        {
          id: "inc-7",
          title: "Click me",
          status: IncidentStatusGql.MITIGATED,
          severity: IncidentSeverityGql.SEV_2,
          conversationId: "conv-XYZ",
        },
      ]),
    );
    renderWithProviders(<IncidentHistoryPage />);

    await waitFor(() => expect(screen.getByText("Click me")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("incident-row-inc-7"));

    expect(useShellStore.getState().selectedConversationId).toBe("conv-XYZ");
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "conversation" });
  });

  it("close button returns to conversation surface", async () => {
    requestMock.mockResolvedValueOnce(makePage([]));
    useShellStore.getState().setMainSurface({ kind: "incidents" });
    renderWithProviders(<IncidentHistoryPage />);

    await waitFor(() => expect(screen.getByText("No incidents yet.")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Close incident history" }));
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "conversation" });
  });

  it("renders nothing-loaded state until a workspace is selected", () => {
    useWorkspaceStore.setState({ workspaceId: null });
    renderWithProviders(<IncidentHistoryPage />);
    // Query is disabled — no GraphQL request issued, empty state shows.
    expect(requestMock).not.toHaveBeenCalled();
    expect(screen.getByText("No incidents yet.")).toBeInTheDocument();
  });
});
