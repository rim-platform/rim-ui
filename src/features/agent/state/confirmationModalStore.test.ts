import { describe, it, expect, beforeEach } from "vitest";

import {
  rejectOutsideAgentConfirmation,
  useConfirmationModalStore,
  type ConfirmationRequest,
} from "./confirmationModalStore";

function makeRequest(overrides: Partial<ConfirmationRequest> = {}): ConfirmationRequest {
  return {
    commandId: "chat.delete_message",
    toolName: "chat.delete_message",
    args: { id: "m1" },
    token: "tok-1",
    argsHash: "hash-1",
    expiresAt: "2026-04-24T12:00:05Z",
    ...overrides,
  };
}

describe("useConfirmationModalStore", () => {
  beforeEach(() => {
    useConfirmationModalStore.getState().reset();
  });

  it("open() sets the request and resolves on approve()", async () => {
    const promise = useConfirmationModalStore.getState().open(makeRequest());
    expect(useConfirmationModalStore.getState().request).not.toBeNull();
    useConfirmationModalStore.getState().approve();
    await expect(promise).resolves.toEqual({ approved: true });
    expect(useConfirmationModalStore.getState().request).toBeNull();
  });

  it("open() resolves with approved=false on reject()", async () => {
    const promise = useConfirmationModalStore.getState().open(makeRequest());
    useConfirmationModalStore.getState().reject();
    await expect(promise).resolves.toEqual({ approved: false });
    expect(useConfirmationModalStore.getState().request).toBeNull();
  });

  it("opening a second request while one is pending resolves the first as rejected", async () => {
    const first = useConfirmationModalStore.getState().open(makeRequest({ token: "tok-1" }));
    const second = useConfirmationModalStore.getState().open(makeRequest({ token: "tok-2" }));
    await expect(first).resolves.toEqual({ approved: false });
    expect(useConfirmationModalStore.getState().request?.token).toBe("tok-2");
    useConfirmationModalStore.getState().approve();
    await expect(second).resolves.toEqual({ approved: true });
  });

  describe("openIfFree", () => {
    const OUTSIDE = { outsideAgent: { name: "Claude Code", target: [], text: "hi" } };

    it("opens when nothing is open, and resolves as open() does", async () => {
      const promise = useConfirmationModalStore.getState().openIfFree(makeRequest());
      expect(useConfirmationModalStore.getState().request?.token).toBe("tok-1");
      useConfirmationModalStore.getState().approve();
      await expect(promise).resolves.toEqual({ approved: true });
    });

    it("answers null when one is open, and does not disturb it", async () => {
      const first = useConfirmationModalStore.getState().open(makeRequest({ token: "tok-1" }));
      expect(
        useConfirmationModalStore.getState().openIfFree(makeRequest({ token: "tok-2" })),
      ).toBeNull();
      expect(useConfirmationModalStore.getState().request?.token).toBe("tok-1");
      useConfirmationModalStore.getState().approve();
      await expect(first).resolves.toEqual({ approved: true });
    });

    it("answers null while a decision is still pending with no request set", async () => {
      const first = useConfirmationModalStore.getState().open(makeRequest());
      useConfirmationModalStore.setState({ request: null });
      expect(useConfirmationModalStore.getState().openIfFree(makeRequest())).toBeNull();
      useConfirmationModalStore.getState().reject();
      await expect(first).resolves.toEqual({ approved: false });
    });

    it("is replaced by open(), and ends not approved", async () => {
      const outside = useConfirmationModalStore
        .getState()
        .openIfFree(makeRequest({ token: "tok-1", ...OUTSIDE }));
      const own = useConfirmationModalStore.getState().open(makeRequest({ token: "tok-2" }));
      await expect(outside).resolves.toEqual({ approved: false });
      expect(useConfirmationModalStore.getState().request?.token).toBe("tok-2");
      useConfirmationModalStore.getState().approve();
      await expect(own).resolves.toEqual({ approved: true });
    });
  });

  describe("rejectOutsideAgentConfirmation", () => {
    it("ends a request a program outside RIM made", async () => {
      const promise = useConfirmationModalStore
        .getState()
        .open(makeRequest({ outsideAgent: { name: "Claude Code", target: [] } }));
      rejectOutsideAgentConfirmation();
      await expect(promise).resolves.toEqual({ approved: false });
      expect(useConfirmationModalStore.getState().request).toBeNull();
    });

    it("leaves any other request open", async () => {
      const promise = useConfirmationModalStore.getState().open(makeRequest());
      rejectOutsideAgentConfirmation();
      expect(useConfirmationModalStore.getState().request).not.toBeNull();
      useConfirmationModalStore.getState().approve();
      await expect(promise).resolves.toEqual({ approved: true });
    });
  });

  it("reset() clears the request and rejects the pending promise", async () => {
    const promise = useConfirmationModalStore.getState().open(makeRequest());
    useConfirmationModalStore.getState().reset();
    await expect(promise).resolves.toEqual({ approved: false });
    expect(useConfirmationModalStore.getState().request).toBeNull();
  });
});
