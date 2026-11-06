import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { queryKeys } from "../../../core/query/keys";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useUnreadStore } from "../state/useUnreadStore";

vi.mock("../api/useChannels", () => ({
  useJoinedChannels: () => ({ data: { items: [] } }),
}));
vi.mock("../api/useInboxConversations", () => ({
  useInboxConversations: () => ({ data: { items: [] } }),
}));
vi.mock("../../relay/api/useDirectInbox", () => ({
  useDirectInbox: () => ({ items: [] }),
}));

import { ConversationSelectionRuntime } from "./ConversationSelectionRuntime";

const NEWEST = "2026-11-06T10:00:00Z";
const MARKER = "2026-11-06T09:00:00Z";

function renderRuntime() {
  const client = new QueryClient();
  client.setQueryData(queryKeys.messages("ws-1", "conv-1"), {
    pages: [{ items: [{ sentAt: NEWEST }] }],
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  render(<ConversationSelectionRuntime />, { wrapper });
}

function leave() {
  act(() => useShellStore.getState().setSelectedConversationId("conv-2"));
}

beforeEach(() => {
  useWorkspaceStore.setState({ workspaceId: "ws-1" });
  useShellStore.setState({ selectedConversationId: "conv-1", draftDirect: null });
  useUnreadStore.setState({
    counts: {},
    spaceOf: {},
    markers: {},
    countSources: {},
    watermarks: {},
  });
});

describe("leaving a conversation", () => {
  it("keeps the count of an unread conversation on a host with read markers", () => {
    useUnreadStore.getState().setCounts("ws-1", { "conv-1": 3 }, { "conv-1": MARKER });
    useUnreadStore.setState({ watermarks: { "conv-1": MARKER } });
    renderRuntime();
    leave();
    const state = useUnreadStore.getState();
    expect(state.counts).toEqual({ "conv-1": 3 });
    expect(state.markers).toEqual({ "conv-1": MARKER });
    expect(state.watermarks).toEqual({});
  });

  it("sets the watermark of a read conversation on a host with read markers", () => {
    useUnreadStore.getState().setCounts("ws-1", {}, {});
    renderRuntime();
    leave();
    expect(useUnreadStore.getState().watermarks).toEqual({ "conv-1": NEWEST });
  });

  it("on an older host clears the count and sets the watermark, as it always did", () => {
    useUnreadStore.getState().setCounts("ws-1", { "conv-1": 3 });
    renderRuntime();
    leave();
    const state = useUnreadStore.getState();
    expect(state.counts).toEqual({});
    expect(state.watermarks).toEqual({ "conv-1": NEWEST });
  });
});
