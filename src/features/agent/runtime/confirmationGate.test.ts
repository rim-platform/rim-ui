import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: vi.fn() },
}));

import { graphqlClient } from "../../../core/graphql/client";
import { useConfirmationModalStore } from "../state/confirmationModalStore";
import {
  ConfirmationRequiredError,
  USER_CANCELLED_MESSAGE,
  runWithConfirmation,
} from "./confirmationGate";

function resetModal(): void {
  useConfirmationModalStore.setState({ request: null });
}

describe("ConfirmationRequiredError", () => {
  it("uses the server message when present, falls back to a generated string", () => {
    const a = new ConfirmationRequiredError({
      commandId: "x",
      toolName: "x",
      args: {},
      token: "t",
      argsHash: "h",
      expiresAt: "now",
      serverMessage: "explicit",
    });
    expect(a.message).toBe("explicit");
    expect(a.name).toBe("ConfirmationRequiredError");

    const b = new ConfirmationRequiredError({
      commandId: "x",
      toolName: "chat.delete",
      args: {},
      token: "t",
      argsHash: "h",
      expiresAt: "now",
    });
    expect(b.message).toContain("chat.delete");
  });
});

describe("runWithConfirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetModal();
  });

  it("returns the inner result verbatim when the handler succeeds with no challenge", async () => {
    const result = await runWithConfirmation(async () => "plain success");
    expect(result).toBe("plain success");
    expect(useConfirmationModalStore.getState().request).toBeNull();
  });

  it("re-throws non-ConfirmationRequiredError errors verbatim", async () => {
    await expect(
      runWithConfirmation(async () => {
        throw new Error("unrelated failure");
      }),
    ).rejects.toThrow("unrelated failure");
    expect(useConfirmationModalStore.getState().request).toBeNull();
  });

  it("on approval, re-calls executeCommand with proof and returns the SUCCESS payload", async () => {
    vi.mocked(graphqlClient.request).mockResolvedValueOnce({
      executeCommand: {
        status: "SUCCESS",
        message: "ok",
        payload: { deleted: true },
      },
    });

    const challenge = {
      commandId: "chat.delete_message",
      toolName: "chat.delete_message",
      args: { id: "m1" },
      token: "tok-1",
      argsHash: "hash-1",
      expiresAt: "2026-04-24T12:00:05Z",
    };

    // Auto-approve as soon as the modal opens.
    const unsubscribe = useConfirmationModalStore.subscribe((state) => {
      if (state.request) useConfirmationModalStore.getState().approve();
    });

    const result = await runWithConfirmation(async () => {
      throw new ConfirmationRequiredError(challenge);
    });

    unsubscribe();

    expect(JSON.parse(result)).toEqual({ deleted: true });
    expect(useConfirmationModalStore.getState().request).toBeNull();

    const variables = vi.mocked(graphqlClient.request).mock.calls[0]![1] as {
      input: Record<string, unknown>;
    };
    expect(variables.input.confirmation).toEqual({
      inBandToken: { token: "tok-1", argsHash: "hash-1" },
    });
  });

  it("on rejection, returns the cancellation message and never re-calls executeCommand", async () => {
    const challenge = {
      commandId: "chat.delete_message",
      toolName: "chat.delete_message",
      args: { id: "m1" },
      token: "tok-1",
      argsHash: "hash-1",
      expiresAt: "2026-04-24T12:00:05Z",
    };

    const unsubscribe = useConfirmationModalStore.subscribe((state) => {
      if (state.request) useConfirmationModalStore.getState().reject();
    });

    const result = await runWithConfirmation(async () => {
      throw new ConfirmationRequiredError(challenge);
    });

    unsubscribe();

    expect(result).toBe(USER_CANCELLED_MESSAGE);
    expect(graphqlClient.request).not.toHaveBeenCalled();
    expect(useConfirmationModalStore.getState().request).toBeNull();
  });

  it("retries once on stale-token re-issue, then succeeds", async () => {
    const initialChallenge = {
      commandId: "chat.delete_message",
      toolName: "chat.delete_message",
      args: { id: "m1" },
      token: "tok-1",
      argsHash: "hash-1",
      expiresAt: "2026-04-24T12:00:05Z",
    };

    vi.mocked(graphqlClient.request)
      .mockResolvedValueOnce({
        // First proof submission: server says token is stale, issues a fresh one
        executeCommand: {
          status: "CONFIRMATION_REQUIRED",
          message: "stale, re-confirm",
          payload: null,
          confirmationRequired: {
            token: "tok-2",
            argsHash: "hash-1",
            expiresAt: "2026-04-24T12:01:00Z",
          },
        },
      })
      .mockResolvedValueOnce({
        // Second proof submission with the fresh token: success
        executeCommand: {
          status: "SUCCESS",
          message: "ok",
          payload: { deleted: true },
        },
      });

    const tokensSeen: string[] = [];
    const unsubscribe = useConfirmationModalStore.subscribe((state) => {
      if (state.request) {
        tokensSeen.push(state.request.token);
        useConfirmationModalStore.getState().approve();
      }
    });

    const result = await runWithConfirmation(async () => {
      throw new ConfirmationRequiredError(initialChallenge);
    });

    unsubscribe();

    expect(JSON.parse(result)).toEqual({ deleted: true });
    expect(tokensSeen).toEqual(["tok-1", "tok-2"]);

    // Second call must use the fresh token.
    const secondVars = vi.mocked(graphqlClient.request).mock.calls[1]![1] as {
      input: Record<string, unknown>;
    };
    expect(secondVars.input.confirmation).toEqual({
      inBandToken: { token: "tok-2", argsHash: "hash-1" },
    });
  });

  it("after exceeding the stale-retry budget, re-throws the latest ConfirmationRequiredError", async () => {
    const initialChallenge = {
      commandId: "chat.delete_message",
      toolName: "chat.delete_message",
      args: { id: "m1" },
      token: "tok-1",
      argsHash: "hash-1",
      expiresAt: "2026-04-24T12:00:05Z",
    };

    // Server keeps re-issuing — both proof submissions return CONFIRMATION_REQUIRED
    vi.mocked(graphqlClient.request)
      .mockResolvedValueOnce({
        executeCommand: {
          status: "CONFIRMATION_REQUIRED",
          message: "stale-1",
          payload: null,
          confirmationRequired: {
            token: "tok-2",
            argsHash: "hash-1",
            expiresAt: "2026-04-24T12:01:00Z",
          },
        },
      })
      .mockResolvedValueOnce({
        executeCommand: {
          status: "CONFIRMATION_REQUIRED",
          message: "stale-2",
          payload: null,
          confirmationRequired: {
            token: "tok-3",
            argsHash: "hash-1",
            expiresAt: "2026-04-24T12:02:00Z",
          },
        },
      });

    const unsubscribe = useConfirmationModalStore.subscribe((state) => {
      if (state.request) useConfirmationModalStore.getState().approve();
    });

    await expect(
      runWithConfirmation(async () => {
        throw new ConfirmationRequiredError(initialChallenge);
      }),
    ).rejects.toMatchObject({
      name: "ConfirmationRequiredError",
      challenge: { token: "tok-3" },
    });

    unsubscribe();
  });

  it("carries `description` from the challenge into the ConfirmationRequest handed to modal.open (C2 §4)", async () => {
    const challenge = {
      commandId: "chat.archive_channel",
      toolName: "chat.archive_channel",
      args: { conversationId: "conv-1" },
      token: "tok-archive",
      argsHash: "hash-archive",
      expiresAt: "2026-04-24T12:00:05Z",
      sensitivity: "MUTATING" as never,
      nlDescription: "Archive the current channel.",
      description:
        "Archive a channel. Members can still read it, but nobody can post until it is unarchived.",
    };

    let capturedDescription: string | undefined;
    const unsubscribe = useConfirmationModalStore.subscribe((state) => {
      if (state.request) {
        capturedDescription = state.request.description;
        useConfirmationModalStore.getState().reject();
      }
    });

    await runWithConfirmation(async () => {
      throw new ConfirmationRequiredError(challenge);
    });

    unsubscribe();

    expect(capturedDescription).toBe(
      "Archive a channel. Members can still read it, but nobody can post until it is unarchived.",
    );
  });

  it("opts.sensitivity overrides the value from the challenge when present", async () => {
    const challenge = {
      commandId: "chat.delete_message",
      toolName: "chat.delete_message",
      args: {},
      token: "tok",
      argsHash: "h",
      expiresAt: "2026-04-24T12:00:05Z",
    };

    let capturedSensitivity: string | undefined;
    const unsubscribe = useConfirmationModalStore.subscribe((state) => {
      if (state.request) {
        capturedSensitivity = state.request.sensitivity as string | undefined;
        useConfirmationModalStore.getState().reject();
      }
    });

    await runWithConfirmation(
      async () => {
        throw new ConfirmationRequiredError(challenge);
      },
      // RESTRICTED is the loudest tier — modal copy should reflect it.
      { sensitivity: "RESTRICTED" as never },
    );

    unsubscribe();

    expect(capturedSensitivity).toBe("RESTRICTED");
  });
});
