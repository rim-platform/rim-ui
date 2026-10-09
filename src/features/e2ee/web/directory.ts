/**
 * Who a group's leaves are, in the web app: the key logs and device lists the runtime fetched
 * (`keyLog`, `principalDevices`) are replayed and checked here with WebCrypto, and the engine
 * checks every leaf against the answers; devices verified before are remembered (`devices`).
 */

import { certifiedDevice, replay } from "../../key-identity/browser/statements";
import type { DeviceRefView, DirectoryInput, VerifyOutcome } from "../api/e2eeCommands";
import { loadState, readdHonoredAt, saveState } from "./groupState";
import type { MlsEngine, MlsModule } from "./mlsModule";
import type { Work } from "./store";

interface DeviceAnswer {
  principalId: string;
  deviceId: string;
  status: "certified" | "revoked";
  deviceKey?: string;
}

interface KnownDevice {
  principalId: string;
  deviceId: string;
  deviceKey: string;
}

interface DeviceRecord {
  endpoint: string;
  principalId: string;
  peerPrincipalId: string;
  deviceId: string;
  deviceKey: string;
}

/** The engine's view of what the runtime fetched: replayed logs and verified certificates. */
export async function answers(input: DirectoryInput) {
  const fetched: string[] = [];
  const invalidLogs: string[] = [];
  const devices: DeviceAnswer[] = [];
  for (const principal of input.principals) {
    fetched.push(principal.principalId);
    let head;
    try {
      head = await replay(principal.keyLog);
    } catch {
      invalidLogs.push(principal.principalId);
      continue;
    }
    if (head.principalId !== principal.principalId) {
      invalidLogs.push(principal.principalId);
      continue;
    }
    for (const device of principal.devices) {
      let card;
      try {
        card = await certifiedDevice(device.certificate, head);
      } catch {
        continue;
      }
      if (card.deviceId !== device.deviceId) continue;
      devices.push(
        device.revokedAt || device.revocation
          ? { principalId: principal.principalId, deviceId: device.deviceId, status: "revoked" }
          : {
              principalId: principal.principalId,
              deviceId: device.deviceId,
              status: "certified",
              deviceKey: card.deviceKey,
            },
      );
    }
  }
  return { members: input.members, fetched, invalidLogs, devices };
}

async function remembered(work: Work): Promise<KnownDevice[]> {
  const records = await work.all<DeviceRecord>("devices");
  return records.map(({ peerPrincipalId, deviceId, deviceKey }) => ({
    principalId: peerPrincipalId,
    deviceId,
    deviceKey,
  }));
}

/**
 * Check every leaf of the conversation's group. Devices of fetched principals that pass are
 * remembered (and those principals' other remembered devices forgotten); failures are kept on
 * the conversation, which stops sending until they are gone.
 */
export async function verify(
  work: Work,
  engine: MlsEngine,
  workspaceId: string,
  conversationId: string,
  input: DirectoryInput,
): Promise<VerifyOutcome> {
  const state = await loadState(work, workspaceId, conversationId);
  if (state.incarnation === 0 || state.removed) {
    state.verifyPending = false;
    state.unverified = [];
    await saveState(work, workspaceId, conversationId, state);
    return { missing: [], unverified: [] };
  }
  const directory = { ...(await answers(input)), remembered: await remembered(work) };
  let outcome: VerifyOutcome & { verified: KnownDevice[] };
  try {
    outcome = JSON.parse(
      engine.verifyLeaves(conversationId, state.incarnation, JSON.stringify(directory)),
    ) as VerifyOutcome & { verified: KnownDevice[] };
  } catch (err) {
    if ((err as Error).name === "E2EE_NO_GROUP") return { missing: [], unverified: [] };
    throw err;
  }
  if (outcome.missing.length > 0) return { missing: outcome.missing, unverified: [] };

  const { endpoint, principalId } = work.account;
  const fetched = new Set(directory.fetched);
  const stale = await work.all<DeviceRecord>("devices", (r) => fetched.has(r.peerPrincipalId));
  for (const record of stale) {
    if (!fetched.has(record.peerPrincipalId)) continue;
    work.delete("devices", [endpoint, principalId, record.peerPrincipalId, record.deviceId]);
  }
  for (const device of outcome.verified) {
    work.put("devices", {
      endpoint,
      principalId,
      peerPrincipalId: device.principalId,
      deviceId: device.deviceId,
      deviceKey: device.deviceKey,
    } satisfies DeviceRecord);
  }
  state.unverified = outcome.unverified;
  state.verifyPending = false;
  if (state.unverified.length === 0) state.misbehaved = null;
  await saveState(work, workspaceId, conversationId, state);
  return { missing: [], unverified: state.unverified };
}

/** A re-add request as `Conversation.mlsGroup.readdRequests` lists it. */
export interface ReaddInput extends DeviceRefView {
  request: { payload: string; signature: string };
}

interface VerifiedReadd {
  principalId: string;
  deviceId: string;
  conversationId: string;
  incarnation: number;
}

/**
 * The re-add requests this browser may act on now: signed by the requesting device's certified
 * key, for this conversation's current incarnation, and not acted on for that device in the
 * last 24 hours.
 */
export async function honorableReadds(
  work: Work,
  mls: MlsModule,
  workspaceId: string,
  conversationId: string,
  requests: ReaddInput[],
  input: DirectoryInput,
): Promise<DeviceRefView[]> {
  const state = await loadState(work, workspaceId, conversationId);
  const { devices } = await answers(input);
  const honorable: DeviceRefView[] = [];
  for (const request of requests) {
    const device = devices.find(
      (d) =>
        d.principalId === request.principalId &&
        d.deviceId.toLowerCase() === request.deviceId.toLowerCase(),
    );
    if (device?.status !== "certified" || !device.deviceKey) continue;
    let verified: VerifiedReadd;
    try {
      verified = JSON.parse(
        mls.verifyReadd(request.request.payload, request.request.signature, device.deviceKey),
      ) as VerifiedReadd;
    } catch {
      continue;
    }
    const namesThis =
      verified.principalId === request.principalId &&
      verified.deviceId === request.deviceId.toLowerCase() &&
      verified.conversationId === conversationId.toLowerCase() &&
      verified.incarnation === state.incarnation;
    const last = await readdHonoredAt(work, workspaceId, conversationId, request.deviceId);
    const now = Math.floor(Date.now() / 1000);
    const lastAt = last === null ? undefined : Math.floor(last / 1000);
    if (namesThis && mls.mayHonorReadd(lastAt, now)) {
      honorable.push({ principalId: request.principalId, deviceId: request.deviceId });
    }
  }
  return honorable;
}
