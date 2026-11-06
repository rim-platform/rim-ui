import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  info: vi.fn(),
}));
vi.mock("../../workspaces/api/useMyServers", () => ({
  useMyServers: () => ({
    data: [
      { id: "w1", name: "Acme" },
      { id: "w2", name: "Beta" },
    ],
  }),
}));
vi.mock("../../plugins/api/usePluginList", () => ({
  useInstalledPlugins: () => ({
    data: [{ plugin_id: "dev.example.pods", display_name: "Pods" }],
  }),
}));
vi.mock("../../audit/api/useListAuditLog", () => ({ useListAuditLog: mocks.audit }));
vi.mock("../../updater/hooks/useServerInfo", () => ({ useServerInfo: () => mocks.info() }));
vi.mock("./AgentGrantsDialog", () => ({
  AgentGrantsDialog: ({ agent }: { agent: { name: string } }) => <div>Grants of {agent.name}</div>,
}));

import { queryKeys } from "../../../core/query/keys";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { groupRuns } from "../runtime/runs";
import type { RecordEntry } from "../state/useAgentRecordStore";
import { useConnectedAgentsStore, type ConnectedAgent } from "../state/useConnectedAgentsStore";
import { AgentRunDialog } from "./AgentRunDialog";

const AGENT: ConnectedAgent = {
  id: "a1",
  name: "Claude Code",
  tokenHash: "hash",
  pairedAt: "2026-11-06T10:00:00.000Z",
  grants: { w1: { all: true, channelIds: [] }, w2: { all: false, channelIds: ["c1", "c2"] } },
  pluginApprovals: {},
};

const T0 = Date.parse("2026-11-06T10:00:00.000Z");

function entry(minute: number, fields: Partial<RecordEntry> = {}): RecordEntry {
  return {
    at: new Date(T0 + minute * 60_000).toISOString(),
    agentId: "a1",
    agentName: "Claude Code",
    tool: "rim_read_messages",
    workspaceId: "w1",
    channelId: "c1",
    query: false,
    messageIds: ["m1", "m2"],
    refused: false,
    runId: "r_1",
    ...fields,
  };
}

const SEND = { tool: "rim_send_message", messageIds: [] as string[] };

function show(entries: RecordEntry[], onBack = vi.fn()) {
  const client = new QueryClient();
  client.setQueryData(queryKeys.conversation("w1", "c1"), { id: "c1", title: "releases" });
  render(
    <QueryClientProvider client={client}>
      <AgentRunDialog run={groupRuns(entries)[0]} onBack={onBack} onClose={() => undefined} />
    </QueryClientProvider>,
  );
  return onBack;
}

describe("AgentRunDialog", () => {
  beforeEach(() => {
    useConnectedAgentsStore.setState({ agents: [AGENT] });
    useAuthStore.setState({ session: { userId: "me" } as never });
    mocks.info.mockReturnValue({ info: { capabilities: ["command_run_id"] } });
    mocks.audit.mockReturnValue({ data: { items: [] }, isPending: false, isError: false });
  });
  afterEach(() => {
    useConnectedAgentsStore.setState({ agents: [] });
    useAuthStore.setState({ session: null });
    vi.clearAllMocks();
  });

  it("folds consecutive reads of a channel and says who acts", () => {
    show([entry(0), entry(1), entry(2, { query: true, messageIds: ["m3"] })]);
    expect(screen.getByText(/^Run at /)).toBeInTheDocument();
    expect(
      screen.getByText("Claude Code, acting as you · visible only on this device"),
    ).toBeInTheDocument();
    expect(screen.getByText("2 reads in #releases (4 messages)")).toBeInTheDocument();
    expect(screen.getByText("Searched #releases")).toBeInTheDocument();
    expect(screen.queryByText(/m1/)).not.toBeInTheDocument();
  });

  it("joins an ask with how it ended", () => {
    show([entry(0), entry(1, { ...SEND, change: "asked" }), entry(2, { ...SEND, change: "sent" })]);
    expect(screen.getByText("Asked to send to #releases → Sent")).toBeInTheDocument();
    expect(screen.queryByText(/No answer recorded/)).not.toBeInTheDocument();
  });

  it("says when an ask has no recorded answer", () => {
    show([entry(0, { ...SEND, change: "asked" })]);
    expect(screen.getByText("Asked to send to #releases → No answer recorded")).toBeInTheDocument();
  });

  it("names plugin commands and what became of them", () => {
    const plugin = { pluginId: "dev.example.pods", commandId: "restart" };
    show([
      entry(0, { ...SEND, change: "asked", plugin }),
      entry(1, { ...SEND, change: "done", plugin }),
      entry(2, { ...SEND, change: "proposed", plugin: { ...plugin, commandId: "delete" } }),
    ]);
    expect(screen.getByText("Asked to run Pods restart → Ran")).toBeInTheDocument();
    expect(screen.getByText("Suggested Pods delete")).toBeInTheDocument();
  });

  it("folds refused calls", () => {
    show([entry(0, { refused: true }), entry(1, { refused: true })]);
    expect(screen.getByText("2 refused requests")).toBeInTheDocument();
  });

  it("says once that what the agent did in between is outside RIM", () => {
    show([entry(0), entry(1, { channelId: "c2" }), entry(2, { query: true })]);
    expect(screen.getAllByText(/is outside RIM\./)).toHaveLength(1);
  });

  it("says nothing of the sort for a single step", () => {
    show([entry(0)]);
    expect(screen.queryByText(/is outside RIM\./)).not.toBeInTheDocument();
  });

  it("says reads did not reach the host, and asks it nothing", () => {
    show([entry(0)]);
    expect(
      screen.getByText("Nothing here reached the host: reads come from this device."),
    ).toBeInTheDocument();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("asks the host for the person's own lines of this run, with the note", () => {
    mocks.audit.mockReturnValue({
      data: {
        items: [
          {
            id: "1",
            createdAt: new Date(T0).toISOString(),
            commandId: "chat.post_message",
            outcome: "SUCCESS",
          },
        ],
      },
      isPending: false,
      isError: false,
    });
    show([entry(0, { ...SEND, change: "sent" })]);
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ scope: { serverId: "w1", actorUserId: "me" }, runId: "r_1" }),
    );
    expect(screen.getByText(/chat\.post_message · SUCCESS/)).toBeInTheDocument();
    expect(screen.getByText(/Arguments are redacted\./)).toHaveTextContent(
      "Those who can read this workspace's log can see these lines.",
    );
  });

  it("says a host without runs keeps none, and doesn't ask it", () => {
    mocks.info.mockReturnValue({ info: { capabilities: [] } });
    show([entry(0, { ...SEND, change: "sent" })]);
    expect(screen.getByText("This host doesn't keep runs yet.")).toBeInTheDocument();
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ scope: null }));
  });

  it("shows a spinner while the host answers", () => {
    mocks.audit.mockReturnValue({ data: undefined, isPending: true, isError: false });
    show([entry(0, { ...SEND, change: "sent" })]);
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  });

  it("says when the host could not be asked", () => {
    mocks.audit.mockReturnValue({ data: undefined, isPending: false, isError: true });
    show([entry(0, { ...SEND, change: "sent" })]);
    expect(screen.getByText("RIM couldn't get these from the host.")).toBeInTheDocument();
  });

  it("shows no host section for entries kept before runs existed", () => {
    show([entry(0, { ...SEND, change: "sent", runId: undefined })]);
    expect(screen.queryByText("Recorded by the workspace host")).not.toBeInTheDocument();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("says where the content goes", () => {
    show([entry(0)]);
    expect(screen.getByText("Your desktop app (in RIM)")).toBeInTheDocument();
    expect(screen.getByText("Claude Code (outside RIM)")).toBeInTheDocument();
    expect(screen.getByText("Its model provider (outside RIM)")).toBeInTheDocument();
    expect(
      screen.getByText("No prompt or model traffic passes through a RIM server for this agent."),
    ).toBeInTheDocument();
  });

  it("shows the grants now and opens the grants dialog", async () => {
    const user = userEvent.setup();
    show([entry(0)]);
    expect(screen.getByText("Acme: every channel you can see")).toBeInTheDocument();
    expect(screen.getByText("Beta: 2 channels")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Choose what it can read" }));
    expect(screen.getByText("Grants of Claude Code")).toBeInTheDocument();
  });

  it("says a disconnected agent is disconnected", () => {
    useConnectedAgentsStore.setState({ agents: [] });
    show([entry(0)]);
    expect(screen.getByText("Disconnected.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Choose what it can read" })).toBeNull();
  });

  it("goes back", async () => {
    const user = userEvent.setup();
    const onBack = show([entry(0)]);
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("shows invisible characters in what the agent named", () => {
    show([entry(0, { ...SEND, change: "done", plugin: { pluginId: "x", commandId: "a‮b" } })]);
    expect(screen.queryByText(/‮/)).not.toBeInTheDocument();
  });
});
