import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

import { queryKeys } from "../../../core/query/keys";
import { queryClient } from "../../../core/query/queryClient";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useUnreadStore } from "../state/useUnreadStore";

const requestMock = vi.hoisted(() => vi.fn());
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));
const toastMock = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn() }));
vi.mock("../../../shared/toast", () => ({ toast: toastMock }));

import {
  knownMessageToMarkUnread,
  markAsUnread,
  markConversationUnread,
  spaceMarksUnread,
} from "./useMarkAsUnread";

const INPUT = { workspaceId: "ws-1", conversationId: "conv-1", messageId: "msg-1" };

function message(id: string, authorId: string, extra: Record<string, unknown> = {}) {
  return { id, authorId, ...extra };
}

function pagesOf(...pages: ReturnType<typeof message>[][]) {
  return { pages: pages.map((items) => ({ items })), pageParams: [] };
}

/** The `input` of every `markAsUnread` sent. */
function sentInputs() {
  return requestMock.mock.calls
    .filter(([document]) => String(document).includes("markAsUnread("))
    .map(([, variables]) => variables.input);
}

beforeEach(() => {
  requestMock.mockReset().mockResolvedValue({ markAsUnread: true });
  toastMock.error.mockReset();
  toastMock.info.mockReset();
  useUnreadStore.setState({ held: {}, countSources: {} });
  useShellStore.setState({ selectedConversationId: "conv-1" });
  vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
});

describe("markAsUnread", () => {
  it("holds the open conversation, sends the mark and reads the counts again", async () => {
    await expect(markAsUnread(INPUT)).resolves.toBe(true);
    expect(useUnreadStore.getState().held).toEqual({ "conv-1": true });
    expect(sentInputs()).toEqual([INPUT]);
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.unreadCounts("ws-1"),
    });
  });

  it("does not hold a conversation that is not open", async () => {
    useShellStore.setState({ selectedConversationId: "conv-2" });
    await markAsUnread(INPUT);
    expect(useUnreadStore.getState().held).toEqual({});
  });

  it("assumes nothing about the marker: the counts stay as they were until read again", async () => {
    useUnreadStore.setState({ counts: {}, markers: {} });
    await markAsUnread(INPUT);
    expect(useUnreadStore.getState().counts).toEqual({});
    expect(useUnreadStore.getState().markers).toEqual({});
  });

  it("says so when refused, ends the hold and still reads the counts again", async () => {
    requestMock.mockRejectedValue(new Error("no"));
    await expect(markAsUnread(INPUT)).resolves.toBe(false);
    expect(toastMock.error).toHaveBeenCalledWith("Could not mark this as unread");
    expect(useUnreadStore.getState().held).toEqual({});
    expect(queryClient.invalidateQueries).toHaveBeenCalled();
  });
});

describe("spaceMarksUnread", () => {
  it("is true only for a space whose counts came with markers", () => {
    useUnreadStore.setState({ countSources: { new: "markers", old: "plain" } });
    expect(spaceMarksUnread("new")).toBe(true);
    expect(spaceMarksUnread("old")).toBe(false);
    expect(spaceMarksUnread("unknown")).toBe(false);
  });
});

describe("knownMessageToMarkUnread", () => {
  const known = (qc: QueryClient) => knownMessageToMarkUnread(qc, "ws-1", "conv-1", "me");

  it("is undefined with nothing loaded", () => {
    expect(known(new QueryClient())).toBeUndefined();
  });

  it("is the newest message by someone else, in the newest page first", () => {
    const qc = new QueryClient();
    qc.setQueryData(
      queryKeys.messages("ws-1", "conv-1"),
      pagesOf(
        [message("new-1", "bob"), message("new-2", "alice"), message("new-3", "me")],
        [message("old-1", "bob")],
      ),
    );
    expect(known(qc)).toBe("new-2");
  });

  it("skips a thread reply and a notice", () => {
    const qc = new QueryClient();
    qc.setQueryData(
      queryKeys.messages("ws-1", "conv-1"),
      pagesOf([
        message("root", "bob"),
        message("reply", "bob", { threadId: "t-1" }),
        message("notice", "bob", { membershipNotice: {} }),
      ]),
    );
    expect(known(qc)).toBe("root");
  });

  it("is null when the loaded pages hold nothing by someone else", () => {
    const qc = new QueryClient();
    qc.setQueryData(queryKeys.messages("ws-1", "conv-1"), pagesOf([message("mine", "me")]));
    expect(known(qc)).toBeNull();
  });
});

describe("markConversationUnread", () => {
  const run = (qc: QueryClient) => markConversationUnread(qc, "ws-1", "conv-1", "me");

  it("reads the first page when nothing is loaded", async () => {
    requestMock.mockImplementation(async (document: unknown) =>
      String(document).includes("messages(")
        ? { messages: { items: [message("first", "bob"), message("mine", "me")] } }
        : { markAsUnread: true },
    );
    await run(new QueryClient());
    expect(sentInputs()).toEqual([{ ...INPUT, messageId: "first" }]);
  });

  it("says there is nothing to mark when the first page has no one else's message", async () => {
    requestMock.mockResolvedValue({ messages: { items: [message("mine", "me")] } });
    await run(new QueryClient());
    expect(sentInputs()).toEqual([]);
    expect(toastMock.info).toHaveBeenCalledWith("Nothing here to mark unread");
  });

  it("says so when the first page cannot be read", async () => {
    requestMock.mockRejectedValue(new Error("no"));
    await run(new QueryClient());
    expect(sentInputs()).toEqual([]);
    expect(toastMock.error).toHaveBeenCalledWith("Could not mark this as unread");
  });
});
