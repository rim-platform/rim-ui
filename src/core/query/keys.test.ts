import { describe, it, expect } from "vitest";
import { queryKeys, VOLATILE_WORKSPACE_KEY_ROOTS, VOLATILE_GLOBAL_KEY_ROOTS } from "./keys";

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

  it("serverMembers includes serverId", () => {
    expect(queryKeys.serverMembers("srv-1")).toEqual(["serverMembers", "srv-1"]);
  });

  it("serverMembers with undefined", () => {
    expect(queryKeys.serverMembers()).toEqual(["serverMembers", undefined]);
  });

  it("conversations includes workspaceId", () => {
    expect(queryKeys.conversations("ws-1")).toEqual(["conversations", "ws-1"]);
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

  it("workspaceFeatures includes serverId", () => {
    expect(queryKeys.workspaceFeatures("srv-1")).toEqual(["workspaceFeatures", "srv-1"]);
  });

  it("workspacePresence includes workspaceId", () => {
    expect(queryKeys.workspacePresence("w1")).toEqual(["workspacePresence", "w1"]);
  });

  it("ingestTokens includes serverId", () => {
    expect(queryKeys.ingestTokens("srv-1")).toEqual(["ingestTokens", "srv-1"]);
  });

  it("onCallSchedules includes serverId", () => {
    expect(queryKeys.onCallSchedules("srv-1")).toEqual(["onCallSchedules", "srv-1"]);
  });

  it("serverOnCall includes serverId", () => {
    expect(queryKeys.serverOnCall("srv-1")).toEqual(["serverOnCall", "srv-1"]);
  });

  it("whoIsOnCall includes scheduleId and normalizes an absent `at` to null", () => {
    expect(queryKeys.whoIsOnCall("sched-1")).toEqual(["whoIsOnCall", "sched-1", null]);
    expect(queryKeys.whoIsOnCall("sched-1", "2026-07-01T00:00:00Z")).toEqual([
      "whoIsOnCall",
      "sched-1",
      "2026-07-01T00:00:00Z",
    ]);
  });

  it("onCallShifts includes scheduleId/from/to", () => {
    expect(
      queryKeys.onCallShifts("sched-1", "2026-07-01T00:00:00Z", "2026-07-15T00:00:00Z"),
    ).toEqual(["onCallShifts", "sched-1", "2026-07-01T00:00:00Z", "2026-07-15T00:00:00Z"]);
  });

  it("escalationPolicies includes serverId", () => {
    expect(queryKeys.escalationPolicies("srv-1")).toEqual(["escalationPolicies", "srv-1"]);
  });
});

describe("VOLATILE_WORKSPACE_KEY_ROOTS", () => {
  const expectedRoots = [
    "messages",
    "conversations",
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
    "workspaceFeatures",
    "customEmojis",
    "workspaceState",
    "workspaceStateList",
    "pipelines",
    "macros",
    "resolvedKeybinds",
    "activeIncident",
    "listIncidents",
    "ingestTokens",
    "onCallSchedules",
    "serverOnCall",
    "escalationPolicies",
  ];

  it("contains exactly the expected workspace-scoped volatile roots", () => {
    expect([...VOLATILE_WORKSPACE_KEY_ROOTS].sort()).toEqual([...expectedRoots].sort());
  });

  it("includes ingestTokens (Track B2 reconnect scoping, ahead of the management UI landing)", () => {
    expect(VOLATILE_WORKSPACE_KEY_ROOTS).toContain("ingestTokens");
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

describe("VOLATILE_GLOBAL_KEY_ROOTS", () => {
  it("contains incidentTimeline plus the schedule-keyed (not workspace-keyed) on-call roots", () => {
    // whoIsOnCall/onCallShifts are keyed by scheduleId at position [1], not workspaceId —
    // a `[root, workspaceId]` prefix would never match them, so they live here instead of
    // VOLATILE_WORKSPACE_KEY_ROOTS and get invalidated by root name alone on reconnect.
    expect([...VOLATILE_GLOBAL_KEY_ROOTS].sort()).toEqual(
      ["incidentTimeline", "whoIsOnCall", "onCallShifts"].sort(),
    );
  });
});
