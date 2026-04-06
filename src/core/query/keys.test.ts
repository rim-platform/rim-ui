import { describe, it, expect } from "vitest";
import { queryKeys } from "./keys";

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
      "threadByRoot", "ws-1", "conv-1", "msg-1",
    ]);
  });

  it("searchMessages includes query", () => {
    expect(queryKeys.searchMessages("ws-1", "conv-1", "hello")).toEqual([
      "searchMessages", "ws-1", "conv-1", "hello",
    ]);
  });

  it("plugins returns stable key", () => {
    expect(queryKeys.plugins()).toEqual(["plugins"]);
  });

  it("commands includes surface", () => {
    expect(queryKeys.commands("PALETTE")).toEqual(["commands", "PALETTE"]);
  });
});
