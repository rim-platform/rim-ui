import { describe, it, expect } from "vitest";
import { queryKeys, VOLATILE_WORKSPACE_KEY_ROOTS } from "./keys";

describe("queryKeys", () => {
  it("healthCheck is a static key", () => {
    expect(queryKeys.healthCheck).toEqual(["healthCheck"]);
  });

  it("me is a static key", () => {
    expect(queryKeys.me).toEqual(["me"]);
  });

  it("myServers returns stable key", () => {
    expect(queryKeys.myServers()).toEqual(["myServers"]);
  });

  it("listAuditLog keys the scope, the verb and the cursor", () => {
    expect(queryKeys.listAuditLog("ws-1", "user-1", "WRITE", "cursor-1")).toEqual([
      "listAuditLog",
      "ws-1",
      "user-1",
      "WRITE",
      "cursor-1",
    ]);
  });

  it("listAuditLog keeps a missing scope part as null so scopes never collide", () => {
    expect(queryKeys.listAuditLog("ws-1")).toEqual(["listAuditLog", "ws-1", null, null, null]);
    expect(queryKeys.listAuditLog(undefined, "user-1")).toEqual([
      "listAuditLog",
      null,
      "user-1",
      null,
      null,
    ]);
  });

  it("serverMembers includes serverId", () => {
    expect(queryKeys.serverMembers("srv-1")).toEqual(["serverMembers", "srv-1"]);
  });

  it("serverMembers with undefined", () => {
    expect(queryKeys.serverMembers()).toEqual(["serverMembers", undefined]);
  });

  it("conversations includes workspaceId", () => {
    expect(queryKeys.conversations("ws-1")).toEqual(["conversations", "ws-1"]);
  });

  it("joinedChannels extends the channels prefix so channel invalidations reach it", () => {
    expect(queryKeys.joinedChannels("ws-1")).toEqual(["channels", "ws-1", "joined"]);
    expect(queryKeys.joinedChannels("ws-1").slice(0, 2)).toEqual([...queryKeys.channels("ws-1")]);
  });

  it("conversation includes workspace and conversation ids", () => {
    expect(queryKeys.conversation("ws-1", "conv-1")).toEqual(["conversation", "ws-1", "conv-1"]);
  });

  it("messages includes both ids", () => {
    expect(queryKeys.messages("ws-1", "conv-1")).toEqual(["messages", "ws-1", "conv-1"]);
  });

  it("threadByRoot includes all three ids", () => {
    expect(queryKeys.threadByRoot("ws-1", "conv-1", "msg-1")).toEqual([
      "threadByRoot",
      "ws-1",
      "conv-1",
      "msg-1",
    ]);
  });

  it("searchMessages includes query", () => {
    expect(queryKeys.searchMessages("ws-1", "conv-1", "hello")).toEqual([
      "searchMessages",
      "ws-1",
      "conv-1",
      "hello",
    ]);
  });

  it("plugins returns stable key", () => {
    expect(queryKeys.plugins()).toEqual(["plugins"]);
  });

  it("commands includes surface and workspace", () => {
    expect(queryKeys.commands("PALETTE", "ws-1")).toEqual(["commands", "PALETTE", "ws-1"]);
  });

  it("workspacePresence includes workspaceId", () => {
    expect(queryKeys.workspacePresence("w1")).toEqual(["workspacePresence", "w1"]);
  });

  it("notification keys are scoped by serverId, the inbox also by the unread filter", () => {
    expect(queryKeys.notificationSettings("srv-1")).toEqual(["notificationSettings", "srv-1"]);
    expect(queryKeys.notifications("srv-1")).toEqual(["notifications", "srv-1", false]);
    expect(queryKeys.notifications("srv-1", true)).toEqual(["notifications", "srv-1", true]);
    expect(queryKeys.unreadNotificationCount("srv-1")).toEqual([
      "unreadNotificationCount",
      "srv-1",
    ]);
  });
});

describe("VOLATILE_WORKSPACE_KEY_ROOTS", () => {
  const expectedRoots = [
    "messages",
    "conversations",
    "conversation",
    "channels",
    "threadByRoot",
    "threadMessages",
    "pinnedMessages",
    "searchMessages",
    "lenses",
    "lensMessages",
    "unreadCounts",
    "mutedConversations",
    "workspacePresence",
    "serverMembers",
    "server",
    "serverBans",
    "messageReports",
    "customEmojis",
    "workspaceState",
    "workspaceStateList",
    "pipelines",
    "macros",
    "resolvedKeybinds",
    "notificationSettings",
    "notifications",
    "unreadNotificationCount",
  ];

  it("contains exactly the expected workspace-scoped volatile roots", () => {
    expect([...VOLATILE_WORKSPACE_KEY_ROOTS].sort()).toEqual([...expectedRoots].sort());
  });

  it("excludes account-global/static roots (me, plugins, serverConfig)", () => {
    expect(VOLATILE_WORKSPACE_KEY_ROOTS).not.toContain("me");
    expect(VOLATILE_WORKSPACE_KEY_ROOTS).not.toContain("plugins");
    expect(VOLATILE_WORKSPACE_KEY_ROOTS).not.toContain("serverConfig");
    expect(VOLATILE_WORKSPACE_KEY_ROOTS).not.toContain("healthCheck");
    expect(VOLATILE_WORKSPACE_KEY_ROOTS).not.toContain("myServers");
    expect(VOLATILE_WORKSPACE_KEY_ROOTS).not.toContain("commands");
    expect(VOLATILE_WORKSPACE_KEY_ROOTS).not.toContain("keybinds");
    expect(VOLATILE_WORKSPACE_KEY_ROOTS).not.toContain("listAuditLog");
    expect(VOLATILE_WORKSPACE_KEY_ROOTS).not.toContain("previewInviteToken");
  });
});
