import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const conversation = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
const platform = vi.hoisted(() => ({ current: "desktop" }));
const serverMembers = vi.hoisted(() => ({ current: [] as Record<string, unknown>[] }));
const runtime = vi.hoisted(() => ({
  createGroup: vi.fn(),
  refreshGroups: vi.fn(),
  conversationMembers: vi.fn(),
  notReadyMembers: vi.fn(),
}));

vi.mock("../../conversations/api/useConversation", () => ({
  useConversation: () => ({ data: conversation.current }),
}));
vi.mock("../../../core/runtime/runtime", async (importActual) => ({
  ...(await importActual<typeof import("../../../core/runtime/runtime")>()),
  detectPlatform: () => platform.current,
}));
vi.mock("../runtime/groups", () => ({
  createGroup: runtime.createGroup,
  refreshGroups: runtime.refreshGroups,
}));
vi.mock("../runtime/membership", () => ({ syncMembership: vi.fn(async () => undefined) }));
vi.mock("../../workspaces/api/useServerMembers", () => ({
  useServerMembers: () => ({ data: serverMembers.current }),
}));
vi.mock("../runtime/members", () => ({
  conversationMembers: runtime.conversationMembers,
  notReadyMembers: runtime.notReadyMembers,
}));
vi.mock("../runtime/session", () => ({
  e2eeSession: async () => ({
    account: { endpoint: "http://x/api", userId: "u-me" },
    userId: "u-me",
    principalId: "rimp1_me",
    deviceId: "dev-me",
  }),
}));

import { TestProviders } from "../../../test/utils";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useE2eeStore } from "../state/useE2eeStore";
import { useE2eeConversation } from "./useE2eeConversation";

function dm(overrides: Record<string, unknown> = {}) {
  return {
    id: "c",
    conversationType: "DIRECT",
    memberIds: ["u-me", "u-bob"],
    createdBy: "u-bob",
    encryptedAt: null,
    ...overrides,
  };
}

describe("useE2eeConversation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    platform.current = "desktop";
    useE2eeStore.getState().clear();
    useE2eeStore.getState().setWebEncryption("checking");
    useAuthStore.getState().setSession({ userId: "u-me" });
    runtime.refreshGroups.mockResolvedValue([]);
    runtime.conversationMembers.mockResolvedValue([]);
    runtime.createGroup.mockResolvedValue(true);
    serverMembers.current = [];
  });

  it("upgrades a DM once every member is ready", async () => {
    conversation.current = dm();
    runtime.notReadyMembers.mockResolvedValue({ names: [], directory: [] });
    renderHook(() => useE2eeConversation("ws", "c"), { wrapper: TestProviders });
    await waitFor(() => expect(runtime.createGroup).toHaveBeenCalled());
    expect(runtime.createGroup.mock.calls[0].slice(1)).toEqual(["ws", "c"]);
  });

  it("names who is not ready and leaves the conversation plaintext", async () => {
    conversation.current = dm();
    runtime.notReadyMembers.mockResolvedValue({ names: ["Bob"], directory: [] });
    const { result } = renderHook(() => useE2eeConversation("ws", "c"), {
      wrapper: TestProviders,
    });
    await waitFor(() => expect(result.current.notReady).toEqual(["Bob"]));
    expect(runtime.createGroup).not.toHaveBeenCalled();
  });

  it("leaves a group's upgrade to its creator's devices", async () => {
    conversation.current = dm({ conversationType: "GROUP", memberIds: ["u-me", "u-bob"] });
    runtime.notReadyMembers.mockResolvedValue({ names: [], directory: [] });
    renderHook(() => useE2eeConversation("ws", "c"), { wrapper: TestProviders });
    await waitFor(() => expect(runtime.notReadyMembers).toHaveBeenCalled());
    expect(runtime.createGroup).not.toHaveBeenCalled();
  });

  it("lets any member upgrade a group whose creator left", async () => {
    conversation.current = dm({ conversationType: "GROUP", memberIds: ["u-me", "u-carol"] });
    runtime.notReadyMembers.mockResolvedValue({ names: [], directory: [] });
    renderHook(() => useE2eeConversation("ws", "c"), { wrapper: TestProviders });
    await waitFor(() => expect(runtime.createGroup).toHaveBeenCalled());
  });

  it("never touches channels", async () => {
    conversation.current = dm({ conversationType: "CHANNEL" });
    renderHook(() => useE2eeConversation("ws", "c"), { wrapper: TestProviders });
    await new Promise((r) => setTimeout(r, 0));
    expect(runtime.notReadyMembers).not.toHaveBeenCalled();
  });

  it("stops sending while a device does not verify", () => {
    conversation.current = dm({ encryptedAt: "2026-10-09T00:00:00Z" });
    useE2eeStore.getState().setGroup({
      conversationId: "c",
      unverified: [{ principalId: "p", deviceId: "d", reason: "unknownDevice" }],
      readdRequestedAt: null,
      awaitingReadd: null,
      removed: false,
    } as never);
    const { result } = renderHook(() => useE2eeConversation("ws", "c"), {
      wrapper: TestProviders,
    });
    expect(result.current.sendBlock).toBe("unverified");
  });

  it("never upgrades from a browser, and says a desktop does", async () => {
    platform.current = "web";
    useE2eeStore.getState().setWebEncryption("ready");
    conversation.current = dm();
    runtime.notReadyMembers.mockResolvedValue({ names: [], directory: [] });
    const { result } = renderHook(() => useE2eeConversation("ws", "c"), {
      wrapper: TestProviders,
    });
    await waitFor(() => expect(result.current.upgradeOnDesktop).toBe(true));
    expect(runtime.createGroup).not.toHaveBeenCalled();
  });

  it("tells a browser that cannot take part why", () => {
    platform.current = "web";
    conversation.current = dm({ encryptedAt: "2026-10-09T00:00:00Z" });
    useE2eeStore.getState().setWebEncryption("noDeviceKey");
    const { result, rerender } = renderHook(() => useE2eeConversation("ws", "c"), {
      wrapper: TestProviders,
    });
    expect(result.current.sendBlock).toBe("noDeviceKey");
    useE2eeStore.getState().setWebEncryption("unsupported");
    rerender();
    expect(result.current.sendBlock).toBe("unsupported");
    useE2eeStore.getState().setWebEncryption("ready");
    rerender();
    expect(result.current.sendBlock).toBeNull();
  });

  it("finding 1: a pinned conversation the server calls plaintext stays encrypted and stops sending", () => {
    conversation.current = dm({ encryptedAt: null });
    useE2eeStore.getState().setGroup({
      conversationId: "c",
      unverified: [],
      readdRequestedAt: null,
      awaitingReadd: null,
      removed: false,
      pinned: true,
      pinnedEncryptedAt: "2026-10-09T00:00:00Z",
      dmPrincipals: null,
    } as never);
    const { result } = renderHook(() => useE2eeConversation("ws", "c"), {
      wrapper: TestProviders,
    });
    expect(result.current.encrypted).toBe(true);
    expect(result.current.encryptedAt).toBe("2026-10-09T00:00:00Z");
    expect(result.current.sendBlock).toBe("encryptionReset");
    expect(result.current.notReady).toEqual([]);
    expect(runtime.createGroup).not.toHaveBeenCalled();
  });

  it("finding 4: a direct message stops sending while the server lists a third member", () => {
    serverMembers.current = [
      { userId: "u-me", principalId: "rimp1_me", displayName: "Me" },
      { userId: "u-bob", principalId: "rimp1_bob", displayName: "Bob" },
      { userId: "u-mallory", principalId: "rimp1_mallory", displayName: "Mallory" },
    ];
    conversation.current = dm({
      encryptedAt: "2026-10-09T00:00:00Z",
      memberIds: ["u-me", "u-bob", "u-mallory"],
    });
    useE2eeStore.getState().setGroup({
      conversationId: "c",
      unverified: [],
      readdRequestedAt: null,
      awaitingReadd: null,
      removed: false,
      pinned: true,
      pinnedEncryptedAt: "2026-10-09T00:00:00Z",
      dmPrincipals: ["rimp1_bob", "rimp1_me"],
    } as never);
    const { result, rerender } = renderHook(() => useE2eeConversation("ws", "c"), {
      wrapper: TestProviders,
    });
    expect(result.current.foreignMembers).toEqual(["Mallory"]);
    expect(result.current.sendBlock).toBe("foreignMember");

    // Gone from the members, still a pending add the membership sync refused.
    conversation.current = dm({ encryptedAt: "2026-10-09T00:00:00Z" });
    useE2eeStore.getState().setRefusedAdds("c", ["rimp1_mallory"]);
    rerender();
    expect(result.current.foreignMembers).toEqual(["Mallory"]);
    useE2eeStore.getState().setRefusedAdds("c", []);
    rerender();
    expect(result.current.sendBlock).toBeNull();
  });
});
