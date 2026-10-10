/**
 * Switching relays without losing anything: history is on the devices, keys on the devices,
 * spaces on their hosts, so a switch only moves who carries the traffic.
 *
 * 1. Sign up on the new relay with the same identity (or sign in, if an earlier attempt did).
 * 2. Publish a card listing both relays, new first, on both.
 * 3. Sign a delegation for the new relay for every workspace this person uses, those the old
 *    relay hosts included, and present them there.
 * 4. Drain the old relay's queue: from here on whatever reaches it also reaches the new one.
 * 5. If the old relay goes away, list the conversations homed in its direct space; each gets a
 *    successor on the new relay once the app runs there.
 * 6. Publish a card with the new relay only, leave the old relay, carry this device's records
 *    (spaces, stream positions, contact names) over to the new account, and point the app at
 *    the new relay.
 *
 * Every step is safe to run again, and the state is saved after each one, so the switch picks
 * up where it stopped after a restart.
 */

import type { Statement } from "../../key-identity/browser/statements";
import type { DelegationFields } from "../crypto/relayCrypto";
import { delegationFields, RENEW_BATCH, type RemoteWorkspace } from "./delegations";
import type { RelaySelf } from "./relaySelf";

/** The steps, in order, as the person sees them. */
export const SWITCH_STEPS = [
  "Create your account on the new relay",
  "List both relays on your profile card",
  "Let the new relay carry your workspaces",
  "Read everything waiting on the old relay",
  "Note conversations to continue on the new relay",
  "Leave the old relay",
] as const;

/** A conversation to continue on the new relay. */
export interface SuccessorTodo {
  spaceId: string;
  conversationId: string;
}

/** A relay switch in progress, saved after every step. */
export interface SwitchState {
  principalId: string;
  oldOrigin: string;
  oldServerId: string;
  oldDirectSpaceId: string;
  newOrigin: string;
  newServerId: string | null;
  newKeyHash: string | null;
  newGraphql: string | null;
  newUserId: string | null;
  username: string;
  oldGoesAway: boolean;
  /** The next step to run, 0 to 6; 6 when done. */
  step: number;
  successors: SuccessorTodo[];
  error: string | null;
}

/** A server checked from its own discovery document. */
export interface CheckedRelay {
  serverId: string;
  keyHash: string;
  endpoints: { graphql: string; websocket: string };
}

/** What a switch needs from the rest of the app; injected so it can be tested alone. */
export interface SwitchDeps {
  /** Fetch the new relay's discovery document directly, verify and pin it. */
  checkNew(origin: string): Promise<CheckedRelay>;
  openNew(serverId: string, endpoints: CheckedRelay["endpoints"]): Promise<void>;
  /** On the new relay: sign up with this identity, or sign in when the account is there. */
  enterNew(serverId: string, username: string): Promise<string>;
  /** A card listing `relays`, one version above the newest published. */
  signCard(relays: string[]): Promise<Statement>;
  publishOld(card: Statement): Promise<void>;
  publishNew(serverId: string, card: Statement): Promise<void>;
  /** Every workspace this person uses: those elsewhere and those the old relay hosts. */
  workspaces(): Promise<RemoteWorkspace[]>;
  signDelegation(fields: DelegationFields): Promise<Statement>;
  renewNew(serverId: string, delegations: Statement[]): Promise<{ status: string }[]>;
  /** Read the old relay's queue to its end through the stream processor. */
  drainOld(): Promise<void>;
  /** The conversations in the old relay's direct space. */
  homedConversations(directSpaceId: string): Promise<string[]>;
  leaveOld(): Promise<void>;
  /** Copy this device's records to the new account and point the app at the new relay. */
  finish(state: SwitchState): Promise<void>;
  save(state: SwitchState): Promise<void>;
  now(): number;
}

/** A switch from the relay at `oldOrigin` to the one at `newOrigin`. */
export function newSwitch(
  fields: Pick<
    SwitchState,
    | "principalId"
    | "oldOrigin"
    | "oldServerId"
    | "oldDirectSpaceId"
    | "newOrigin"
    | "username"
    | "oldGoesAway"
  >,
): SwitchState {
  return {
    ...fields,
    newServerId: null,
    newKeyHash: null,
    newGraphql: null,
    newUserId: null,
    step: 0,
    successors: [],
    error: null,
  };
}

function need<T>(value: T | null, what: string): T {
  if (value === null) throw new Error(`the switch lost ${what}; start it again`);
  return value;
}

/** Whether this run holds a session with the new relay. */
interface Session {
  open: boolean;
}

async function runStep(
  state: SwitchState,
  deps: SwitchDeps,
  session: Session,
): Promise<SwitchState> {
  const relays = (newOnly: boolean) =>
    newOnly ? [state.newOrigin] : [state.newOrigin, state.oldOrigin];
  switch (state.step) {
    case 0: {
      const checked = await deps.checkNew(state.newOrigin);
      if (checked.serverId === state.oldServerId) {
        throw new Error("That is the relay you use now.");
      }
      await deps.openNew(checked.serverId, checked.endpoints);
      const userId = await deps.enterNew(checked.serverId, state.username);
      session.open = true;
      return {
        ...state,
        newServerId: checked.serverId,
        newKeyHash: checked.keyHash,
        newGraphql: checked.endpoints.graphql,
        newUserId: userId,
      };
    }
    case 1: {
      const serverId = await reopen(state, deps, session);
      const card = await deps.signCard(relays(false));
      await deps.publishOld(card);
      await deps.publishNew(serverId, card);
      return state;
    }
    case 2: {
      const serverId = await reopen(state, deps, session);
      const relay: RelaySelf = { serverId, keyHash: need(state.newKeyHash, "the new relay's key") };
      const signed: Statement[] = [];
      for (const space of await deps.workspaces()) {
        signed.push(
          await deps.signDelegation(
            delegationFields(relay, space.host, space.workspaceId, deps.now()),
          ),
        );
      }
      for (let i = 0; i < signed.length; i += RENEW_BATCH) {
        const answers = await deps.renewNew(serverId, signed.slice(i, i + RENEW_BATCH));
        const refused = answers.filter((a) => a.status !== "active");
        if (refused.length > 0) {
          throw new Error(`A workspace's host refused the new relay: ${refused[0].status}`);
        }
      }
      return state;
    }
    case 3:
      await deps.drainOld();
      return state;
    case 4: {
      if (!state.oldGoesAway) return state;
      const ids = await deps.homedConversations(state.oldDirectSpaceId);
      return {
        ...state,
        successors: ids.map((conversationId) => ({
          spaceId: state.oldDirectSpaceId,
          conversationId,
        })),
      };
    }
    case 5: {
      const serverId = await reopen(state, deps, session);
      const card = await deps.signCard(relays(true));
      await deps.publishNew(serverId, card);
      await deps.publishOld(card);
      await deps.leaveOld();
      await deps.finish(state);
      return state;
    }
    default:
      return state;
  }
}

/** After a restart the Tauri side forgot the session with the new relay: sign in again. */
async function reopen(state: SwitchState, deps: SwitchDeps, session: Session): Promise<string> {
  const serverId = need(state.newServerId, "the new relay");
  if (session.open) return serverId;
  const checked = await deps.checkNew(state.newOrigin);
  if (checked.serverId !== serverId) {
    throw new Error("The new relay's address now answers as another server.");
  }
  await deps.openNew(serverId, checked.endpoints);
  await deps.enterNew(serverId, state.username);
  session.open = true;
  return serverId;
}

/**
 * Run the switch from its saved step to the end, saving after each step and reporting
 * progress. A failure is saved with the step it stopped at; running again continues there.
 */
export async function runSwitch(
  start: SwitchState,
  deps: SwitchDeps,
  onProgress: (state: SwitchState) => void = () => undefined,
): Promise<SwitchState> {
  let state: SwitchState = { ...start, error: null };
  const session: Session = { open: false };
  while (state.step < SWITCH_STEPS.length) {
    try {
      const done = await runStep(state, deps, session);
      state = { ...done, step: state.step + 1, error: null };
    } catch (err) {
      state = { ...state, error: err instanceof Error ? err.message : String(err) };
      await deps.save(state);
      onProgress(state);
      return state;
    }
    await deps.save(state);
    onProgress(state);
  }
  return state;
}
