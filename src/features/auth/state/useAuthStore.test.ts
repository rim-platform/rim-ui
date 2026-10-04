import { describe, it, expect, beforeEach } from "vitest";
import { useAuthStore } from "./useAuthStore";

describe("useAuthStore", () => {
  beforeEach(() => {
    useAuthStore.setState({ session: null });
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

  it("clearSession is safe when already null", () => {
    useAuthStore.getState().clearSession();
    expect(useAuthStore.getState().session).toBeNull();
  });
});
