import type { CommandSensitivity } from "../../../core/graphql/generated/schema-types";
import {
  useConfirmationModalStore,
  type ConfirmationRequest,
} from "../state/confirmationModalStore";
import { executeCommandWithProof } from "../tools/loader";

export interface ConfirmationChallengeData {
  commandId: string;
  toolName: string;
  args: Record<string, unknown>;
  token: string;
  argsHash: string;
  expiresAt: string;
  sensitivity?: CommandSensitivity;
  nlDescription?: string;
  /**
   * Raw backend `Command.description` — the human-facing consequence line
   * for the confirmation modal. Mirrors `nlDescription` through the
   * pipeline; the modal prefers this over `nlDescription` for its subtitle.
   */
  description?: string;
  serverMessage?: string;
}

/**
 * Thrown by `makeBackendToolHandler` (and `executeCommandWithProof` on
 * stale-token retry) when the server returned `CONFIRMATION_REQUIRED`. The
 * agent runtime catches this, surfaces the modal, and re-invokes
 * `executeCommandWithProof` with the user's decision.
 *
 * Carries the full server-issued challenge plus enough context to populate
 * the modal copy (toolName, args, sensitivity).
 */
export class ConfirmationRequiredError extends Error {
  readonly challenge: ConfirmationChallengeData;

  constructor(challenge: ConfirmationChallengeData) {
    super(challenge.serverMessage ?? `Confirmation required for "${challenge.toolName}".`);
    this.name = "ConfirmationRequiredError";
    this.challenge = challenge;
  }
}

export const USER_CANCELLED_MESSAGE = "Action cancelled by user.";

const MAX_STALE_RETRIES = 1;

interface RunOptions {
  sensitivity?: CommandSensitivity;
  nlDescription?: string;
  description?: string;
}

/**
 * Wraps a tool handler invocation with the confirmation-flow primitive. On
 * `ConfirmationRequiredError`, surface the request to
 * `useConfirmationModalStore`, await the user decision, and on approval
 * re-invoke `executeCommandWithProof`. On rejection return a constant
 * cancellation string the agent transcript surfaces verbatim.
 *
 * Stale-token handling: if the second call again returns
 * `CONFIRMATION_REQUIRED` (token expired between issue and approval), a
 * fresh modal is shown once and then the gate gives up. This matches the
 * backend, which issues a new token and allows a single retry.
 */
export async function runWithConfirmation(
  invoke: () => Promise<string>,
  opts: RunOptions = {},
): Promise<string> {
  const modal = useConfirmationModalStore.getState();

  let attempt = 0;
  let pending: ConfirmationChallengeData;

  // Helper: present the modal and wait for the user. Returns proof to use
  // for the re-call, or null if the user rejected.
  async function awaitDecision(
    challenge: ConfirmationChallengeData,
  ): Promise<{ token: string; argsHash: string } | null> {
    const request: ConfirmationRequest = {
      commandId: challenge.commandId,
      toolName: challenge.toolName,
      args: challenge.args,
      token: challenge.token,
      argsHash: challenge.argsHash,
      expiresAt: challenge.expiresAt,
      sensitivity: opts.sensitivity ?? challenge.sensitivity,
      nlDescription: opts.nlDescription ?? challenge.nlDescription,
      description: opts.description ?? challenge.description,
      serverMessage: challenge.serverMessage,
    };
    const decision = await modal.open(request);
    if (!decision.approved) return null;
    return { token: challenge.token, argsHash: challenge.argsHash };
  }

  try {
    return await invoke();
  } catch (err) {
    if (!(err instanceof ConfirmationRequiredError)) throw err;
    pending = err.challenge;
  }

  while (pending) {
    const proof = await awaitDecision(pending);
    if (!proof) return USER_CANCELLED_MESSAGE;

    try {
      return await executeCommandWithProof(
        pending.commandId,
        pending.args,
        pending.toolName,
        proof,
      );
    } catch (err) {
      if (!(err instanceof ConfirmationRequiredError)) throw err;
      attempt += 1;
      if (attempt > MAX_STALE_RETRIES) {
        // Server keeps re-issuing — bail out with the latest challenge's
        // server message so the agent transcript shows why the gate stopped.
        throw err;
      }
      pending = err.challenge;
    }
  }

  // Unreachable — the loop always returns or throws.
  throw new Error("confirmation gate loop terminated without resolution");
}
