import {
  CommandSensitivity,
  type ConfirmationChallenge,
} from "../../../core/graphql/generated/schema-types";
import { graphqlErrorCode } from "../../../core/graphql/errors";
import { toast } from "../../../shared/toast";
import { useConfirmationModalStore } from "../../agent/state/confirmationModalStore";
import { deriveConfirmationVerb } from "../../agent/components/ConfirmCommandModal/verbDeriver";

/** Status of a result the server holds until the caller proves a human confirmed it. */
export const CONFIRMATION_REQUIRED = "CONFIRMATION_REQUIRED";

/** Error code of a re-send whose confirmation token expired or was already used. */
export const CONFIRMATION_STALE = "CONFIRMATION_STALE";

/** Toast shown when a confirmation expired before the command ran. */
export const CONFIRMATION_EXPIRED_MESSAGE = "Confirmation expired. Run the command again.";

/** The proof a re-send carries: the challenge's token and arguments hash. */
export interface ConfirmationProof {
  inBandToken: { token: string; argsHash: string };
}

/** The shape shared by `executeCommand` and `executeMacro` results. */
export interface ChallengeableResult {
  status: string;
  message: string;
  confirmationRequired?: ConfirmationChallenge | null;
}

/** What the confirmation dialog shows about the held command. */
export interface ConfirmationSubject {
  /** Command id; the typed verb is derived from it unless `verb` is set. */
  commandId: string;
  /** Dialog title: the command's title. */
  title: string;
  /** Consequence line under the title. */
  description?: string;
  /** Arguments summary shown in the dialog. */
  args?: Record<string, unknown>;
  /** A `RESTRICTED` command must have its verb typed before it can be confirmed. */
  sensitivity?: CommandSensitivity;
  /** Word to type for a `RESTRICTED` command, instead of the one derived from `commandId`. */
  verb?: string;
}

/**
 * How a confirmed run ended. `completed` carries a result that is not `CONFIRMATION_REQUIRED`;
 * `stale` means the confirmation expired and the user was already told; `unconfirmed` means
 * the server held the command but issued no usable challenge.
 */
export type HumanConfirmationOutcome<R> =
  | { kind: "completed"; result: R }
  | { kind: "cancelled" }
  | { kind: "stale" }
  | { kind: "unconfirmed"; message: string };

const SENSITIVITY_RANK: Record<CommandSensitivity, number> = {
  [CommandSensitivity.SAFE]: 0,
  [CommandSensitivity.SENSITIVE]: 1,
  [CommandSensitivity.MUTATING]: 2,
  [CommandSensitivity.RESTRICTED]: 3,
};

/**
 * The strictest sensitivity among `commandIds` that `commands` knows, and the confirmation
 * verb of the first command at that level. Used for runs of several commands (macros, pipes).
 */
export function strictestSensitivity(
  commandIds: readonly string[],
  commands: readonly { id: string; sensitivity?: CommandSensitivity | null }[] | undefined,
): Pick<ConfirmationSubject, "sensitivity" | "verb"> {
  let strictest: { sensitivity: CommandSensitivity; commandId: string } | null = null;
  for (const commandId of commandIds) {
    const sensitivity = commands?.find((c) => c.id === commandId)?.sensitivity;
    if (!sensitivity) continue;
    if (!strictest || SENSITIVITY_RANK[sensitivity] > SENSITIVITY_RANK[strictest.sensitivity]) {
      strictest = { sensitivity, commandId };
    }
  }
  if (!strictest) return {};
  return {
    sensitivity: strictest.sensitivity,
    verb: deriveConfirmationVerb(strictest.commandId),
  };
}

function isExpired(expiresAt: string): boolean {
  const expiry = Date.parse(expiresAt);
  return Number.isFinite(expiry) && Date.now() >= expiry;
}

/**
 * Runs a command a person started. When the server holds it with `CONFIRMATION_REQUIRED`,
 * shows the confirmation dialog and, on confirm, sends it again with the challenge as proof.
 * An expired confirmation is reported with a toast. Errors from `send` other than a stale
 * confirmation propagate.
 */
export async function runWithHumanConfirmation<R extends ChallengeableResult>(
  send: (confirmation?: ConfirmationProof) => Promise<R>,
  subject: ConfirmationSubject,
): Promise<HumanConfirmationOutcome<R>> {
  const first = await send();
  if (first.status !== CONFIRMATION_REQUIRED) return { kind: "completed", result: first };

  const challenge = first.confirmationRequired;
  if (!challenge) {
    return { kind: "unconfirmed", message: first.message || "The command needs confirmation" };
  }

  const decision = await useConfirmationModalStore.getState().open({
    initiator: "user",
    commandId: subject.commandId,
    toolName: subject.title,
    description: subject.description,
    args: subject.args ?? {},
    sensitivity: subject.sensitivity,
    verb: subject.verb,
    token: challenge.token,
    argsHash: challenge.argsHash,
    expiresAt: challenge.expiresAt,
    serverMessage: first.message,
  });
  if (!decision.approved) {
    if (!isExpired(challenge.expiresAt)) return { kind: "cancelled" };
    toast.error(CONFIRMATION_EXPIRED_MESSAGE);
    return { kind: "stale" };
  }

  let confirmed: R;
  try {
    confirmed = await send({
      inBandToken: { token: challenge.token, argsHash: challenge.argsHash },
    });
  } catch (err) {
    if (graphqlErrorCode(err) !== CONFIRMATION_STALE) throw err;
    toast.error(CONFIRMATION_EXPIRED_MESSAGE);
    return { kind: "stale" };
  }
  if (confirmed.status === CONFIRMATION_REQUIRED) {
    return {
      kind: "unconfirmed",
      message: confirmed.message || "The server did not accept the confirmation",
    };
  }
  return { kind: "completed", result: confirmed };
}
