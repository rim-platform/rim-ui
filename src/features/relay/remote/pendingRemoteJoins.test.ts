import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useRelayStore } from "../state/useRelayStore";
import {
  addPendingRemoteJoin,
  listPendingRemoteJoins,
  pendingRemoteJoinAt,
  removePendingRemoteJoin,
  usePendingRemoteJoins,
  type PendingRemoteJoin,
} from "./pendingRemoteJoins";

const NOW = Date.UTC(2026, 9, 24);
const DAY = 24 * 60 * 60 * 1000;
const KEY = "rim:remote-join-requests:http://localhost:8080/api|rimp1_me";

function entry(overrides: Partial<PendingRemoteJoin> = {}): PendingRemoteJoin {
  return {
    hostServerId: "rims1_host",
    hostOrigin: "https://host.example",
    workspaceId: "ws-acme",
    workspaceName: "Acme",
    joinRequestId: "jr-1",
    expiresAt: NOW + 30 * DAY,
    ...overrides,
  };
}

function signIn(principalId = "rimp1_me") {
  useRelayStore.setState({
    account: {
      endpoint: "http://localhost:8080/api",
      userId: "u-me",
      principalId,
      deviceId: "d-1",
    },
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  localStorage.clear();
  signIn();
});

afterEach(() => {
  vi.useRealTimers();
  useRelayStore.getState().reset();
  localStorage.clear();
});

describe("pending remote join requests", () => {
  it("keeps a request per account and finds it by host and workspace", () => {
    addPendingRemoteJoin(entry());
    expect(JSON.parse(localStorage.getItem(KEY) ?? "[]")).toEqual([entry()]);
    expect(pendingRemoteJoinAt("rims1_host", "ws-acme")).toEqual(entry());
    expect(pendingRemoteJoinAt("rims1_other", "ws-acme")).toBeNull();
    expect(pendingRemoteJoinAt("rims1_host", "ws-other")).toBeNull();

    signIn("rimp1_someone_else");
    expect(listPendingRemoteJoins()).toEqual([]);
    expect(pendingRemoteJoinAt("rims1_host", "ws-acme")).toBeNull();
  });

  it("replaces an earlier request for the same workspace", () => {
    addPendingRemoteJoin(entry());
    addPendingRemoteJoin(entry({ workspaceId: "ws-beta", joinRequestId: "jr-2" }));
    addPendingRemoteJoin(entry({ joinRequestId: "jr-3" }));
    expect(listPendingRemoteJoins().map((e) => e.joinRequestId)).toEqual(["jr-2", "jr-3"]);
  });

  it("forgets a decided request", () => {
    addPendingRemoteJoin(entry());
    addPendingRemoteJoin(entry({ workspaceId: "ws-beta", joinRequestId: "jr-2" }));
    removePendingRemoteJoin("rims1_host", "ws-acme");
    expect(listPendingRemoteJoins().map((e) => e.joinRequestId)).toEqual(["jr-2"]);
    removePendingRemoteJoin("rims1_host", "ws-beta");
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("drops expired requests when read", () => {
    addPendingRemoteJoin(entry({ expiresAt: NOW + DAY }));
    addPendingRemoteJoin(entry({ workspaceId: "ws-beta", joinRequestId: "jr-2" }));
    vi.setSystemTime(NOW + DAY);
    expect(pendingRemoteJoinAt("rims1_host", "ws-acme")).toBeNull();
    expect(listPendingRemoteJoins().map((e) => e.joinRequestId)).toEqual(["jr-2"]);
    expect(JSON.parse(localStorage.getItem(KEY) ?? "[]")).toHaveLength(1);
  });

  it("reads unreadable storage as no requests", () => {
    localStorage.setItem(KEY, "not json");
    expect(listPendingRemoteJoins()).toEqual([]);
    localStorage.setItem(KEY, JSON.stringify([{ hostServerId: 1 }, entry()]));
    expect(listPendingRemoteJoins()).toEqual([entry()]);
  });

  it("keeps nothing and throws nothing when storage refuses", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => addPendingRemoteJoin(entry())).not.toThrow();
    expect(listPendingRemoteJoins()).toEqual([]);
    expect(pendingRemoteJoinAt("rims1_host", "ws-acme")).toBeNull();
    setItem.mockRestore();
    getItem.mockRestore();
  });

  it("keeps nothing without a signed-in account", () => {
    useRelayStore.getState().reset();
    addPendingRemoteJoin(entry());
    expect(listPendingRemoteJoins()).toEqual([]);
    expect(localStorage.length).toBe(0);
  });

  it("re-renders its readers when a request is kept or forgotten", () => {
    const { result } = renderHook(() => usePendingRemoteJoins());
    expect(result.current).toEqual([]);
    act(() => addPendingRemoteJoin(entry()));
    expect(result.current).toEqual([entry()]);
    act(() => removePendingRemoteJoin("rims1_host", "ws-acme"));
    expect(result.current).toEqual([]);
  });
});
