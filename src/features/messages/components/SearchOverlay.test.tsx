import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useSearchOverlayStore } from "../state/useSearchOverlayStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import type { SearchMessageItem } from "../api/useSearchMessages";

const requestCacheSyncMock = vi.fn();

vi.mock("../../conversations/api/useChannels", () => ({
  useChannels: () => ({
    data: {
      items: [{ id: "conv-1", title: "general", conversationType: "CHANNEL" }],
    },
  }),
  useJoinedChannels: () => ({ data: undefined }),
}));

vi.mock("../../conversations/api/useInboxConversations", () => ({
  useInboxConversations: () => ({ data: undefined }),
}));

vi.mock("../../workspaces/api/useServerMembers", async () => {
  const { workspaceMembers } = await import("../../conversations/__fixtures__/conversations");
  return { useServerMembers: () => ({ data: workspaceMembers }) };
});

vi.mock("../runtime/messageCacheSync", () => ({
  requestCacheSync: (...args: unknown[]) => requestCacheSyncMock(...args),
}));

vi.mock("../api/useSearchMessages", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/useSearchMessages")>();
  return { ...actual, useSearchMessages: vi.fn(), useLocalSearchHits: vi.fn() };
});

import { useLocalSearchHits, useSearchMessages } from "../api/useSearchMessages";
import { SearchOverlay } from "./SearchOverlay";

function makeItem(overrides: Partial<SearchMessageItem> = {}): SearchMessageItem {
  return {
    id: "m1",
    serverId: "ws-1",
    conversationId: "conv-1",
    conversationTitle: "general",
    conversationType: "CHANNEL",
    threadId: null,
    authorId: "u1",
    author: { id: "u1", username: "alice", displayName: "Alice", avatarUrl: null },
    text: "the deploy failed",
    sentAt: "2026-07-01T00:00:00Z",
    rootMessageId: null,
    rank: 0.8,
    headline: "the <mark>deploy</mark> failed",
    ...overrides,
  };
}

function mockSearchResult(
  items: SearchMessageItem[],
  opts: {
    hasNextPage?: boolean;
    isFetchingNextPage?: boolean;
    isPending?: boolean;
    isError?: boolean;
    fetchNextPage?: () => void;
    source?: "local";
  } = {},
) {
  vi.mocked(useSearchMessages).mockReturnValue({
    data: {
      pages: [
        {
          items,
          next: null,
          prev: null,
          pageInfo: { hasNext: false, hasPrev: false },
          source: opts.source,
        },
      ],
      pageParams: [undefined],
    },
    isPending: opts.isPending ?? false,
    isError: opts.isError ?? false,
    refetch: vi.fn(),
    fetchNextPage: opts.fetchNextPage ?? vi.fn(),
    hasNextPage: opts.hasNextPage ?? false,
    isFetchingNextPage: opts.isFetchingNextPage ?? false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- partial mock of a large TanStack Query return type
  } as any);
}

function mockLocalHits(items: SearchMessageItem[]) {
  vi.mocked(useLocalSearchHits).mockReturnValue({
    data: items,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- partial mock of a TanStack Query result
  } as any);
}

describe("SearchOverlay", () => {
  beforeEach(() => {
    vi.mocked(useSearchMessages).mockReset();
    mockSearchResult([]);
    mockLocalHits([]);
    requestCacheSyncMock.mockReset();
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useSearchOverlayStore.setState({
      isOpen: true,
      query: "deploy",
      scope: { kind: "all" },
      recentSearches: [],
    });
    useShellStore.getState().reset();
  });

  it("renders nothing when closed", () => {
    useSearchOverlayStore.setState({ isOpen: false });
    const { container } = render(<SearchOverlay />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a flat list of results with no group headers", () => {
    mockSearchResult([
      makeItem({ id: "m1", conversationId: "conv-1", conversationTitle: "general" }),
      makeItem({ id: "m2", conversationId: "conv-2", conversationTitle: "random" }),
    ]);
    render(<SearchOverlay />);

    expect(screen.getAllByRole("button", { name: /alice/i })).toHaveLength(2);
    // Results are a flat list: no group-count header like "# general — 1 hit".
    expect(screen.queryByText(/hit/)).not.toBeInTheDocument();
    // No "next group" hint either.
    expect(screen.queryByText(/next group/i)).not.toBeInTheDocument();
  });

  it("renders the mark highlight but strips an injected <img> from the headline (XSS)", () => {
    mockSearchResult([
      makeItem({ headline: "<img src=x onerror=alert(1)><mark>hit</mark>", text: "hit" }),
    ]);
    const { container } = render(<SearchOverlay />);

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("mark")?.textContent).toBe("hit");
  });

  it("falls back to escaped plain text when headline is null", () => {
    mockSearchResult([makeItem({ headline: null, text: "plain text result" })]);
    render(<SearchOverlay />);
    expect(screen.getByText("plain text result")).toBeInTheDocument();
  });

  it("clicking 'Load more' calls fetchNextPage", () => {
    const fetchNextPage = vi.fn();
    mockSearchResult([makeItem()], { hasNextPage: true, fetchNextPage });
    render(<SearchOverlay />);

    fireEvent.click(screen.getByRole("button", { name: /load more/i }));
    expect(fetchNextPage).toHaveBeenCalled();
  });

  it("does not render a 'Load more' row when there is no next page", () => {
    mockSearchResult([makeItem()], { hasNextPage: false });
    render(<SearchOverlay />);
    expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
  });

  it("toggles the search-tips popover", () => {
    mockSearchResult([]);
    render(<SearchOverlay />);

    expect(screen.queryByText("Search operators")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /search tips/i }));
    expect(screen.getByText("Search operators")).toBeInTheDocument();
    expect(screen.getByText("from:@alice")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /search tips/i }));
    expect(screen.queryByText("Search operators")).not.toBeInTheDocument();
  });

  it("shows the operator-discovery placeholder", () => {
    mockSearchResult([]);
    render(<SearchOverlay />);
    expect(screen.getByPlaceholderText(/from:@user.*in:#channel.*has:link/)).toBeInTheDocument();
  });

  describe("local search", () => {
    it("adds local hits the server did not return, without duplicates", () => {
      mockSearchResult([makeItem({ id: "m1", sentAt: "2026-07-01T00:00:00Z" })]);
      mockLocalHits([
        makeItem({ id: "m1", sentAt: "2026-07-01T00:00:00Z" }),
        makeItem({
          id: "local-1",
          sentAt: "2026-07-02T00:00:00Z",
          author: { id: "u2", username: "bob", displayName: "Bob", avatarUrl: null },
        }),
      ]);
      render(<SearchOverlay />);

      const rows = screen.getAllByRole("button", { name: /alice|bob/i });
      expect(rows).toHaveLength(2);
      expect(rows[0]).toHaveTextContent("Bob");
      expect(screen.queryByText(/offline/i)).not.toBeInTheDocument();
    });

    it("keeps out local hits from conversations the lists no longer show, and re-syncs them", () => {
      mockSearchResult([]);
      mockLocalHits([makeItem({ id: "gone", conversationId: "conv-left" })]);
      render(<SearchOverlay />);

      expect(screen.queryByRole("button", { name: /alice/i })).not.toBeInTheDocument();
      expect(requestCacheSyncMock).toHaveBeenCalledWith("ws-1", ["conv-left"]);
    });

    it("says so when the results come from this device", () => {
      mockSearchResult([makeItem()], { source: "local" });
      render(<SearchOverlay />);

      expect(screen.getByText(/offline: showing matches from messages saved/i)).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: /alice/i })).toHaveLength(1);
    });
  });

  describe("keyboard navigation over the flat list", () => {
    it("ArrowDown/ArrowUp move the selection and Enter jumps to the selected message", () => {
      const setSelectedConversationId = vi.fn();
      useShellStore.setState({ setSelectedConversationId });
      mockSearchResult([
        makeItem({ id: "m1", conversationId: "conv-1" }),
        makeItem({ id: "m2", conversationId: "conv-2" }),
      ]);
      render(<SearchOverlay />);

      const dialog = screen.getByPlaceholderText(/from:@user/).closest("div")!.parentElement!;
      fireEvent.keyDown(dialog, { key: "ArrowDown" });
      fireEvent.keyDown(dialog, { key: "Enter" });

      expect(setSelectedConversationId).toHaveBeenCalledWith("conv-2");
    });

    it("Escape closes the tips popover first, then clears the query, then closes the overlay", () => {
      mockSearchResult([]);
      render(<SearchOverlay />);
      const dialog = screen.getByPlaceholderText(/from:@user/).closest("div")!.parentElement!;

      fireEvent.click(screen.getByRole("button", { name: /search tips/i }));
      expect(screen.getByText("Search operators")).toBeInTheDocument();

      fireEvent.keyDown(dialog, { key: "Escape" });
      expect(screen.queryByText("Search operators")).not.toBeInTheDocument();
      expect(useSearchOverlayStore.getState().isOpen).toBe(true);

      fireEvent.keyDown(dialog, { key: "Escape" });
      expect(useSearchOverlayStore.getState().query).toBe("");

      fireEvent.keyDown(dialog, { key: "Escape" });
      expect(useSearchOverlayStore.getState().isOpen).toBe(false);
    });
  });

  describe("operator suggestions", () => {
    /** The focused search input with `value` typed and the caret at `caret`. */
    function typeInSearch(value: string, caret = value.length): HTMLInputElement {
      const input = screen.getByPlaceholderText(/from:@user/) as HTMLInputElement;
      act(() => input.focus());
      fireEvent.change(input, { target: { value } });
      input.setSelectionRange(caret, caret);
      fireEvent.select(input);
      return input;
    }

    it("lists members for from:@ and Enter inserts the picked one instead of opening a result", () => {
      const setSelectedConversationId = vi.fn();
      useShellStore.setState({ setSelectedConversationId });
      mockSearchResult([makeItem()]);
      render(<SearchOverlay />);
      const input = typeInSearch("from:@ deploy", "from:@".length);

      const options = screen.getAllByRole("option");
      expect(options.map((o) => o.textContent)).toEqual(["Alice@alice", "Bob@bob", "Me Myself@me"]);

      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(useSearchOverlayStore.getState().query).toBe("from:@bob deploy");
      expect(input.selectionStart).toBe("from:@bob ".length);
      expect(setSelectedConversationId).not.toHaveBeenCalled();
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });

    it("inserts a clicked suggestion and keeps the input focused", () => {
      render(<SearchOverlay />);
      const input = typeInSearch("in:#gen");

      fireEvent.click(screen.getByRole("option", { name: "#general" }));

      expect(useSearchOverlayStore.getState().query).toBe("in:#general ");
      expect(document.activeElement).toBe(input);
    });

    it("Tab inserts the selected has: value", () => {
      render(<SearchOverlay />);
      const input = typeInSearch("has:l");

      fireEvent.keyDown(input, { key: "Tab" });

      expect(useSearchOverlayStore.getState().query).toBe("has:link ");
    });

    it("Escape closes only the popover; the next Escape goes on to the query", () => {
      render(<SearchOverlay />);
      const input = typeInSearch("from:");
      expect(screen.getByRole("listbox")).toBeInTheDocument();

      fireEvent.keyDown(input, { key: "Escape" });
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(useSearchOverlayStore.getState()).toMatchObject({ isOpen: true, query: "from:" });

      fireEvent.keyDown(input, { key: "Escape" });
      expect(useSearchOverlayStore.getState().query).toBe("");
    });
  });
});
