/**
 * The relay switch wired to the app (desktop only: it signs cards with the identity key and
 * holds a session with the new relay on the Tauri side), its saved state, and what is left to
 * do once the app runs on the new relay: successors of conversations homed on the old one.
 *
 * At the new relay the account password signs in, or is registered with the signup there, and
 * the account's data key is wrapped under the unlock key that relay's server share gives.
 */

import { create } from "zustand";

import { graphqlClient } from "../../../core/graphql/client";
import { getGraphqlEndpoint, setRelayEndpoint } from "../../../core/graphql/config";
import { CONFLICT, graphqlErrorCode } from "../../../core/graphql/errors";
import { logger } from "../../../core/logger";
import {
  accountUnlockAfterLogin,
  accountUnlockAfterSignup,
  opaqueLoginFinish,
  opaqueLoginStart,
  opaqueRegistrationFinish,
  opaqueRegistrationStart,
} from "../../auth/api/accountLock";
import {
  keepSignedInArguments,
  passwordLoginFinish,
  passwordLoginStart,
  passwordRegistrationStart,
  WrongPasswordError,
  type GraphqlRequest,
} from "../../auth/api/passwordApi";
import { keyBackend } from "../../key-identity/api/keyBackend";
import {
  fetchMyKeyIdentity,
  keyLogStatements,
  signProfileCard,
  type PasswordEntry,
} from "../../key-identity/api/keyIdentity";
import type { Statement } from "../../key-identity/browser/statements";
import { fetchServerMembers } from "../../workspaces/api/useServerMembers";
import { fetchMyServers } from "../../workspaces/api/useMyServers";
import {
  DIRECT_SPACE_CONVERSATIONS_QUERY,
  KEY_LOGIN_CHALLENGE_MUTATION,
  LEAVE_RELAY_MUTATION,
  LOGIN_WITH_KEY_MUTATION,
  PUBLISH_PROFILE_CARD_MUTATION,
  RENEW_DELEGATIONS_MUTATION,
  SIGNUP_WITH_KEY_MUTATION,
} from "../api/documents";
import { fetchConversationPredecessor, fetchRelayItems } from "../api/relayApi";
import { relayUrlsFor } from "../contacts/knownRelays";
import { startDirectConversation } from "../conversations/startDirect";
import { relayCrypto } from "../crypto/relayCrypto";
import { keyHash, type ServerRegistration } from "../crypto/serverStatements";
import { directRequest } from "../direct/directGraphql";
import { directTransport } from "../direct/directTransport";
import {
  allRecords,
  deleteRecord,
  getRecord,
  putRecord,
  type RelayStore,
  type SpaceRecord,
} from "../state/relayDb";
import { solveProofOfWork } from "../pow/proofOfWork";
import { discoveryRegistrationFull, serverOrigin } from "../state/serverOrigin";
import { pinDiscovery } from "../state/serverPins";
import { accountKey, remoteWorkspaces } from "../state/spaces";
import { useRelayStore } from "../state/useRelayStore";
import { activeProcessor } from "../stream/activeProcessor";
import type { RemoteWorkspace } from "./delegations";
import { runSwitch, type SwitchDeps, type SwitchState } from "./relaySwitch";

const RECORD = "relaySwitch";

interface SwitchRecord {
  account: string;
  name: string;
  state: SwitchState;
}

/** Saved under the principal alone, so the app finds it on either relay. */
function recordAccount(principalId: string): string {
  return `switch|${principalId}`;
}

interface SwitchStore {
  state: SwitchState | null;
  running: boolean;
  set: (state: SwitchState | null) => void;
  setRunning: (running: boolean) => void;
}

export const useRelaySwitchStore = create<SwitchStore>((set) => ({
  state: null,
  running: false,
  set: (state) => set({ state }),
  setRunning: (running) => set({ running }),
}));

/** The saved switch of `principalId`, if one is under way or has things left to do. */
export async function loadSwitch(principalId: string): Promise<SwitchState | null> {
  const found = await getRecord<SwitchRecord>("meta", [recordAccount(principalId), RECORD]);
  useRelaySwitchStore.getState().set(found?.state ?? null);
  return found?.state ?? null;
}

async function saveSwitch(state: SwitchState): Promise<void> {
  useRelaySwitchStore.getState().set(state);
  await putRecord<SwitchRecord>("meta", {
    account: recordAccount(state.principalId),
    name: RECORD,
    state,
  });
}

/** Forget a finished or abandoned switch. */
export async function forgetSwitch(principalId: string): Promise<void> {
  useRelaySwitchStore.getState().set(null);
  await deleteRecord("meta", [recordAccount(principalId), RECORD]);
}

function signedInAccount() {
  const account = useRelayStore.getState().account;
  if (!account?.deviceId) throw new Error("Switching relays needs this device's key.");
  return { ...account, deviceId: account.deviceId };
}

/** Copy this device's records for `from` to the account `to`. */
async function carryOver(from: string, to: string): Promise<void> {
  const stores: RelayStore[] = ["spaces", "streams", "aliases"];
  for (const store of stores) {
    for (const record of await allRecords<{ account: string }>(store)) {
      if (record.account === from) await putRecord(store, { ...record, account: to });
    }
  }
}

/** Whether a desktop command failed with `code`. */
function commandFailed(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === code;
}

/**
 * What a switch needs, wired to this app; exported for its tests. `password` signs in at the
 * new relay, or is registered there with the signup.
 */
export function liveDeps(displayName: string, password: PasswordEntry): SwitchDeps {
  const account = signedInAccount();
  const crypto = relayCrypto();
  const transport = directTransport();
  // How each relay checked in this run takes new accounts, from its verified descriptor, and
  // whether its discovery document says it is full.
  const registrations = new Map<string, ServerRegistration & { full: boolean }>();

  async function challenge(serverId: string): Promise<Statement> {
    const answer = await directRequest<{
      keyLoginChallenge: { challengeId: string; nonce: string };
    }>(serverId, KEY_LOGIN_CHALLENGE_MUTATION);
    return crypto.signLoginForServer(
      account.endpoint,
      serverId,
      account.principalId,
      answer.keyLoginChallenge,
    );
  }

  return {
    async checkNew(origin) {
      const document = await transport.discovery(origin);
      const verified = await crypto.verifyDiscovery(document, origin);
      const pin = await pinDiscovery(document, origin, verified.head.serverId);
      registrations.set(pin.serverId, {
        ...verified.descriptor.registration,
        full: discoveryRegistrationFull(document),
      });
      return {
        serverId: pin.serverId,
        keyHash: await keyHash(pin.keys[pin.keys.length - 1]),
        endpoints: {
          graphql: verified.descriptor.endpoints.graphql,
          websocket: verified.descriptor.endpoints.websocket,
        },
      };
    },
    openNew: (serverId, endpoints) => transport.open(serverId, endpoints),
    async enterNew(serverId, username) {
      const send: GraphqlRequest = (document, variables) =>
        directRequest(serverId, document, variables);
      // The password first, then the device proof: the login answers the ticket the proof
      // needs and the share the data key is wrapped under. A principal with no account there
      // gets an answer no password finishes.
      const login = await opaqueLoginStart(password.password);
      const started = await passwordLoginStart(account.principalId, login.request, send);
      let finalization: string | null = null;
      try {
        finalization = (await opaqueLoginFinish(login.handle, started.response)).finalization;
      } catch (err) {
        if (!commandFailed(err, "WRONG_PASSWORD")) throw err;
        logger.debug("[RIM:relay] no account with this password on the new relay yet");
      }
      if (finalization) {
        const finished = await passwordLoginFinish(started.loginId, finalization, send);
        await accountUnlockAfterLogin(
          login.handle,
          account.principalId,
          finished.serverShare,
          finished.rewraps,
          password.keep,
        );
        const signedIn = await directRequest<{ loginWithKey: { userId: string } }>(
          serverId,
          LOGIN_WITH_KEY_MUTATION,
          {
            proof: await challenge(serverId),
            passwordTicket: finished.ticket,
            ...keepSignedInArguments(password.keep),
          },
        );
        return signedIn.loginWithKey.userId;
      }
      const identity = await fetchMyKeyIdentity();
      const device = identity.devices.find((d) => d.deviceId === account.deviceId);
      if (!device) throw new Error("This device's certificate is not on your account.");
      const keyLog = keyLogStatements(identity);
      // A relay in pow mode takes the signup with a proof-of-work over the log's inception.
      const registration = registrations.get(serverId);
      if (registration?.full) {
        throw new Error("The new relay is full and takes no new accounts. Choose another relay.");
      }
      const proofOfWork =
        registration?.mode === "pow" && registration.powBits !== null && keyLog[0]
          ? await solveProofOfWork({
              serverId,
              inceptionPayload: keyLog[0].payload,
              bits: registration.powBits,
            })
          : undefined;
      const opaque = await opaqueRegistrationStart(password.password);
      let response: string;
      try {
        response = await passwordRegistrationStart(account.principalId, opaque.request, send);
      } catch (err) {
        // The account is there, so the password did not finish its login.
        if (graphqlErrorCode(err) === CONFLICT) throw new WrongPasswordError();
        throw err;
      }
      const { upload } = await opaqueRegistrationFinish(opaque.handle, response);
      const created = await directRequest<{
        signupWithKey: { userId: string; serverShare: string | null };
      }>(serverId, SIGNUP_WITH_KEY_MUTATION, {
        input: {
          username,
          displayName,
          keyLog,
          device: device.certificate,
          proof: await challenge(serverId),
          passwordRegistration: upload,
          ...(proofOfWork && { proofOfWork }),
        },
        ...keepSignedInArguments(password.keep),
      });
      const share = created.signupWithKey.serverShare;
      if (!share) throw new Error("The new relay did not answer the account's server share.");
      await accountUnlockAfterSignup(
        opaque.handle,
        account.principalId,
        share,
        null,
        password.keep,
      );
      return created.signupWithKey.userId;
    },
    async signCard(relays) {
      return signProfileCard(await fetchMyKeyIdentity(), displayName, relays);
    },
    async publishOld(card) {
      await graphqlClient.request(PUBLISH_PROFILE_CARD_MUTATION, { card });
    },
    async publishNew(serverId, card) {
      await directRequest(serverId, PUBLISH_PROFILE_CARD_MUTATION, { card });
    },
    async workspaces() {
      const here = useRelayStore.getState().info?.serverId;
      const hosted: RemoteWorkspace[] = here
        ? (await fetchMyServers()).map((s) => ({ workspaceId: s.id, host: here }))
        : [];
      return [...remoteWorkspaces(), ...hosted];
    },
    signDelegation: (fields) =>
      crypto.signDelegation(account.endpoint, account.principalId, fields),
    async renewNew(serverId, delegations) {
      const answer = await directRequest<{ renewDelegations: { status: string }[] }>(
        serverId,
        RENEW_DELEGATIONS_MUTATION,
        { delegations },
      );
      return answer.renewDelegations;
    },
    async drainOld() {
      const processor = activeProcessor();
      if (!processor) throw new Error("The relay stream is not running.");
      let after = processor.ackedThrough;
      for (;;) {
        const page = await fetchRelayItems(after, 500);
        await processor.catchUpItems(page.items);
        const last = page.items[page.items.length - 1]?.id ?? null;
        if (!page.hasMore || last === null || last === after) break;
        after = last;
      }
      await processor.checkHeld();
    },
    async homedConversations(directSpaceId) {
      const ids: string[] = [];
      let cursor: { lastActivityAt: string; conversationId: string } | null = null;
      for (let page = 0; page < 100; page++) {
        const res: {
          inboxConversations: {
            items: { id: string }[];
            next: { lastActivityAt: string; conversationId: string } | null;
            pageInfo: { hasNext: boolean };
          };
        } = await graphqlClient.request(DIRECT_SPACE_CONVERSATIONS_QUERY, {
          serverId: directSpaceId,
          cursor,
        });
        ids.push(...res.inboxConversations.items.map((c) => c.id));
        cursor = res.inboxConversations.next;
        if (!res.inboxConversations.pageInfo.hasNext || !cursor) break;
      }
      return ids;
    },
    async leaveOld() {
      await graphqlClient.request(LEAVE_RELAY_MUTATION);
    },
    async finish(state) {
      const graphql = state.newGraphql;
      const userId = state.newUserId;
      if (!graphql || !userId) throw new Error("the switch lost the new relay; start it again");
      const from = accountKey();
      const to = `${graphql}|${state.principalId}`;
      if (from) await carryOver(from, to);
      // The old relay's direct space is now a space elsewhere, homed on the old relay.
      await putRecord<SpaceRecord>("spaces", {
        account: to,
        spaceId: state.oldDirectSpaceId,
        hostServerId: state.oldServerId,
        kind: "direct",
      });
      await keyBackend().settle(
        { endpoint: graphql, userId, username: state.username },
        state.principalId,
      );
      setRelayEndpoint(graphql);
    },
    save: saveSwitch,
    now: () => Date.now(),
  };
}

/**
 * Start a switch to the relay at `newOrigin`, from this relay by the origin it is known by.
 *
 * @throws When this server does not run as a relay or its origin cannot be read.
 */
export async function beginSwitch(fields: {
  newOrigin: string;
  username: string;
  oldGoesAway: boolean;
}): Promise<SwitchState> {
  const { info } = useRelayStore.getState();
  const account = signedInAccount();
  if (!info) throw new Error("This server does not run as a relay.");
  return {
    principalId: account.principalId,
    oldOrigin: await serverOrigin(),
    oldServerId: info.serverId,
    oldDirectSpaceId: info.directSpaceId,
    newOrigin: fields.newOrigin.replace(/\/+$/, ""),
    newServerId: null,
    newKeyHash: null,
    newGraphql: null,
    newUserId: null,
    username: fields.username,
    oldGoesAway: fields.oldGoesAway,
    step: 0,
    successors: [],
    error: null,
  };
}

/**
 * Run (or continue) a switch; progress lands in `useRelaySwitchStore`. `password` is the account
 * password, which the new relay checks or registers.
 */
export async function continueSwitch(
  state: SwitchState,
  displayName: string,
  password: PasswordEntry,
): Promise<SwitchState> {
  const store = useRelaySwitchStore.getState();
  store.setRunning(true);
  try {
    return await runSwitch(state, liveDeps(displayName, password), (s) =>
      useRelaySwitchStore.getState().set(s),
    );
  } finally {
    useRelaySwitchStore.getState().setRunning(false);
  }
}

/** Whether the app already runs on the switch's new relay. */
export function onNewRelay(state: SwitchState): boolean {
  return state.newGraphql !== null && getGraphqlEndpoint() === state.newGraphql;
}

/**
 * On the new relay after a finished switch: continue each conversation homed on the old relay
 * here, then forget the switch.
 */
export async function finishOnNewRelay(principalId: string): Promise<void> {
  const state = await loadSwitch(principalId);
  if (!state || state.step < 6 || !onNewRelay(state)) return;
  const left: SwitchState["successors"] = [];
  for (const todo of state.successors) {
    try {
      const old = await fetchConversationPredecessor(todo.spaceId, todo.conversationId);
      const ids = new Set(old.memberIds);
      const members = (await fetchServerMembers(todo.spaceId))
        .filter((m) => ids.has(m.userId) && m.principalId && m.principalId !== principalId)
        .map((m) => ({
          principalId: m.principalId!,
          relayUrls: relayUrlsFor(m.principalId!),
          name: m.displayName || m.username,
        }));
      if (members.length > 0) {
        await startDirectConversation(members, {
          hostServerId: state.oldServerId,
          conversationId: todo.conversationId,
        });
      }
    } catch (err) {
      logger.warn("[RIM:relay] continuing a conversation on the new relay failed:", err);
      left.push(todo);
    }
  }
  if (left.length > 0) await saveSwitch({ ...state, successors: left });
  else await forgetSwitch(principalId);
}
