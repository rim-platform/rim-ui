import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useSearchOverlayStore } from "../state/useSearchOverlayStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import type { SearchMessageItem } from "../api/useSearchMessages";

vi.mock("../../conversations/api/useChannels", () => ({
  useChannels: () => ({ data: { items: [] } }),
}));

vi.mock("../api/useSearchMessages", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/useSearchMessages")>();
  return { ...actual, useSearchMessages: vi.fn() };
});

import { useSearchMessages } from "../api/useSearchMessages";
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
  } = {},
) {
  vi.mocked(useSearchMessages).mockReturnValue({
    data: {
      pages: [{ items, next: null, prev: null, pageInfo: { hasNext: false, hasPrev: false } }],
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

describe("SearchOverlay", () => {
  beforeEach(() => {
    vi.mocked(useSearchMessages).mockReset();
    mockSearchResult([]);
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
    // No group-count header like "# general — 1 hit" from the old grouped UI.
    expect(screen.queryByText(/hit/)).not.toBeInTheDocument();
    // No "next group" hint — Tab-to-next-group was removed with grouping.
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
});
