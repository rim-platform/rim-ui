import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

import { createTestQueryClient } from "../../test/utils";
import { queryKeys } from "../../core/query/keys";
import {
  IncidentPhaseNameGql,
  IncidentSeverityGql,
  IncidentStatusGql,
  ServerMemberRoleGql,
  WorkspaceFeature,
} from "../../core/graphql/generated/schema-types";
import { useWorkspaceStore } from "../../features/workspaces/state/useWorkspaceStore";
import { useIncidentStore } from "../../features/incidents/state/useIncidentStore";
import { useShellStore } from "../state/useShellStore";

const requestMock = vi.fn();

vi.mock("../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

// Child surfaces with their own data needs — stubbed so only the header's gate is exercised.
vi.mock("../../features/incidents/components/IncidentBanner", () => ({
  IncidentBanner: () => <div data-testid="incident-banner" />,
}));
vi.mock("../../features/lenses/components/LensPicker", () => ({ LensPicker: () => null }));
vi.mock("../../features/settings/components/InviteDialog", () => ({ InviteDialog: () => null }));
vi.mock("../../features/commands/hooks/useKeybindLabel", () => ({
  useKeybindLabel: () => null,
}));

import { ConversationHeader } from "./ConversationHeader";
import { makeConversation } from "../../features/conversations/__fixtures__/conversations";
import type { ConversationSummary } from "../../features/conversations/types";
import { useMembersPanelStore } from "../../features/conversations/state/useMembersPanelStore";

const openIncident = {
  id: "inc-1",
  serverId: "srv-1",
  conversationId: "conv-1",
  title: "API down",
  status: IncidentStatusGql.ACTIVE,
  severity: IncidentSeverityGql.SEV_2,
  startedAt: "2026-10-04T00:00:00Z",
  acknowledgedAt: null,
  acknowledgedByUser: null,
  escalationRun: null,
};

/** Routes the header's requests: feature flags and the active incident; others never resolve. */
function serve({ incidentsEnabled, incident }: { incidentsEnabled: boolean; incident: unknown }) {
  requestMock.mockImplementation((document: string) => {
    if (document.includes("workspaceFeatures")) {
      return Promise.resolve({
        workspaceFeatures: [
          { feature: WorkspaceFeature.INCIDENTS, enabled: incidentsEnabled, updatedAt: null },
        ],
      });
    }
    if (document.includes("activeIncident(")) {
      return Promise.resolve({ activeIncident: incident });
    }
    return new Promise(() => {});
  });
}

function activeIncidentRequested() {
  return requestMock.mock.calls.some(([document]) => String(document).includes("activeIncident("));
}

function renderHeader() {
  const qc = createTestQueryClient();
  render(
    <QueryClientProvider client={qc}>
      <ConversationHeader />
    </QueryClientProvider>,
  );
  return qc;
}

describe("ConversationHeader — incidents module gate", () => {
  beforeEach(() => {
    requestMock.mockReset();
    useWorkspaceStore.setState({ workspaceId: "srv-1" });
    useShellStore.setState({ selectedConversationId: "conv-1" });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
    useShellStore.getState().reset();
    useIncidentStore.setState({ activeIncident: null });
  });

  it("renders no banner, no start-incident button and skips the query when the feature is off", async () => {
    serve({ incidentsEnabled: false, incident: openIncident });
    const qc = renderHeader();

    await waitFor(() =>
      expect(qc.getQueryData(queryKeys.workspaceFeatures("srv-1"))).toBeDefined(),
    );
    expect(screen.getByRole("button", { name: "Invite member" })).toBeInTheDocument();
    expect(screen.queryByTestId("incident-banner")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start incident" })).not.toBeInTheDocument();
    expect(activeIncidentRequested()).toBe(false);
    expect(useIncidentStore.getState().activeIncident).toBeNull();
  });

  it("ignores a stale incident left in the store when the feature is off", async () => {
    useIncidentStore.setState({
      activeIncident: {
        id: "inc-1",
        title: "API down",
        status: IncidentStatusGql.ACTIVE,
        severity: IncidentSeverityGql.SEV_2,
        currentPhase: IncidentPhaseNameGql.DETECTION,
        startedAt: "2026-10-04T00:00:00Z",
        acknowledgedAt: null,
        acknowledgedByUser: null,
        escalationRun: null,
      },
    });
    serve({ incidentsEnabled: false, incident: null });
    const qc = renderHeader();

    await waitFor(() =>
      expect(qc.getQueryData(queryKeys.workspaceFeatures("srv-1"))).toBeDefined(),
    );
    expect(screen.queryByTestId("incident-banner")).not.toBeInTheDocument();
  });

  it("renders the banner for an open incident when the feature is on", async () => {
    serve({ incidentsEnabled: true, incident: openIncident });
    renderHeader();
    expect(await screen.findByTestId("incident-banner")).toBeInTheDocument();
    expect(activeIncidentRequested()).toBe(true);
  });

  it("offers the start-incident button when the feature is on and nothing is open", async () => {
    serve({ incidentsEnabled: true, incident: null });
    renderHeader();
    expect(await screen.findByRole("button", { name: "Start incident" })).toBeInTheDocument();
    expect(screen.queryByTestId("incident-banner")).not.toBeInTheDocument();
  });
});

describe("ConversationHeader — channel privacy, members and menu", () => {
  function serveConversation(conversation: ConversationSummary) {
    requestMock.mockImplementation((document: string) => {
      if (document.includes("workspaceFeatures")) {
        return Promise.resolve({ workspaceFeatures: [] });
      }
      if (document.includes("query Conversation(")) {
        return Promise.resolve({ conversation });
      }
      return new Promise(() => {});
    });
  }

  beforeEach(() => {
    requestMock.mockReset();
    useWorkspaceStore.setState({ workspaceId: "srv-1" });
    useShellStore.setState({ selectedConversationId: "conv-1" });
    useMembersPanelStore.setState({ open: false });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
    useShellStore.getState().reset();
  });

  it("shows a lock and the member count for a private channel; the count opens the members panel", async () => {
    serveConversation(makeConversation({ title: "secret", isPrivate: true, memberCount: 3 }));
    renderHeader();

    expect(await screen.findByRole("img", { name: "Private channel" })).toBeInTheDocument();
    const count = screen.getByRole("button", { name: "3 members" });
    fireEvent.click(count);
    expect(useMembersPanelStore.getState().open).toBe(true);
    expect(screen.getByRole("button", { name: "Conversation menu" })).toBeInTheDocument();
  });

  it("marks an archived channel", async () => {
    serveConversation(makeConversation({ isArchived: true }));
    renderHeader();
    expect(await screen.findByText("Archived")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Private channel" })).not.toBeInTheDocument();
  });
});

describe("ConversationHeader — guest gate (Track 1.2)", () => {
  beforeEach(() => {
    requestMock.mockReset();
    useWorkspaceStore.setState({ workspaceId: "srv-1" });
    useShellStore.setState({ selectedConversationId: "conv-1" });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
    useShellStore.getState().reset();
  });

  it.each([
    [ServerMemberRoleGql.GUEST, false],
    [ServerMemberRoleGql.MEMBER, true],
  ])("viewer %s: Invite member shown = %s", async (role, shown) => {
    requestMock.mockImplementation((document: string) => {
      if (document.includes("query Server(")) {
        return Promise.resolve({ server: { id: "srv-1", name: "Acme", viewerRole: role } });
      }
      return new Promise(() => {});
    });
    const qc = renderHeader();
    await waitFor(() => expect(qc.getQueryData(queryKeys.server("srv-1"))).toBeDefined());
    if (shown) {
      expect(screen.getByRole("button", { name: "Invite member" })).toBeInTheDocument();
    } else {
      expect(screen.queryByRole("button", { name: "Invite member" })).not.toBeInTheDocument();
    }
  });
});
