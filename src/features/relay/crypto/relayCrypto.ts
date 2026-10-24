/**
 * The relay's statement work on this platform: on the desktop the Tauri side verifies server
 * statements and signs device requests with the device key it holds; in the web app the same
 * checks run with WebCrypto and the browser's device key signs.
 */

import { isTauri } from "@tauri-apps/api/core";

import { keyCommand } from "../../key-identity/api/keyBackend";
import { record, signingKey } from "../../key-identity/browser/keyStore";
import {
  replay,
  signLogin,
  StatementError,
  verifiedCard,
  type Statement,
} from "../../key-identity/browser/statements";
import type { KeyChallenge } from "../../key-identity/api/keyBackend";
import {
  readHostEvent as readInBrowser,
  readHostResponse,
  readRevocationAck,
  signDelegation as signDelegationInBrowser,
  verifyRevocationAck as verifyAckInBrowser,
  type AckExpectation,
  type DelegationInput,
  type RevocationAck,
  replayServerLog as replayInBrowser,
  sha256Text,
  signDeviceRequest as signInBrowser,
  verifyDiscovery as verifyInBrowser,
  verifyHostEventSignature,
  verifyHostResponse as verifyResponseInBrowser,
  type DeviceRequestInput,
  type HostEvent,
  type ServerHead,
  type ServerDescriptor,
} from "./serverStatements";

/** A discovery document as verified on either platform. */
export interface DiscoveryResult {
  log: Statement[];
  head: ServerHead;
  descriptor: ServerDescriptor;
}

/** What a host response must answer; the body is hashed before it goes to the Tauri side. */
export interface ResponseCheck {
  host: string;
  requestPayload: string;
  status: number;
  body: Uint8Array;
}

/** What a verified profile card says, as both platforms answer it. */
export interface CardView {
  version: number;
  displayName: string;
  relays: string[];
}

/** The fields of a device request that the caller chooses; the key holder adds the device. */
export type DeviceRequestFields = Omit<DeviceRequestInput, "principalId" | "deviceId">;

/** The fields of a delegation that the caller chooses; the key holder adds the device. */
export type DelegationFields = Omit<DelegationInput, "principalId" | "deviceId">;

export interface RelayCrypto {
  verifyDiscovery(document: string, origin: string): Promise<DiscoveryResult>;
  replayServerLog(log: Statement[]): Promise<ServerHead>;
  /** The `keySeq` a host response names, before its key is chosen. */
  responseKeySeq(encoded: string, signature: string): Promise<number>;
  verifyHostResponse(
    encoded: string,
    signature: string,
    hostKey: string,
    expected: ResponseCheck,
  ): Promise<void>;
  /** Read a host event; with `hostKey`, also check its signature. */
  readHostEvent(envelope: Statement, hostKey?: string): Promise<HostEvent>;
  signDeviceRequest(
    endpoint: string,
    principalId: string,
    fields: DeviceRequestFields,
  ): Promise<Statement>;
  /** Verify a person's key log against their id and their card against its head. */
  verifyCard(principalId: string, keyLog: Statement[], card: Statement): Promise<CardView>;
  /** A delegation signed by this device's key for the account on `endpoint`. */
  signDelegation(
    endpoint: string,
    principalId: string,
    fields: DelegationFields,
  ): Promise<Statement>;
  /** A login proof over `challenge` whose audience is the server id `serverId`. */
  signLoginForServer(
    endpoint: string,
    serverId: string,
    principalId: string,
    challenge: KeyChallenge,
  ): Promise<Statement>;
  /** The `keySeq` a revocation acknowledgement names, before its key is chosen. */
  revocationAckKeySeq(ack: Statement): Promise<number>;
  verifyRevocationAck(
    ack: Statement,
    hostKey: string,
    expected: AckExpectation,
  ): Promise<RevocationAck>;
}

/** The desktop: the `relay_*` and `key_identity_sign_device_request` commands. */
export const tauriRelayCrypto: RelayCrypto = {
  verifyDiscovery: (document, origin) =>
    keyCommand<DiscoveryResult>("relay_verify_discovery", { document, origin }),
  replayServerLog: (log) => keyCommand<ServerHead>("relay_replay_server_log", { log }),
  responseKeySeq: (encoded, signature) =>
    keyCommand<number>("relay_host_response_key_seq", { encoded, signature }),
  async verifyHostResponse(encoded, signature, hostKey, expected) {
    await keyCommand<null>("relay_verify_host_response", {
      encoded,
      signature,
      hostKey,
      expected: {
        host: expected.host,
        requestPayload: expected.requestPayload,
        status: expected.status,
        bodySha256: await sha256Text(expected.body),
      },
    });
  },
  async readHostEvent(envelope, hostKey) {
    const event = await keyCommand<HostEvent>("relay_read_host_event", {
      envelope,
      hostKey: hostKey ?? null,
    });
    return { ...event, seq: event.seq ?? null };
  },
  signDeviceRequest: (_endpoint, principalId, fields) =>
    keyCommand<Statement>("key_identity_sign_device_request", { principalId, request: fields }),
  verifyCard: (principalId, keyLog, card) =>
    keyCommand<CardView>("relay_verify_card", { principalId, keyLog, card }),
  signDelegation: (_endpoint, principalId, delegation) =>
    keyCommand<Statement>("key_identity_sign_delegation", { principalId, delegation }),
  signLoginForServer: (_endpoint, serverId, principalId, challenge) =>
    keyCommand<Statement>("key_identity_sign_login_for_server", {
      serverId,
      principalId,
      challenge,
    }),
  revocationAckKeySeq: (ack) => keyCommand<number>("relay_revocation_ack_key_seq", { ack }),
  verifyRevocationAck: (ack, hostKey, expected) =>
    keyCommand<RevocationAck>("relay_verify_revocation_ack", { ack, hostKey, expected }),
};

/** The web app: WebCrypto, and the device key this browser holds for the account. */
export const browserRelayCrypto: RelayCrypto = {
  verifyDiscovery: verifyInBrowser,
  replayServerLog: replayInBrowser,
  responseKeySeq: async (encoded, signature) => readHostResponse(encoded, signature).keySeq,
  verifyHostResponse: (encoded, signature, hostKey, expected) =>
    verifyResponseInBrowser(readHostResponse(encoded, signature), hostKey, expected),
  async readHostEvent(envelope, hostKey) {
    const event = readInBrowser(envelope);
    if (hostKey !== undefined && !(await verifyHostEventSignature(envelope, hostKey))) {
      throw new Error("host event: signature does not verify");
    }
    return event;
  },
  async signDeviceRequest(endpoint, principalId, fields) {
    const found = await record(endpoint, principalId);
    if (!found) throw new Error("this browser has no keys for that account");
    return signInBrowser(signingKey(found), { ...fields, principalId, deviceId: found.deviceId });
  },
  async verifyCard(principalId, keyLog, card) {
    const head = await replay(keyLog);
    if (head.principalId !== principalId) {
      throw new StatementError("the key log belongs to another account");
    }
    const { version, displayName, relays } = await verifiedCard(card, head);
    return { version, displayName, relays };
  },
  async signDelegation(endpoint, principalId, fields) {
    const found = await record(endpoint, principalId);
    if (!found) throw new Error("this browser has no keys for that account");
    return signDelegationInBrowser(signingKey(found), {
      ...fields,
      principalId,
      deviceId: found.deviceId,
    });
  },
  async signLoginForServer(endpoint, serverId, principalId, challenge) {
    if (!/^rims1_[A-Za-z0-9_-]{43}$/.test(serverId)) throw new Error("not a server id");
    const found = await record(endpoint, principalId);
    if (!found) throw new Error("this browser has no keys for that account");
    return signLogin(signingKey(found), {
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      audience: serverId,
      principalId,
      deviceId: found.deviceId,
    });
  },
  revocationAckKeySeq: async (ack) => readRevocationAck(ack).keySeq,
  verifyRevocationAck: verifyAckInBrowser,
};

/** The backend of this platform. */
export function relayCrypto(): RelayCrypto {
  return isTauri() ? tauriRelayCrypto : browserRelayCrypto;
}
