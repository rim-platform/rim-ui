import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { ClientError } from "graphql-request";

import type { SessionRecord } from "../../offline/api/offlineSession";
import { useOfflineStore } from "../../offline/state/useOfflineStore";
import { useAuthStore } from "../state/useAuthStore";

const requestMock = vi.fn();
const loadSessionRecordMock = vi.fn<() => Promise<SessionRecord | null>>();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));
vi.mock("../../offline/api/offlineSession", () => ({
  loadSessionRecord: () => loadSessionRecordMock(),
}));

import { useSessionHydration } from "./useSessionHydration";

const endpoint = "http://localhost:8080/api";
const networkDown = () => new TypeError("Failed to fetch");
const unauthorized = () =>
  new ClientError(
    { status: 401, headers: new Headers(), errors: [{ message: "unauthenticated" }] },
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
    useAuthStore.setState({ session: null });
    useOfflineStore.setState({ offline: false });
  });

  it("restores the session the server confirms", async () => {
    requestMock.mockResolvedValue({ me: { id: "alice" } });
    const result = await hydrate();
    expect(result.current.isAuthenticated).toBe(true);
    expect(useAuthStore.getState().session).toEqual({ userId: "alice" });
    expect(useOfflineStore.getState().offline).toBe(false);
  });

  it("opens the recorded account offline when the server cannot be reached", async () => {
    loadSessionRecordMock.mockResolvedValue({ state: "signedIn", endpoint, userId: "alice" });
    requestMock.mockRejectedValue(networkDown());

    const result = await hydrate();

    expect(result.current.isAuthenticated).toBe(true);
    expect(useAuthStore.getState().session).toEqual({ userId: "alice" });
    expect(useOfflineStore.getState().offline).toBe(true);
  });

  it("stays signed out when the server refuses the cookie, whatever the record says", async () => {
    loadSessionRecordMock.mockResolvedValue({ state: "signedIn", endpoint, userId: "alice" });
    requestMock.mockRejectedValue(unauthorized());

    const result = await hydrate();

    expect(result.current.isAuthenticated).toBe(false);
    expect(useOfflineStore.getState().offline).toBe(false);
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
    expect(requestMock).not.toHaveBeenCalled();
  });
});
