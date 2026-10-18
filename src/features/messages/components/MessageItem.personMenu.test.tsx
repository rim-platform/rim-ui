import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { createTestQueryClient } from "../../../test/utils";
import { ServerMemberRoleGql } from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { LONG_PRESS_MS, useContextMenu } from "../../../shared/ui/contextMenu/useContextMenu";
import { useAuthStore } from "../../auth/state/useAuthStore";
import {
  currentUser,
  routeRequests,
  workspaceMembers,
} from "../../conversations/__fixtures__/conversations";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

import { useUserContextMenu } from "../../workspaces/hooks/useUserContextMenu";
import { MessageItem, type MessageItemHandlers } from "./MessageItem";

/** One timeline row wired as the timeline wires it: the message's menu and the people's. */
function Row({ text }: { text: string }) {
  const rowMenu = useContextMenu();
  const userMenu = useUserContextMenu({ workspaceId: "ws-1" });
  const { openFromEvent, bind } = rowMenu;
  const { bind: bindUserContextMenu, openFrom } = userMenu;
  const messageItems = useCallback(
    () => [{ id: "copy-text", label: "Copy Text", onSelect: () => {} }],
    [],
  );
  const onMentionContextMenu = useCallback<
    NonNullable<MessageItemHandlers["onMentionContextMenu"]>
  >((userId, mention, event) => void openFrom(event, { userId }, mention), [openFrom]);
  const handlers = useMemo<MessageItemHandlers>(
    () => ({
      onOpenThread: () => {},
      onToggleReaction: () => {},
      onContextMenu: (event) => void openFromEvent(event, messageItems),
      bindContextMenu: () => bind(messageItems),
      bindUserContextMenu,
      onMentionContextMenu,
    }),
    [openFromEvent, bind, messageItems, bindUserContextMenu, onMentionContextMenu],
  );
  return (
    <>
      <MessageItem
        view={{
          message: {
            id: "msg-1",
            text,
            authorId: "u-alice",
            sentAt: "2026-10-01T12:00:00Z",
            reactions: [],
          },
          author: { name: "Alice", username: "alice", isCurrentUser: false },
        }}
        handlers={handlers}
        members={{ displayMap: new Map([["u-bob", "Bob"]]) }}
      />
      {rowMenu.menu}
      {userMenu.element}
    </>
  );
}

async function renderRow(text = "hello <@u-bob>") {
  routeRequests(requestMock, {
    "query Me": () => ({ me: currentUser }),
    "query ServerMembers": () => ({ serverMembers: workspaceMembers }),
    "query Server(": () => ({
      server: { id: "ws-1", name: "Acme", viewerRole: ServerMemberRoleGql.MEMBER },
    }),
  });
  const qc = createTestQueryClient();
  render(
    <QueryClientProvider client={qc}>
      <Row text={text} />
    </QueryClientProvider>,
  );
  await waitFor(() => {
    expect(qc.getQueryData(queryKeys.serverMembers("ws-1"))).toBeDefined();
    expect(qc.getQueryData(queryKeys.server("ws-1"))).toBeDefined();
  });
}

function openMenuName(): string | null {
  return screen.getByRole("menu").getAttribute("aria-label");
}

describe("MessageItem person menus", () => {
  beforeEach(() => {
    requestMock.mockReset();
    useAuthStore.setState({ session: { userId: "me" } });
  });

  afterEach(() => {
    useAuthStore.setState({ session: null });
    vi.useRealTimers();
  });

  it("opens the author's menu, not the message's, on a right click on the name", async () => {
    await renderRow();
    fireEvent.contextMenu(screen.getByText("Alice"));
    expect(openMenuName()).toBe("Actions for Alice");
    expect(screen.getByRole("menuitem", { name: "Send message" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Copy Text" })).not.toBeInTheDocument();
  });

  it("opens the author's menu on a right click on the avatar", async () => {
    await renderRow();
    const avatar = document.querySelector("[data-message-id] > span.cursor-pointer");
    fireEvent.contextMenu(avatar as Element);
    expect(openMenuName()).toBe("Actions for Alice");
  });

  it("still opens the message's menu on a right click on its text", async () => {
    await renderRow();
    fireEvent.contextMenu(screen.getByText(/hello/));
    expect(screen.getByRole("menuitem", { name: "Copy Text" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Send message" })).not.toBeInTheDocument();
  });

  it("opens a mentioned person's menu on a right click on the mention", async () => {
    await renderRow();
    fireEvent.contextMenu(screen.getByText("@Bob"));
    expect(openMenuName()).toBe("Actions for Bob");
    expect(screen.queryByRole("menuitem", { name: "Copy Text" })).not.toBeInTheDocument();
  });

  it("opens a mentioned person's menu from the ContextMenu key, which goes no further", async () => {
    await renderRow();
    const onListKeyDown = vi.fn();
    document.addEventListener("keydown", onListKeyDown);
    try {
      fireEvent.keyDown(screen.getByText("@Bob"), { key: "ContextMenu" });
    } finally {
      document.removeEventListener("keydown", onListKeyDown);
    }
    expect(openMenuName()).toBe("Actions for Bob");
    expect(onListKeyDown).not.toHaveBeenCalled();
  });

  it("opens the author's menu, not the message's, on a long press on the name", async () => {
    await renderRow();
    vi.useFakeTimers();
    fireEvent.touchStart(screen.getByText("Alice"), {
      touches: [{ clientX: 10, clientY: 10 }],
    });
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    expect(openMenuName()).toBe("Actions for Alice");
    expect(screen.queryByRole("menuitem", { name: "Copy Text" })).not.toBeInTheDocument();
  });
});
