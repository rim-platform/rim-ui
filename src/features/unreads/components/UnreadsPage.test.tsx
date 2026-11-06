import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationTypeEnum } from "../../../core/graphql/generated/schema-types";
import { createTestQueryClient } from "../../../test/utils";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { runDesktopLocalCommand } from "../../commands/runtime/commandDispatcher";
import { makeConversation } from "../../conversations/__fixtures__/conversations";
import {
  sendDeferredMark,
  undoLatestDeferredMark,
  useDeferredMarks,
} from "../../conversations/api/deferredMark";
import { useUnreadStore } from "../../conversations/state/useUnreadStore";
import { useBlockedConversations } from "../../relay/state/useBlockedConversations";

const requestMock = vi.hoisted(() => vi.fn());
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));
const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("../../../shared/toast", () => ({ toast: toastMock }));
vi.mock("../../home/api/useHomeWorkspaces", () => ({
  useHomeWorkspaces: () => ({
    workspaces: [
      { id: "ws-1", label: "Rim Dev", local: true },
      { id: "ws-2", label: "Halden", local: true },
    ],
    isPending: false,
  }),
}));
const directSpaces = vi.hoisted(() => ({ ids: [] as string[] }));
vi.mock("../../relay/api/useDirectInbox", () => ({ useDirectSpaceIds: () => directSpaces.ids }));
vi.mock("../../workspaces/hooks/useMemberLookup", () => ({
  useMemberLookup: () => ({
    map: new Map(),
    ownDomain: null,
    resolve: (id: string) => ({ displayName: `person-${id}`, isCurrentUser: false }),
  }),
}));
vi.mock("../../updater/api/serverCapabilities", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  messageReadDocument: async () => "query Messages(",
  spaceHasCapability: async () => host.markers,
}));
const host = vi.hoisted(() => ({ markers: true }));
const rowProps = vi.hoisted(() => ({ seen: [] as unknown[] }));
vi.mock("../../messages/components/MessageItem", () => ({
  MessageItem: (props: {
    view: { message: { id: string; text: string }; isSelected: boolean };
  }) => {
    rowProps.seen.push(props);
    const { message, isSelected } = props.view;
    return (
      <div
        role="option"
        id={`message-${message.id}`}
        data-message-id={message.id}
        aria-selected={isSelected}
      >
        {message.text}
      </div>
    );
  },
}));
const jump = vi.hoisted(() => vi.fn());
vi.mock("../../notifications/runtime/jumpToNotification", () => ({
  jumpToNotification: (...args: unknown[]) => jump(...args),
}));

import { UnreadsPage } from "./UnreadsPage";

const MARKER = "2026-11-06T09:00:00Z";

function message(id: string, minute: number, authorId = "bob") {
  return {
    id,
    text: `text of ${id}`,
    authorId,
    sentAt: new Date(Date.UTC(2026, 10, 6, 10, minute)).toISOString(),
    reactions: [{ emoji: "x", count: 1, reactedByMe: false }],
  };
}

interface Page {
  items: ReturnType<typeof message>[];
  more?: boolean;
}

/** Answers the page's reads: `pages` by conversation id, channels by workspace. */
function serve(
  pages: Record<string, Page | Page[] | (() => Promise<Page>)>,
  channels: Record<string, ReturnType<typeof makeConversation>[]> = {},
  extra: Partial<Record<"muted", string[]>> = {},
) {
  const served = new Map<string, number>();
  requestMock.mockImplementation(async (document: unknown, variables: Record<string, string>) => {
    const text = String(document);
    if (text.includes("unreadCounts(")) {
      const { counts, spaceOf, markers } = useUnreadStore.getState();
      return {
        unreadCounts: Object.entries(counts)
          .filter(([id]) => spaceOf[id] === variables.workspaceId)
          .map(([conversationId, count]) => ({
            conversationId,
            count,
            unreadAfter: markers[conversationId] ?? MARKER,
          })),
      };
    }
    if (text.includes("mutedConversations")) {
      return {
        mutedConversations: (extra.muted ?? []).map((conversationId) => ({
          conversationId,
          mutedUntil: null,
        })),
      };
    }
    if (text.includes("query Channels")) {
      return {
        channels: {
          items: channels[variables.serverId] ?? [],
          pageInfo: { hasNext: false, hasPrev: false },
        },
      };
    }
    if (text.includes("inboxConversations")) {
      return { inboxConversations: { items: [], pageInfo: { hasNext: false, hasPrev: false } } };
    }
    if (text.includes("query Messages(")) {
      const entry = pages[variables.conversationId];
      const at = served.get(variables.conversationId) ?? 0;
      served.set(variables.conversationId, at + 1);
      const page =
        typeof entry === "function" ? await entry() : Array.isArray(entry) ? entry[at] : entry;
      return {
        messages: {
          items: page?.items ?? [],
          next: page?.more ? { sentAt: "later", messageId: "m" } : null,
          prev: null,
          pageInfo: { hasNext: Boolean(page?.more), hasPrev: false },
        },
      };
    }
    if (text.includes("markAsRead(")) return { markAsRead: true };
    if (text.includes("query Conversation")) throw new Error("not known");
    return {};
  });
}

/** The groups the page has seen on screen come into view. */
const observers: IntersectionObserverCallback[] = [];
function allInView() {
  act(() => {
    for (const callback of [...observers]) {
      callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    }
  });
}

function renderPage() {
  const qc = createTestQueryClient();
  render(
    <QueryClientProvider client={qc}>
      <UnreadsPage />
    </QueryClientProvider>,
  );
  return qc;
}

const channel = (id: string, title: string, serverId = "ws-1") =>
  makeConversation({ id, title, serverId, conversationType: ConversationTypeEnum.CHANNEL });

/** The `markAsRead` inputs sent so far. */
function marks() {
  return requestMock.mock.calls
    .filter(([document]) => String(document).includes("markAsRead("))
    .map(([, variables]) => variables.input);
}

function messageReadsOf(conversationId: string) {
  return requestMock.mock.calls.filter(
    ([document, variables]) =>
      String(document).includes("query Messages(") && variables.conversationId === conversationId,
  );
}

const list = () => screen.getByRole("listbox", { name: "Unread messages" });

beforeEach(() => {
  requestMock.mockReset();
  host.markers = true;
  directSpaces.ids = [];
  rowProps.seen = [];
  Object.values(toastMock).forEach((fn) => fn.mockReset());
  observers.length = 0;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        observers.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  useAuthStore.setState({ session: { userId: "me" } } as never);
  useBlockedConversations.getState().reset();
  useShellStore.setState({ mainSurface: { kind: "unreads" }, selectedConversationId: null });
  useUnreadStore.setState({
    counts: {},
    spaceOf: {},
    markers: {},
    countSources: {},
    markAllPending: {},
    conversationMarks: {},
    held: {},
  });
});

afterEach(() => {
  while (undoLatestDeferredMark());
  cleanup();
  vi.unstubAllGlobals();
});

describe("UnreadsPage: groups", () => {
  beforeEach(() => {
    serve(
      {
        dev: { items: [message("d1", 1), message("d2", 2)] },
        fin: { items: [message("f1", 5)] },
      },
      {
        "ws-1": [channel("dev", "development")],
        "ws-2": [channel("fin", "finance", "ws-2")],
      },
    );
    useUnreadStore.getState().setCounts("ws-1", { dev: 2 }, { dev: MARKER });
    useUnreadStore.getState().setCounts("ws-2", { fin: 1 }, { fin: MARKER });
  });

  it("shows a group per conversation with its name, workspace and count", async () => {
    renderPage();
    expect(await screen.findByRole("group", { name: "#development" })).toBeInTheDocument();
    expect(await screen.findByText("Rim Dev · 2 unread")).toBeInTheDocument();
    expect(screen.getByText("Halden · 1 unread")).toBeInTheDocument();
  });

  it("filters to one workspace", async () => {
    renderPage();
    await screen.findByRole("group", { name: "#finance" });
    fireEvent.click(screen.getByRole("button", { name: "Halden" }));
    expect(screen.queryByRole("group", { name: "#development" })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "#finance" })).toBeInTheDocument();
  });

  it("leaves out a conversation someone blocked started", async () => {
    useBlockedConversations.getState().setIn("ws-1", { dev: "rimp1_x" });
    renderPage();
    await screen.findByRole("group", { name: "#finance" });
    expect(screen.queryByRole("group", { name: "#development" })).not.toBeInTheDocument();
  });

  it("sorts by newest message once known, and by count before that", async () => {
    useUnreadStore.getState().setCounts("ws-1", { dev: 9 }, { dev: MARKER });
    renderPage();
    await screen.findByRole("group", { name: "#finance" });
    const names = () =>
      screen.getAllByRole("group", { name: /^#/ }).map((g) => g.getAttribute("aria-label"));
    expect(names()).toEqual(["#development", "#finance"]);
    allInView();
    await screen.findByText("text of d2");
    await screen.findByText("text of f1");
    expect(names()).toEqual(["#finance", "#development"]);
  });

  it("names a conversation its lists do not reach, once it has been in view", async () => {
    useUnreadStore.getState().setCounts("ws-1", { other: 1 }, { other: MARKER });
    renderPage();
    await waitFor(() =>
      expect(screen.getAllByTestId("unread-group-name-skeleton")).toHaveLength(1),
    );
    allInView();
    expect(await screen.findByRole("heading", { name: "A conversation" })).toBeInTheDocument();
  });

  it("says when everything is read", async () => {
    useUnreadStore.getState().setCounts("ws-1", {}, {});
    useUnreadStore.getState().setCounts("ws-2", {}, {});
    renderPage();
    expect(await screen.findByText("You've read everything")).toBeInTheDocument();
  });
});

describe("UnreadsPage: direct spaces", () => {
  it("includes them, named Direct messages, with a filter of their own", async () => {
    directSpaces.ids = ["direct-1"];
    serve({ dm: { items: [message("x1", 1)] } });
    const answer = requestMock.getMockImplementation()!;
    requestMock.mockImplementation(async (document: unknown, variables: Record<string, string>) =>
      String(document).includes("inboxConversations")
        ? {
            inboxConversations: {
              items: [
                makeConversation({
                  id: "dm",
                  serverId: "direct-1",
                  title: "Ana",
                  conversationType: ConversationTypeEnum.DIRECT,
                }),
              ],
              pageInfo: { hasNext: false, hasPrev: false },
            },
          }
        : answer(document, variables),
    );
    useUnreadStore.getState().setCounts("direct-1", { dm: 1 }, { dm: MARKER });
    renderPage();
    expect(await screen.findByRole("group", { name: "Ana" })).toBeInTheDocument();
    expect(screen.getByText("Direct messages · 1 unread")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Direct messages" })).toBeInTheDocument();
  });
});

describe("UnreadsPage: muted", () => {
  it("leaves muted conversations out, behind Show muted", async () => {
    serve(
      { dev: { items: [message("d1", 1)] }, quiet: { items: [message("q1", 1)] } },
      { "ws-1": [channel("dev", "development"), channel("quiet", "quiet")] },
      { muted: ["quiet"] },
    );
    useUnreadStore
      .getState()
      .setCounts("ws-1", { dev: 1, quiet: 4 }, { dev: MARKER, quiet: MARKER });
    renderPage();
    const show = await screen.findByRole("button", { name: "Show muted (1)" });
    expect(screen.queryByRole("group", { name: "#quiet" })).not.toBeInTheDocument();
    fireEvent.click(show);
    expect(screen.getByRole("group", { name: "#quiet" })).toBeInTheDocument();
  });
});

describe("UnreadsPage: what only its count can say", () => {
  it("an older host shows the count and Open to read, and reads no messages", async () => {
    host.markers = false;
    serve({}, { "ws-1": [channel("dev", "development")] });
    useUnreadStore.getState().setCounts("ws-1", { dev: 3 });
    renderPage();
    const group = await screen.findByRole("group", { name: "#development" });
    allInView();
    expect(within(group).getByRole("button", { name: "Open to read" })).toBeInTheDocument();
    expect(within(group).queryByRole("button", { name: "Mark as read" })).not.toBeInTheDocument();
    expect(messageReadsOf("dev")).toEqual([]);
  });

  it("an encrypted conversation with no text here shows the same, and asks the server nothing", async () => {
    const encrypted = { ...channel("sec", "secret"), encryptedAt: "2026-01-01T00:00:00Z" };
    serve({}, { "ws-1": [encrypted] });
    useUnreadStore.getState().setCounts("ws-1", { sec: 2 }, { sec: MARKER });
    renderPage();
    const group = await screen.findByRole("group", { name: "#secret" });
    allInView();
    expect(await within(group).findByRole("button", { name: "Open to read" })).toBeInTheDocument();
    expect(within(group).getByText("Encrypted · 2 unread")).toBeInTheDocument();
    expect(messageReadsOf("sec")).toEqual([]);
  });

  it("ciphertext from the server shows the count, not empty rows", async () => {
    const sealed = { ...message("s1", 1), encryption: { v: 1 }, text: "" };
    serve({ dev: { items: [sealed] } }, { "ws-1": [channel("dev", "development")] });
    useUnreadStore.getState().setCounts("ws-1", { dev: 1 }, { dev: MARKER });
    renderPage();
    await screen.findByRole("group", { name: "#development" });
    allInView();
    expect(await screen.findByRole("button", { name: "Open to read" })).toBeInTheDocument();
    expect(screen.queryByText("text of s1")).not.toBeInTheDocument();
  });
});

describe("UnreadsPage: loading", () => {
  it("reads nothing until a group is in view, and at most four at once", async () => {
    const release: (() => void)[] = [];
    const pending = (id: string) => () =>
      new Promise<Page>((resolve) => {
        release.push(() => resolve({ items: [message(id, 1)] }));
      });
    const ids = ["a", "b", "c", "d", "e", "f"];
    serve(Object.fromEntries(ids.map((id) => [id, pending(id)])), {
      "ws-1": ids.map((id) => channel(id, id)),
    });
    useUnreadStore
      .getState()
      .setCounts(
        "ws-1",
        Object.fromEntries(ids.map((id) => [id, 1])),
        Object.fromEntries(ids.map((id) => [id, MARKER])),
      );
    renderPage();
    await screen.findByRole("group", { name: "#a" });
    expect(ids.flatMap(messageReadsOf)).toEqual([]);

    allInView();
    await waitFor(() => expect(ids.flatMap(messageReadsOf)).toHaveLength(4));

    await act(async () => release.shift()?.());
    await waitFor(() => expect(ids.flatMap(messageReadsOf)).toHaveLength(5));
  });

  it("shows more on asking, and says how many", async () => {
    const first = Array.from({ length: 20 }, (_, i) => message(`m${i}`, i));
    serve(
      { dev: [{ items: first, more: true }, { items: [message("late", 30)] }] },
      { "ws-1": [channel("dev", "development")] },
    );
    useUnreadStore.getState().setCounts("ws-1", { dev: 29 }, { dev: MARKER });
    renderPage();
    await screen.findByRole("group", { name: "#development" });
    allInView();
    fireEvent.click(await screen.findByRole("button", { name: "Show 9 more" }));
    expect(await screen.findByText("text of late")).toBeInTheDocument();
  });

  it("shows rows read-only: no reactions, no thread or reply actions", async () => {
    serve({ dev: { items: [message("d1", 1)] } }, { "ws-1": [channel("dev", "development")] });
    useUnreadStore.getState().setCounts("ws-1", { dev: 1 }, { dev: MARKER });
    renderPage();
    await screen.findByRole("group", { name: "#development" });
    allInView();
    await screen.findByText("text of d1");
    const props = rowProps.seen.at(-1) as {
      view: { message: { reactions: unknown[] }; inThreadPane: boolean };
      handlers: { canAddReaction: boolean; canStartThread: boolean; onReply?: unknown };
    };
    expect(props.view.message.reactions).toEqual([]);
    expect(props.view.inThreadPane).toBe(true);
    expect(props.handlers.canAddReaction).toBe(false);
    expect(props.handlers.canStartThread).toBe(false);
    expect(props.handlers.onReply).toBeUndefined();
  });
});

describe("UnreadsPage: failures", () => {
  it("a group that fails gets Retry, and the others stay", async () => {
    let failing = true;
    serve(
      {
        bad: async () => {
          if (failing) throw new Error("no");
          return { items: [message("b1", 1)] };
        },
        good: { items: [message("g1", 1)] },
      },
      { "ws-1": [channel("bad", "bad"), channel("good", "good")] },
    );
    useUnreadStore.getState().setCounts("ws-1", { bad: 1, good: 1 }, { bad: MARKER, good: MARKER });
    renderPage();
    await screen.findByRole("group", { name: "#good" });
    allInView();
    expect(await screen.findByText("Couldn't load #bad.")).toBeInTheDocument();
    expect(await screen.findByText("text of g1")).toBeInTheDocument();
    failing = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("text of b1")).toBeInTheDocument();
  });

  it("a workspace whose lists fail gets Retry, and the others stay", async () => {
    serve({ fin: { items: [message("f1", 1)] } }, { "ws-2": [channel("fin", "finance", "ws-2")] });
    const answer = requestMock.getMockImplementation()!;
    requestMock.mockImplementation(async (document: unknown, variables: Record<string, string>) => {
      if (String(document).includes("query Channels") && variables.serverId === "ws-1") {
        throw new Error("no");
      }
      return answer(document, variables);
    });
    useUnreadStore.getState().setCounts("ws-1", { dev: 1 }, { dev: MARKER });
    useUnreadStore.getState().setCounts("ws-2", { fin: 1 }, { fin: MARKER });
    renderPage();
    expect(await screen.findByText("Couldn't load Rim Dev.")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "#finance" })).toBeInTheDocument();
    requestMock.mockImplementation(answer);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(screen.queryByText("Couldn't load Rim Dev.")).not.toBeInTheDocument(),
    );
  });
});

describe("UnreadsPage: reading", () => {
  const items = [message("d1", 1), message("d2", 2)];

  beforeEach(() => {
    serve(
      { dev: { items }, fin: { items: [message("f1", 5)] } },
      {
        "ws-1": [channel("dev", "development")],
        "ws-2": [channel("fin", "finance", "ws-2")],
      },
    );
    useUnreadStore.getState().setCounts("ws-1", { dev: 2 }, { dev: MARKER });
    useUnreadStore.getState().setCounts("ws-2", { fin: 1 }, { fin: MARKER });
  });

  async function loaded() {
    renderPage();
    await screen.findByRole("group", { name: "#development" });
    allInView();
    await screen.findByText("text of d2");
    await screen.findByText("text of f1");
  }

  const markIn = (name: string) =>
    within(screen.getByRole("group", { name })).getByRole("button", { name: "Mark as read" });

  it("marks nothing by being open", async () => {
    await loaded();
    await act(() => new Promise((resolve) => setTimeout(resolve, 1200)));
    expect(marks()).toEqual([]);
    expect(useUnreadStore.getState().counts).toEqual({ dev: 2, fin: 1 });
  });

  it("marks up to the newest message shown, so one arriving later stays", async () => {
    await loaded();
    fireEvent.click(markIn("#development"));
    expect(await screen.findByText("#development marked as read")).toBeInTheDocument();
    expect(marks()).toEqual([]);

    // A newer message arrives after the mark was decided.
    useUnreadStore.getState().increment("dev", "ws-1");
    act(() => sendDeferredMark(useDeferredMarks.getState().marks[0].id));
    await waitFor(() => expect(marks()).toHaveLength(1));
    expect(marks()[0]).toEqual({
      conversationId: "dev",
      workspaceId: "ws-1",
      readAt: items[1].sentAt,
    });
  });

  it("says what stays unread when it has shown only part of them", async () => {
    useUnreadStore.getState().setCounts("ws-1", { dev: 12 }, { dev: MARKER });
    await loaded();
    fireEvent.click(markIn("#development"));
    expect(
      await screen.findByText("#development marked as read, 10 newer stay unread"),
    ).toBeInTheDocument();
    expect(useUnreadStore.getState().counts.dev).toBe(10);
  });

  it("Undo on the card restores it and sends nothing", async () => {
    await loaded();
    fireEvent.click(markIn("#development"));
    fireEvent.click(await screen.findByRole("button", { name: /^Undo/ }));
    expect(await screen.findByRole("group", { name: "#development" })).toBeInTheDocument();
    expect(useUnreadStore.getState().counts.dev).toBe(2);
    expect(useDeferredMarks.getState().marks).toEqual([]);
    expect(marks()).toEqual([]);
  });

  it("leaving the page does not cancel a mark", async () => {
    await loaded();
    fireEvent.click(markIn("#development"));
    await screen.findByText("#development marked as read");
    cleanup();
    expect(useDeferredMarks.getState().marks).toHaveLength(1);
  });

  it("Mark all shown marks every loaded group with one Undo", async () => {
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Mark all shown as read" }));
    expect(toastMock.success).toHaveBeenCalledWith(
      "2 conversations marked as read",
      expect.objectContaining({ duration: 10_000 }),
    );
    expect(useDeferredMarks.getState().marks).toHaveLength(1);
    expect(screen.queryByRole("group", { name: "#development" })).not.toBeInTheDocument();
    const { action } = toastMock.success.mock.calls[0][1];
    act(() => action.onClick());
    expect(await screen.findByRole("group", { name: "#development" })).toBeInTheDocument();
    expect(marks()).toEqual([]);
  });

  it("Mark all shown leaves a group not loaded yet, and says how many it marked", async () => {
    useUnreadStore.getState().setCounts("ws-2", { fin: 1, far: 1 }, { fin: MARKER, far: MARKER });
    renderPage();
    await screen.findByRole("group", { name: "#finance" });
    // Only the groups seen so far come into view.
    allInView();
    await screen.findByText("text of d2");
    await screen.findByText("text of f1");
    requestMock.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Mark all shown as read" }));
    const [title] = toastMock.success.mock.calls[0];
    expect(title).toMatch(/^\d of 3 conversations marked as read/);
    expect(
      useDeferredMarks.getState().marks[0].conversations.map((c) => c.conversationId),
    ).not.toContain("far");
  });

  it("Open goes to the first unread, without marking it here", async () => {
    await loaded();
    fireEvent.click(
      within(screen.getByRole("group", { name: "#development" })).getByRole("button", {
        name: "Open",
      }),
    );
    expect(jump).toHaveBeenCalledWith(expect.anything(), {
      serverId: "ws-1",
      conversationId: "dev",
      messageId: "d1",
      threadId: null,
    });
    expect(marks()).toEqual([]);
  });

  describe("keyboard", () => {
    const press = (key: string, target: Element = list()) => fireEvent.keyDown(target, { key });
    const selected = () =>
      screen.getAllByRole("option").find((row) => row.getAttribute("aria-selected") === "true");

    it("starts on the list", async () => {
      await loaded();
      expect(document.activeElement).toBe(list());
    });

    it("J and K move, in a listbox that names the selected row", async () => {
      await loaded();
      press("j");
      const first = selected();
      expect(first).toBeDefined();
      expect(list().getAttribute("aria-activedescendant")).toBe(first?.id);
      press("j");
      expect(selected()).not.toBe(first);
      press("k");
      expect(selected()).toBe(first);
    });

    it("the arrow keys move too, which is what the Vim layer's j and k send", async () => {
      await loaded();
      press("ArrowDown");
      const first = selected();
      press("ArrowDown");
      press("ArrowUp");
      expect(selected()).toBe(first);
    });

    it("E marks the selected group and U undoes it", async () => {
      await loaded();
      press("j");
      const group = selected()?.closest("[data-unread-group]")?.getAttribute("data-unread-group");
      press("e");
      expect(useDeferredMarks.getState().marks[0].conversations[0].conversationId).toBe(group);
      press("u");
      expect(useDeferredMarks.getState().marks).toEqual([]);
      expect(marks()).toEqual([]);
    });

    it("Enter opens the selected message", async () => {
      await loaded();
      press("j");
      const id = selected()?.getAttribute("data-message-id");
      press("Enter");
      expect(jump).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ messageId: id, threadId: null }),
      );
    });

    it("leaves Enter to a focused button, and every key to a text field", async () => {
      await loaded();
      press("j");
      press("Enter", markIn("#finance"));
      expect(jump).not.toHaveBeenCalled();

      const field = document.createElement("input");
      screen.getByRole("listbox", { name: "Unread messages" }).appendChild(field);
      const before = selected();
      press("j", field);
      expect(selected()).toBe(before);
      field.remove();
    });

    it("ignores a key held with a modifier", async () => {
      await loaded();
      fireEvent.keyDown(list(), { key: "j", ctrlKey: true });
      expect(selected()).toBeUndefined();
    });

    it("each key's command runs from the palette or a keybind too", async () => {
      await loaded();
      act(() => void runDesktopLocalCommand("workspace.unreads_next"));
      const first = selected();
      expect(first).toBeDefined();
      act(() => void runDesktopLocalCommand("workspace.unreads_next"));
      act(() => void runDesktopLocalCommand("workspace.unreads_previous"));
      expect(selected()).toBe(first);
      act(() => void runDesktopLocalCommand("workspace.unreads_mark_group"));
      expect(useDeferredMarks.getState().marks).toHaveLength(1);
      act(() => void runDesktopLocalCommand("workspace.unreads_undo"));
      expect(useDeferredMarks.getState().marks).toEqual([]);
      act(() => void runDesktopLocalCommand("workspace.unreads_open"));
      expect(jump).toHaveBeenCalled();
    });
  });
});

describe("the page's commands away from the page", () => {
  it("do nothing", () => {
    for (const id of ["next", "previous", "mark_group", "open", "undo"]) {
      expect(() => runDesktopLocalCommand(`workspace.unreads_${id}`)).not.toThrow();
    }
    expect(marks()).toEqual([]);
  });
});
