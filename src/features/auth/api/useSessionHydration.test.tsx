import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { ClientError } from "graphql-request";

import { AddressBlockedError } from "../../../core/graphql/errors";
import type { SessionRecord } from "../../offline/api/offlineSession";
import { useOfflineStore } from "../../offline/state/useOfflineStore";
import { useAuthStore } from "../state/useAuthStore";

const requestMock = vi.fn();
const loadSessionRecordMock = vi.fn<() => Promise<SessionRecord | null>>();
const saveSessionRecordMock = vi.fn<(record: SessionRecord) => Promise<void>>();
const resumeWithDeviceKeyMock = vi.fn<(userId: string) => Promise<string | null>>();
const listDeviceKeyAccountsMock = vi.fn<() => Promise<{ principalId: string; userId: string }[]>>();
const accountUnlockKeptMock = vi.fn<(principal: string) => Promise<unknown>>();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));
vi.mock("../../offline/api/offlineSession", () => ({
  loadSessionRecord: () => loadSessionRecordMock(),
  saveSessionRecord: (record: SessionRecord) => saveSessionRecordMock(record),
}));

const restoreAfterReloadMock = vi.fn<(endpoint: string) => Promise<boolean>>();
vi.mock("../runtime/reloadWindow", () => ({
  restoreAfterReload: (endpoint: string) => restoreAfterReloadMock(endpoint),
}));

vi.mock("../../key-identity/api/keyIdentity", () => ({
  resumeWithDeviceKey: (userId: string) => resumeWithDeviceKeyMock(userId),
  listDeviceKeyAccounts: () => listDeviceKeyAccountsMock(),
}));
vi.mock("./accountLock", () => ({
  accountUnlockKept: (principal: string) => accountUnlockKeptMock(principal),
}));

import { useSessionHydration } from "./useSessionHydration";

const endpoint = "http://localhost:8080/api";
const networkDown = () => new TypeError("Failed to fetch");
const unauthorized = () =>
  new ClientError(
    { status: 401, headers: new Headers(), errors: [{ message: "unauthenticated" }] },
    { query: "query MeSession { me { id } }" },
  );
// What the server sends for a missing or expired cookie: HTTP 200 with a coded error.
const unauthenticated = () =>
  new ClientError(
    {
      status: 200,
      headers: new Headers(),
      errors: [{ message: "unauthenticated", extensions: { code: "UNAUTHENTICATED" } }],
    },
    { query: "query MeSession { me { id } }" },
  );
const internalError = () =>
  new ClientError(
    {
      status: 200,
      headers: new Headers(),
      errors: [{ message: "internal error", extensions: { code: "INTERNAL" } }],
    },
    { query: "query MeSession { me { id } }" },
  );

async function hydrate() {
  const { result } = renderHook(() => useSessionHydration());
  await waitFor(() => expect(result.current.isHydrating).toBe(false));
  return result;
}

describe("useSessionHydration", () => {
  beforeEach(() => {
    requestMock.mockReset();
    loadSessionRecordMock.mockReset().mockResolvedValue(null);
    saveSessionRecordMock.mockReset().mockResolvedValue(undefined);
    resumeWithDeviceKeyMock.mockReset().mockResolvedValue(null);
    restoreAfterReloadMock.mockReset().mockResolvedValue(false);
    listDeviceKeyAccountsMock
      .mockReset()
      .mockResolvedValue([{ principalId: "rimp1_alice", userId: "alice" }]);
    accountUnlockKeptMock.mockReset().mockResolvedValue(null);
    useAuthStore.setState({ session: null, csrfToken: null });
    useOfflineStore.setState({ offline: false });
  });

  it("restores the session the server confirms", async () => {
    requestMock.mockResolvedValue({ me: { id: "alice" } });
    const result = await hydrate();
    expect(result.current.isAuthenticated).toBe(true);
    expect(useAuthStore.getState().session).toEqual({ userId: "alice" });
    expect(useOfflineStore.getState().offline).toBe(false);
  });

  it("brings a reloaded tab's session back before it asks who is signed in", async () => {
    const order: string[] = [];
    restoreAfterReloadMock.mockImplementation(async () => {
      order.push("reload");
      return true;
    });
    requestMock.mockImplementation(async () => {
      order.push("me");
      return { me: { id: "alice" } };
    });
    await hydrate();
    expect(order).toEqual(["reload", "me"]);
    expect(restoreAfterReloadMock).toHaveBeenCalledWith(endpoint);
    expect(useAuthStore.getState().session).toEqual({ userId: "alice" });
  });

  it("puts the recorded CSRF token back before the session the server confirms", async () => {
    loadSessionRecordMock.mockResolvedValue({
      state: "signedIn",
      endpoint,
      userId: "alice",
      csrfToken: "tok-alice",
    });
    requestMock.mockResolvedValue({ me: { id: "alice" } });
    const tokenAtSignIn: (string | null)[] = [];
    const off = useAuthStore.subscribe((s, prev) => {
      if (s.session && !prev.session) tokenAtSignIn.push(s.csrfToken);
    });

    await hydrate();
    off();

    expect(tokenAtSignIn).toEqual(["tok-alice"]);
  });

  it("keeps no token from a record without one, or from another account's record", async () => {
    loadSessionRecordMock.mockResolvedValue({ state: "signedIn", endpoint, userId: "alice" });
    requestMock.mockResolvedValue({ me: { id: "alice" } });
    await hydrate();
    expect(useAuthStore.getState().csrfToken).toBeNull();

    useAuthStore.setState({ session: null });
    loadSessionRecordMock.mockResolvedValue({
      state: "signedIn",
      endpoint,
      userId: "bob",
      csrfToken: "tok-bob",
    });
    await hydrate();
    expect(useAuthStore.getState()).toMatchObject({
      session: { userId: "alice" },
      csrfToken: null,
    });
  });

  it("opens a kept account offline, unlocked with its keep key and with its CSRF token, when the server cannot be reached", async () => {
    loadSessionRecordMock.mockResolvedValue({
      state: "signedIn",
      endpoint,
      userId: "alice",
      csrfToken: "tok-alice",
    });
    requestMock.mockRejectedValue(networkDown());
    accountUnlockKeptMock.mockResolvedValue({ webStoreKey: "k", startedEmpty: false });

    const result = await hydrate();

    expect(accountUnlockKeptMock).toHaveBeenCalledWith("rimp1_alice");
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.needsConnection).toBe(false);
    expect(useAuthStore.getState()).toMatchObject({
      session: { userId: "alice" },
      csrfToken: "tok-alice",
    });
    expect(useOfflineStore.getState().offline).toBe(true);
  });

  it("keeps an account that is not kept on sign-in offline, and signs in once the server answers", async () => {
    loadSessionRecordMock.mockResolvedValue({ state: "signedIn", endpoint, userId: "alice" });
    requestMock.mockRejectedValue(networkDown());

    const result = await hydrate();

    expect(accountUnlockKeptMock).toHaveBeenCalledWith("rimp1_alice");
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.needsConnection).toBe(true);
    expect(useOfflineStore.getState().offline).toBe(false);

    // Still unreachable: it keeps waiting.
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    expect(result.current.needsConnection).toBe(true);

    requestMock.mockResolvedValue({ me: { id: "alice" } });
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    expect(result.current.needsConnection).toBe(false);
    expect(useOfflineStore.getState().offline).toBe(false);
  });

  it("keeps an account without keys on this device on sign-in offline", async () => {
    loadSessionRecordMock.mockResolvedValue({ state: "signedIn", endpoint, userId: "bob" });
    requestMock.mockRejectedValue(networkDown());

    const result = await hydrate();

    expect(accountUnlockKeptMock).not.toHaveBeenCalled();
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.needsConnection).toBe(true);
  });

  it("stays signed out when the server refuses the cookie, whatever the record says", async () => {
    loadSessionRecordMock.mockResolvedValue({ state: "signedIn", endpoint, userId: "alice" });
    requestMock.mockRejectedValue(unauthorized());

    const result = await hydrate();

    expect(result.current.isAuthenticated).toBe(false);
    expect(useOfflineStore.getState().offline).toBe(false);
  });

  it("records the sign-out when the server says the session expired", async () => {
    loadSessionRecordMock.mockResolvedValue({ state: "signedIn", endpoint, userId: "alice" });
    requestMock.mockRejectedValue(unauthenticated());

    const result = await hydrate();

    expect(result.current.isAuthenticated).toBe(false);
    expect(saveSessionRecordMock).toHaveBeenCalledWith({ state: "signedOut", endpoint });
  });

  it("signs in again with this device's key when the server refuses the session", async () => {
    loadSessionRecordMock.mockResolvedValue({ state: "signedIn", endpoint, userId: "alice" });
    requestMock.mockRejectedValue(unauthenticated());
    resumeWithDeviceKeyMock.mockResolvedValue("alice");

    const result = await hydrate();

    expect(resumeWithDeviceKeyMock).toHaveBeenCalledWith("alice");
    expect(result.current.isAuthenticated).toBe(true);
    expect(useAuthStore.getState().session).toEqual({ userId: "alice" });
    expect(saveSessionRecordMock).not.toHaveBeenCalled();
  });

  it("keeps the record when the server fails for another reason", async () => {
    loadSessionRecordMock.mockResolvedValue({ state: "signedIn", endpoint, userId: "alice" });
    requestMock.mockRejectedValue(internalError());

    const result = await hydrate();

    expect(result.current.isAuthenticated).toBe(false);
    expect(useOfflineStore.getState().offline).toBe(false);
    expect(saveSessionRecordMock).not.toHaveBeenCalled();
  });

  it("stays on sign-in, online and with the record kept, when the server blocked the address", async () => {
    loadSessionRecordMock.mockResolvedValue({ state: "signedIn", endpoint, userId: "alice" });
    requestMock.mockRejectedValue(new AddressBlockedError());
    const result = await hydrate();
    expect(result.current.isAuthenticated).toBe(false);
    expect(useOfflineStore.getState().offline).toBe(false);
    expect(saveSessionRecordMock).not.toHaveBeenCalled();
    expect(resumeWithDeviceKeyMock).not.toHaveBeenCalled();
  });

  it("stays signed out offline without a record (never signed in on this device)", async () => {
    requestMock.mockRejectedValue(networkDown());
    const result = await hydrate();
    expect(result.current.isAuthenticated).toBe(false);
    expect(useOfflineStore.getState().offline).toBe(false);
  });

  it("lands on sign-in after an explicit sign-out without asking the server", async () => {
    loadSessionRecordMock.mockResolvedValue({ state: "signedOut", endpoint });
    // The sign-out request never reached the server, so the cookie would still work.
    requestMock.mockResolvedValue({ me: { id: "alice" } });

    const result = await hydrate();

    expect(result.current.isAuthenticated).toBe(false);
    expect(useAuthStore.getState().csrfToken).toBeNull();
    expect(requestMock).not.toHaveBeenCalled();
  });
});
