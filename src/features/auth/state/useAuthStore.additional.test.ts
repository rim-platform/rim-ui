import { describe, it, expect, beforeEach } from "vitest";
import { useAuthStore } from "./useAuthStore";

// The existing useAuthStore.test.ts is already provided;
// this file adds edge-case tests for completeness.

describe("useAuthStore — additional", () => {
  beforeEach(() => {
    useAuthStore.setState({ session: null });
  });

  it("setSession stores the userId", () => {
    useAuthStore.getState().setSession({ userId: "user-123" });
    expect(useAuthStore.getState().session).toEqual({ userId: "user-123" });
  });

  it("clearSession removes session", () => {
    useAuthStore.getState().setSession({ userId: "user-123" });
    useAuthStore.getState().clearSession();
    expect(useAuthStore.getState().session).toBeNull();
  });

  it("clearSession is idempotent when already null", () => {
    useAuthStore.getState().clearSession();
    expect(useAuthStore.getState().session).toBeNull();
  });

  it("setSession overwrites an existing session", () => {
    useAuthStore.getState().setSession({ userId: "old" });
    useAuthStore.getState().setSession({ userId: "new" });
    expect(useAuthStore.getState().session?.userId).toBe("new");
  });
});
