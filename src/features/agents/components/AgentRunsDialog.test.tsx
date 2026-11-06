import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../workspaces/api/useMyServers", () => ({
  useMyServers: () => ({ data: [{ id: "w1", name: "Acme" }] }),
}));
vi.mock("../../plugins/api/usePluginList", () => ({ useInstalledPlugins: () => ({ data: [] }) }));
vi.mock("../../audit/api/useListAuditLog", () => ({
  useListAuditLog: () => ({ data: { items: [] }, isPending: false, isError: false }),
}));

import { useAgentRecordStore, type RecordEntry } from "../state/useAgentRecordStore";
import { useConnectedAgentsStore, type ConnectedAgent } from "../state/useConnectedAgentsStore";
import { AgentRunsDialog } from "./AgentRunsDialog";

const NOW = Date.parse("2026-11-06T12:00:00.000Z");
const AGENT: ConnectedAgent = {
  id: "a1",
  name: "Claude Code",
  tokenHash: "hash",
  pairedAt: "2026-11-06T10:00:00.000Z",
  grants: {},
  pluginApprovals: {},
};

function entry(minutesAgo: number, fields: Partial<RecordEntry> = {}): RecordEntry {
  return {
    at: new Date(NOW - minutesAgo * 60_000).toISOString(),
    agentId: "a1",
    agentName: "Claude Code",
    tool: "rim_read_messages",
    workspaceId: "w1",
    channelId: "c1",
    query: false,
    messageIds: ["m1"],
    refused: false,
    runId: "r_1",
    ...fields,
  };
}

function show(agent: ConnectedAgent | null) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AgentRunsDialog agent={agent} onClose={() => undefined} />
    </QueryClientProvider>,
  );
}

describe("AgentRunsDialog", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["Date"] });
    vi.setSystemTime(NOW);
    useConnectedAgentsStore.setState({ agents: [AGENT] });
  });
  afterEach(() => {
    vi.useRealTimers();
    useAgentRecordStore.setState({ entries: [] });
    useConnectedAgentsStore.setState({ agents: [] });
  });

  it("says there are no runs", () => {
    useAgentRecordStore.setState({ entries: [] });
    show(AGENT);
    expect(screen.getByText("Runs of Claude Code")).toBeInTheDocument();
    expect(screen.getByText("No runs yet.")).toBeInTheDocument();
  });

  it("says a run is a grouping by time, and lists runs with counts in words", () => {
    useAgentRecordStore.setState({
      entries: [
        entry(300),
        entry(299, { tool: "rim_send_message", change: "asked", messageIds: [] }),
        entry(298, { tool: "rim_send_message", change: "sent", messageIds: ["m9"] }),
        entry(297, { change: "discarded", messageIds: [] }),
        entry(296, { refused: true, messageIds: [] }),
      ],
    });
    show(AGENT);
    expect(
      screen.getByText(/grouped by time\. RIM doesn't see where an agent's task starts or ends\./),
    ).toBeInTheDocument();
    expect(screen.getByText("1 read, 1 message sent, 1 discarded, 1 refused")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Acme/ })).toBeInTheDocument();
    expect(screen.queryByText("Still going")).not.toBeInTheDocument();
  });

  it("marks a run that ended in the last fifteen minutes as still going", () => {
    useAgentRecordStore.setState({ entries: [entry(5)] });
    show(AGENT);
    expect(screen.getByText(/Still going/)).toBeInTheDocument();
  });

  it("shows every agent's runs by name with no agent given, newest first", () => {
    useAgentRecordStore.setState({
      entries: [
        entry(300, { runId: "r_old" }),
        entry(100, { agentId: "a2", agentName: "Other Tool", runId: "r_new" }),
      ],
    });
    show(null);
    expect(screen.getByText("All runs")).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Other Tool");
    expect(rows[1]).toHaveTextContent("Claude Code");
  });

  it("shows only the given agent's runs", () => {
    useAgentRecordStore.setState({
      entries: [entry(100), entry(90, { agentId: "a2", agentName: "Other Tool", runId: "r_2" })],
    });
    show(AGENT);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.queryByText(/Other Tool/)).not.toBeInTheDocument();
  });

  it("opens a run from the keyboard and goes back", async () => {
    const user = userEvent.setup();
    useAgentRecordStore.setState({ entries: [entry(100)] });
    show(AGENT);
    let reached = false;
    for (let i = 0; i < 5 && !reached; i++) {
      await user.tab();
      reached = document.activeElement === screen.getByRole("button", { name: /Acme/ });
    }
    expect(reached).toBe(true);
    await user.keyboard("{Enter}");
    expect(screen.getByText(/^Run at /)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Back" })).toHaveFocus());
    await user.keyboard("{Enter}");
    expect(screen.getByText("Runs of Claude Code")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Acme/ })).toHaveFocus();
  });
});
