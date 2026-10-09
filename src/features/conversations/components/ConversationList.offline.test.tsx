import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider, onlineManager } from "@tanstack/react-query";

import { createTestQueryClient } from "../../../test/utils";
import { ConversationTypeEnum } from "../../../core/graphql/generated/schema-types";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { currentUser, makeConversation, workspaceMembers } from "../__fixtures__/conversations";

const requestMock = vi.fn();
const safeInvokeMock = vi.fn();
const account = { endpoint: "http://localhost:8080/api", userId: "me" };

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));
vi.mock("../../../core/tauri/safeInvoke", () => ({
  safeInvoke: (...args: unknown[]) => safeInvokeMock(...args),
}));
// The desktop app's cache account, as `currentCacheAccount` gives it under Tauri.
vi.mock("../../messages/api/messageCache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../messages/api/messageCache")>()),
  currentCacheAccount: () => (useAuthStore.getState().session ? account : null),
}));
vi.mock("../../commands/hooks/useKeybindLabel", () => ({ useKeybindLabel: () => null }));
vi.mock("../../../core/events/usePrefetchMessages", () => ({ usePrefetchMessages: () => {} }));

import { ConversationList } from "./ConversationList";

const general = makeConversation({ id: "c-general", title: "general" });
const dm = makeConversation({
  id: "c-dm",
  title: null,
  conversationType: ConversationTypeEnum.DIRECT,
  memberIds: ["me", "u-alice"],
});
const pageOf = (items: unknown[]) => ({ items, pageInfo: { hasNext: false, hasPrev: false } });

/** What an earlier online run saved on this device. */
const saved: Record<string, unknown> = {
  "me:": currentUser,
  "joinedChannels:ws-1": pageOf([general]),
  "inbox:ws-1": pageOf([dm]),
  "members:ws-1": workspaceMembers,
};

describe("ConversationList — offline start", () => {
  beforeEach(() => {
    requestMock.mockReset().mockRejectedValue(new TypeError("Failed to fetch"));
    safeInvokeMock
      .mockReset()
      .mockImplementation((command: string, args: Record<string, unknown>) => {
        if (command !== "message_cache_snapshot_get")
          return Promise.resolve({ ok: true, value: null });
        const value = saved[`${String(args.kind)}:${String(args.workspaceId ?? "")}`];
        return Promise.resolve({ ok: true, value: value ? { value, savedAt: 1 } : null });
      });
    // The OS says there is no network: queries must still reach the saved copies.
    onlineManager.setOnline(false);
    useShellStore.getState().reset();
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useAuthStore.setState({ session: { userId: "me" } });
  });

  afterEach(() => {
    onlineManager.setOnline(true);
    useWorkspaceStore.setState({ workspaceId: null });
    useAuthStore.setState({ session: null });
  });

  it("lists the channels and DMs saved on this device, with member names", async () => {
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <ConversationList onNewChannel={vi.fn()} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("general")).toBeInTheDocument();
    expect(await screen.findByText("Alice")).toBeInTheDocument();
    await waitFor(() =>
      expect(safeInvokeMock).toHaveBeenCalledWith("message_cache_snapshot_get", {
        account,
        kind: "inbox",
        workspaceId: "ws-1",
      }),
    );
    // Nothing was written over the saved copies.
    expect(
      safeInvokeMock.mock.calls.filter(([command]) => command === "message_cache_snapshot_put"),
    ).toHaveLength(0);
  });
});
