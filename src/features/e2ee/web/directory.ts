/**
 * Who a group's leaves are, in the web app: the key logs and device lists the runtime fetched
 * (`keyLog`, `principalDevices`) are replayed and checked here with WebCrypto, and the engine
 * checks every leaf against the answers; devices verified before are remembered (`devices`).
 *
 * What the server answers is held to what this browser saw before (`peers`): a key log must
 * extend the head pinned for its principal (the first log verified here pins it), and a device
 * once seen revoked stays revoked. A direct message's members are its two pinned principals.
 */

import {
  certifiedDevice,
  replay,
  verifiedRevocation,
  type KeyHead,
} from "../../key-identity/browser/statements";
import type { DeviceRefView, DirectoryInput, VerifyOutcome } from "../api/e2eeCommands";
import { loadPin, loadState, readdHonoredAt, saveState } from "./groupState";
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

/** What this browser keeps about a principal (`peers`). */
interface PeerRecord {
  endpoint: string;
  principalId: string;
  peerPrincipalId: string;
  /** The seq and payload hash of the head of the longest key log verified here. */
  headSeq: number;
  headHash: string;
  /** Device ids seen revoked, lowercase. */
  revoked: string[];
}

function peerKey(work: Work, peerPrincipalId: string): IDBValidKey {
  return [work.account.endpoint, work.account.principalId, peerPrincipalId];
}

/** Whether `head` is the pinned head or a log that extends it. */
function extendsPin(pin: PeerRecord, head: KeyHead): boolean {
  return head.hashes[pin.headSeq] === pin.headHash;
}

/**
 * The engine's view of what the runtime fetched: replayed logs, verified certificates, revoked
 * devices, held to the heads and revocations pinned in `peers`. With `save`, pins that moved and
 * revocations seen are stored. `forked` names the principals whose log does not extend its pin.
 */
export async function answers(
  work: Work,
  input: DirectoryInput,
  { save, dmPrincipals }: { save: boolean; dmPrincipals: string[] | null },
) {
  const fetched: string[] = [];
  const invalidLogs: string[] = [];
  const forked: string[] = [];
  const devices: DeviceAnswer[] = [];
  for (const principal of input.principals) {
    const { principalId } = principal;
    fetched.push(principalId);
    let head: KeyHead;
    try {
      head = await replay(principal.keyLog);
    } catch {
      invalidLogs.push(principalId);
      continue;
    }
    if (head.principalId !== principalId) {
      invalidLogs.push(principalId);
      continue;
    }
    const pinned = await work.get<PeerRecord>("peers", peerKey(work, principalId));
    if (pinned && !extendsPin(pinned, head)) {
      invalidLogs.push(principalId);
      forked.push(principalId);
      continue;
    }
    const revoked = new Set(pinned?.revoked ?? []);
    for (const device of principal.devices) {
      let card;
      try {
        card = await certifiedDevice(device.certificate, head);
      } catch {
        continue;
      }
      if (card.deviceId !== device.deviceId) continue;
      const deviceId = device.deviceId.toLowerCase();
      const signed = device.revocation
        ? await verifiedRevocation(device.revocation, head, device.deviceId, card.deviceKey)
        : null;
      if (device.revokedAt || signed === true) revoked.add(deviceId);
      // An unverifiable revocation still keeps the device out, but is not remembered.
      devices.push(
        revoked.has(deviceId) || signed !== null
          ? { principalId, deviceId: device.deviceId, status: "revoked" }
          : {
              principalId,
              deviceId: device.deviceId,
              status: "certified",
              deviceKey: card.deviceKey,
            },
      );
    }
    const next: PeerRecord = {
      endpoint: work.account.endpoint,
      principalId: work.account.principalId,
      peerPrincipalId: principalId,
      headSeq: head.seq,
      headHash: head.hash,
      revoked: [...revoked].sort(),
    };
    const moved =
      pinned?.headSeq !== next.headSeq ||
      pinned.headHash !== next.headHash ||
      pinned.revoked.join() !== next.revoked.join();
    if (save && moved) work.put("peers", next);
  }
  // Devices remembered as revoked stay revoked whatever the server answers now.
  for (const peer of await work.all<PeerRecord>("peers")) {
    for (const deviceId of peer.revoked) {
      const known = devices.some(
        (d) => d.principalId === peer.peerPrincipalId && d.deviceId.toLowerCase() === deviceId,
      );
      if (!known) devices.push({ principalId: peer.peerPrincipalId, deviceId, status: "revoked" });
    }
  }
  const members = dmPrincipals
    ? input.members.filter((m) => dmPrincipals.includes(m))
    : input.members;
  return { members, fetched, invalidLogs, devices, forked };
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
  const dmPrincipals = (await loadPin(work, workspaceId, conversationId))?.dmPrincipals ?? null;
  const { forked, ...found } = await answers(work, input, { save: true, dmPrincipals });
  const revokedHere = new Set(
    found.devices
      .filter((d) => d.status === "revoked")
      .map((d) => `${d.principalId}\n${d.deviceId.toLowerCase()}`),
  );
  const directory = {
    ...found,
    remembered: (await remembered(work)).filter(
      (d) => !revokedHere.has(`${d.principalId}\n${d.deviceId.toLowerCase()}`),
    ),
  };
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
  state.unverified = outcome.unverified.map((u) =>
    forked.includes(u.principalId) ? { ...u, reason: "keyLogForked" } : u,
  );
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
  const dmPrincipals = (await loadPin(work, workspaceId, conversationId))?.dmPrincipals ?? null;
  const { devices } = await answers(work, input, { save: false, dmPrincipals });
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
