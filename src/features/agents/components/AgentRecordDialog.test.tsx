import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ servers: [{ id: "w1", name: "Acme" }] }));
vi.mock("../../workspaces/api/useMyServers", () => ({
  useMyServers: () => ({ data: mocks.servers }),
}));

import { queryKeys } from "../../../core/query/keys";
import { CLEARED_TOOL, useAgentRecordStore, type RecordEntry } from "../state/useAgentRecordStore";
import type { ConnectedAgent } from "../state/useConnectedAgentsStore";
import { AgentRecordDialog } from "./AgentRecordDialog";

const AGENT: ConnectedAgent = {
  id: "agent-1",
  name: "Claude Code",
  tokenHash: "hash",
  pairedAt: "2026-11-06T10:00:00.000Z",
  grants: {},
};

const AT = "2026-11-06T10:00:00.000Z";
const TIME = new Date(AT).toLocaleString();

function entry(fields: Partial<RecordEntry> = {}): RecordEntry {
  return {
    at: AT,
    agentId: "agent-1",
    agentName: "Claude Code",
    tool: "rim_read_messages",
    workspaceId: "w1",
    channelId: "c1",
    query: false,
    messageIds: ["m1", "m2"],
    refused: false,
    ...fields,
  };
}

function show() {
  const client = new QueryClient();
  client.setQueryData(queryKeys.conversation("w1", "c1"), { id: "c1", title: "general" });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <AgentRecordDialog agent={AGENT} onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
}

function lines() {
  return screen.queryAllByRole("listitem").map((item) => item.textContent);
}

describe("AgentRecordDialog", () => {
  it("shows every agent's entries by name, with no agent given", () => {
    useAgentRecordStore.setState({
      entries: [
        entry({ messageIds: ["a"] }),
        entry({ agentId: "gone", agentName: "Old Tool", messageIds: ["b"] }),
      ],
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AgentRecordDialog agent={null} onClose={() => undefined} />
      </QueryClientProvider>,
    );
    expect(
      screen.getByText("What agents were given and what they asked to do"),
    ).toBeInTheDocument();
    expect(screen.getByText(/^Old Tool · /)).toBeInTheDocument();
  });

  beforeEach(() => {
    useAgentRecordStore.setState({ entries: [] });
  });

  it("says what the record is", () => {
    show();
    expect(
      screen.getByRole("dialog", { name: "What Claude Code was given and what it asked to do" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "What RIM handed to this agent and what it asked to do. RIM can't see what it did with it.",
      ),
    ).toBeInTheDocument();
  });

  it("says when there is nothing, and offers nothing to clear", () => {
    show();
    expect(screen.getByText("Nothing yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear the whole record" })).toBeNull();
  });

  it("lists this agent's entries, newest first, by channel name or id", () => {
    useAgentRecordStore.setState({
      entries: [
        entry({ messageIds: ["m1"] }),
        entry({ channelId: "unseen", messageIds: [] }),
        entry({ tool: "rim_search_messages", query: true, messageIds: ["m1", "m2", "m3"] }),
      ],
    });
    show();
    expect(lines()).toEqual([
      `${TIME} · Searched · general · 3 messages`,
      `${TIME} · Read · unseen · 0 messages`,
      `${TIME} · Read · general · 1 message`,
    ]);
  });

  it.each([
    ["asked", "Asked to send"],
    ["sent", "Sent"],
    ["discarded", "You discarded it"],
    ["expired", "Expired"],
    ["busy", "You were busy"],
    ["refused", "Refused"],
  ] as const)("words a change that %s", (change, words) => {
    useAgentRecordStore.setState({
      entries: [entry({ tool: "rim_send_message", change, messageIds: [] })],
    });
    show();
    expect(lines()).toEqual([`${TIME} · ${words} · #general`]);
  });

  it("words a refused request that named no channel", () => {
    useAgentRecordStore.setState({
      entries: [
        entry({
          tool: "rim_send_message",
          channelId: null,
          change: "refused",
          refused: true,
          messageIds: [],
        }),
      ],
    });
    show();
    expect(lines()).toEqual([`${TIME} · Refused · an unknown channel`]);
  });

  it("shows the refused line", () => {
    useAgentRecordStore.setState({ entries: [entry({ refused: true, messageIds: [] })] });
    show();
    expect(lines()).toEqual([`${TIME} · Read · general · refused`]);
  });

  it("names the workspace for a search across it, and the lists for what they are", () => {
    useAgentRecordStore.setState({
      entries: [
        entry({ tool: "rim_list_workspaces", workspaceId: "", channelId: null, messageIds: [] }),
        entry({ tool: "rim_list_channels", channelId: null, messageIds: [] }),
        entry({ tool: "rim_search_messages", channelId: null, query: true, messageIds: ["m1"] }),
        entry({ channelId: null, workspaceId: "", refused: true, messageIds: [] }),
      ],
    });
    show();
    expect(lines()).toEqual([
      `${TIME} · Read · an unknown channel · refused`,
      `${TIME} · Searched · Acme · 1 message`,
      `${TIME} · Read · channel names in Acme`,
      `${TIME} · Read · workspace names`,
    ]);
  });

  it("does not list another agent's entries", () => {
    useAgentRecordStore.setState({ entries: [entry({ agentId: "agent-2" })] });
    show();
    expect(lines()).toEqual([]);
    expect(screen.getByText("Nothing yet.")).toBeInTheDocument();
  });

  it("shows at most the newest 200", () => {
    useAgentRecordStore.setState({
      entries: Array.from({ length: 205 }, () => entry()),
    });
    show();
    expect(lines()).toHaveLength(200);
  });

  it("holds no message text or ids in what it shows", () => {
    useAgentRecordStore.setState({ entries: [entry({ messageIds: ["m-secret"] })] });
    show();
    expect(document.body.textContent).not.toContain("m-secret");
  });

  it("clears the whole record after asking, and leaves one line", async () => {
    const user = userEvent.setup();
    useAgentRecordStore.setState({
      entries: [entry(), entry({ agentId: "agent-2" })],
    });
    show();
    await user.click(screen.getByRole("button", { name: "Clear the whole record" }));
    expect(
      screen.getByText(
        "This clears the record for every agent. It leaves one line saying you did.",
      ),
    ).toBeInTheDocument();
    expect(useAgentRecordStore.getState().entries).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Clear" }));
    const { entries } = useAgentRecordStore.getState();
    expect(entries).toHaveLength(1);
    expect(entries[0].tool).toBe(CLEARED_TOOL);
    expect(lines()).toEqual([expect.stringContaining("You cleared the record")]);
  });

  it("clears nothing when the question is cancelled", async () => {
    const user = userEvent.setup();
    useAgentRecordStore.setState({ entries: [entry()] });
    show();
    await user.click(screen.getByRole("button", { name: "Clear the whole record" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useAgentRecordStore.getState().entries).toHaveLength(1);
    expect(lines()).toHaveLength(1);
  });

  it("offers to clear even when only another agent has entries", () => {
    useAgentRecordStore.setState({ entries: [entry({ agentId: "agent-2" })] });
    show();
    expect(screen.getByRole("button", { name: "Clear the whole record" })).toBeInTheDocument();
  });
});
