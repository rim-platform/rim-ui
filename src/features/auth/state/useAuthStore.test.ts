import { describe, it, expect, beforeEach } from "vitest";
import { useAuthStore } from "./useAuthStore";

describe("useAuthStore", () => {
  beforeEach(() => {
    useAuthStore.setState({ session: null, sessionEnded: false });
  });

  it("starts with null session", () => {
    expect(useAuthStore.getState().session).toBeNull();
  });

  it("sets a session", () => {
    useAuthStore.getState().setSession({ userId: "user-1" });
    expect(useAuthStore.getState().session).toEqual({ userId: "user-1" });
  });

  it("overwrites an existing session", () => {
    useAuthStore.getState().setSession({ userId: "user-1" });
    useAuthStore.getState().setSession({ userId: "user-2" });
    expect(useAuthStore.getState().session).toEqual({ userId: "user-2" });
  });

  it("clears the session", () => {
    useAuthStore.getState().setSession({ userId: "user-1" });
    useAuthStore.getState().clearSession();
    expect(useAuthStore.getState().session).toBeNull();
  });

  it("marks a session the server ended until the next session starts", () => {
    useAuthStore.getState().setSession({ userId: "user-1" });
    useAuthStore.getState().endSession();
    expect(useAuthStore.getState()).toMatchObject({ session: null, sessionEnded: true });

    useAuthStore.getState().setSession({ userId: "user-1" });
    expect(useAuthStore.getState().sessionEnded).toBe(false);
  });

  it("clearSession is safe when already null", () => {
    useAuthStore.getState().clearSession();
    expect(useAuthStore.getState().session).toBeNull();
  });
});
