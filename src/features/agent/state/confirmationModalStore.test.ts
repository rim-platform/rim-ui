import { describe, it, expect, beforeEach } from "vitest";

import { useConfirmationModalStore, type ConfirmationRequest } from "./confirmationModalStore";

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
    useConfirmationModalStore.setState({ request: null });
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

  it("reset() clears the request and rejects the pending promise", async () => {
    const promise = useConfirmationModalStore.getState().open(makeRequest());
    useConfirmationModalStore.getState().reset();
    await expect(promise).resolves.toEqual({ approved: false });
    expect(useConfirmationModalStore.getState().request).toBeNull();
  });
});
