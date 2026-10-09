/**
 * Device linking in the desktop app (contract `rim-server/docs/specs/device-linking-v1.md`):
 * a device that holds the identity key shows a code, and a new device that has the code gets
 * its own certified device key and signs in with it.
 *
 * The secret in the code, the new device's key and the identity key stay on the Tauri side
 * (`src-tauri/src/key_identity/device_link.rs`). This module talks to the server, which only
 * carries sealed bytes, and asks the Tauri side to seal, open, check and sign. The webview sees
 * the code text (to show it), the fingerprint, device names and link states.
 */

import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { getGraphqlEndpoint } from "../../../core/graphql/config";
import { graphqlErrorCode, RATE_LIMITED } from "../../../core/graphql/errors";
import {
  DeviceLinkState,
  type DeviceLink,
  type SealedMessage,
  type SealedMessageInput,
  type SignedStatementInput,
  type StartedDeviceLink,
} from "../../../core/graphql/generated/schema-types";
import { logger } from "../../../core/logger";
import { safeInvoke } from "../../../core/tauri/safeInvoke";
import {
  fetchKeyAccount,
  fetchKeyLog,
  fetchMyKeyIdentity,
  forgetDeviceKeys,
  keyCommand,
  logStatements,
  publishProfileCard,
  revokeDevice,
  signInWithDeviceKey,
  type MyKeyIdentity,
} from "./keyIdentity";

// ─── What the Tauri side returns ────────────────────────────────────────────

/** A link this device started as the old device. `code` holds the secret: show it, never log it. */
export interface StartedLink {
  linkId: string;
  code: string;
  expiresAt: string;
  principalId: string;
}

/** The new device's offer, opened and checked, for the person to confirm. */
export interface OfferToConfirm {
  deviceId: string;
  name: string;
  /** `desktop` or `web`; self-reported, a display hint only. */
  platform: string;
  /** `XXXX-XXXX`, also shown on the new device. */
  fingerprint: string;
}

interface LinkAnswer {
  deviceId: string;
  deviceKey: string;
  certificate: SignedStatementInput;
  answer: SealedMessageInput;
}

interface PendingLink {
  linkId: string;
  principalId: string;
  deviceId: string;
  deviceKey: string;
}

interface SentOffer {
  linkId: string;
  fingerprint: string;
  offer: SealedMessageInput;
}

// ─── Server documents ───────────────────────────────────────────────────────

const START_DEVICE_LINK_MUTATION = gql`
  mutation StartDeviceLink {
    startDeviceLink {
      linkId
      expiresAt
    }
  }
`;

const DEVICE_LINK_QUERY = gql`
  query DeviceLink($linkId: String!) {
    deviceLink(linkId: $linkId) {
      state
      expiresAt
      offer {
        nonce
        ciphertext
      }
    }
  }
`;

const DEVICE_LINK_ANSWER_QUERY = gql`
  query DeviceLinkAnswer($linkId: String!) {
    deviceLinkAnswer(linkId: $linkId) {
      nonce
      ciphertext
    }
  }
`;

const SEND_OFFER_MUTATION = gql`
  mutation SendDeviceLinkOffer($linkId: String!, $offer: SealedMessageInput!) {
    sendDeviceLinkOffer(linkId: $linkId, offer: $offer)
  }
`;

const SEND_ANSWER_MUTATION = gql`
  mutation SendDeviceLinkAnswer($linkId: String!, $answer: SealedMessageInput!) {
    sendDeviceLinkAnswer(linkId: $linkId, answer: $answer) {
      state
      expiresAt
    }
  }
`;

const COMPLETE_MUTATION = gql`
  mutation CompleteDeviceLink($linkId: String!) {
    completeDeviceLink(linkId: $linkId)
  }
`;

const CANCEL_MUTATION = gql`
  mutation CancelDeviceLink($linkId: String!) {
    cancelDeviceLink(linkId: $linkId)
  }
`;

const ADD_DEVICE_KEY_MUTATION = gql`
  mutation AddDeviceKey($certificate: SignedStatementInput!) {
    addDeviceKey(certificate: $certificate) {
      deviceId
    }
  }
`;

type LinkStatus = Pick<DeviceLink, "state" | "expiresAt"> & {
  offer: Pick<SealedMessage, "nonce" | "ciphertext"> | null;
};

// ─── Errors ─────────────────────────────────────────────────────────────────

/** What the person reads for each way a link ends early. */
export const DEVICE_LINK_MESSAGES = {
  codeUnusable:
    "This code expired, was cancelled, or another device used it first. Cancel the link on your other device and start again.",
  linkEnded:
    "The link ended on your other device: it was declined, cancelled or expired. Nothing was saved on this computer. Start again.",
  revoked:
    "Your other device removed this device before it signed in, so its keys were removed from this computer. Start again.",
  rateLimited: "Too many link attempts from this network. Wait a few minutes and try again.",
  malformed: "The server refused the link message as malformed. Update the app and start again.",
  noKeyIdentity: "This account has no key identity yet. Set up key sign-in first.",
  notFound: "The server no longer knows this link. Start again.",
  conflict: "The link ended before the answer reached the server. Start again.",
  expired: "The code expired before the link finished. Start again.",
  cancelled: "The link was cancelled.",
  signedOut: "You were signed out. Sign in again and start over.",
  failed: "The link could not be finished. Start again.",
} as const;

export type DeviceLinkFailure = keyof typeof DEVICE_LINK_MESSAGES | "refused" | "aborted";

/** A link that ended before it finished; `message` is ready to show. */
export class DeviceLinkError extends Error {
  constructor(
    readonly reason: DeviceLinkFailure,
    message: string = reason === "refused" || reason === "aborted"
      ? DEVICE_LINK_MESSAGES.failed
      : DEVICE_LINK_MESSAGES[reason],
  ) {
    super(message);
    this.name = "DeviceLinkError";
  }
}

function failure(reason: Exclude<DeviceLinkFailure, "refused" | "aborted">): DeviceLinkError {
  return new DeviceLinkError(reason);
}

/** The failure a server error code stands for in a session call (old device). */
function sessionFailure(err: unknown): DeviceLinkError | null {
  switch (graphqlErrorCode(err)) {
    case RATE_LIMITED:
      return failure("rateLimited");
    case "UNAUTHENTICATED":
      return failure("signedOut");
    case "NOT_FOUND":
      return failure("notFound");
    case "CONFLICT":
      return failure("conflict");
    case "VALIDATION":
      return failure("malformed");
    default:
      return null;
  }
}

function messageOf(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

// ─── Polling ────────────────────────────────────────────────────────────────

/** The spec's cadence: every 2 seconds for the first minute, then every 5 seconds. */
export function pollDelay(elapsedMs: number): number {
  return elapsedMs < 60_000 ? 2_000 : 5_000;
}

/** Past a link's 10 minutes and an answer's 10 more, nothing will come. */
const GIVE_UP_AFTER_MS = 25 * 60_000;

export interface PollOptions {
  /** Aborting stops the flow; a link not yet confirmed is cancelled. */
  signal?: AbortSignal;
  /** Injected in tests. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
}

function sleepFor(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DeviceLinkError("aborted"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DeviceLinkError("aborted"));
      },
      { once: true },
    );
  });
}

/** Call `step` on the spec's cadence until it returns a value. */
async function poll<T>(
  step: () => Promise<T | undefined>,
  { signal, sleep = sleepFor, now = Date.now }: PollOptions,
): Promise<T> {
  const started = now();
  for (;;) {
    if (signal?.aborted) throw new DeviceLinkError("aborted");
    const value = await step();
    if (value !== undefined) return value;
    const elapsed = now() - started;
    if (elapsed > GIVE_UP_AFTER_MS) throw failure("expired");
    await sleep(pollDelay(elapsed), signal);
    if (signal?.aborted) throw new DeviceLinkError("aborted");
  }
}

/** A request that failed without a server error code: the network, not the server, said no. */
function isTransient(err: unknown): boolean {
  return graphqlErrorCode(err) === undefined && !(err instanceof DeviceLinkError);
}

async function cancelOnServer(linkId: string): Promise<boolean | null> {
  try {
    await graphqlClient.request(CANCEL_MUTATION, { linkId });
    return true;
  } catch (err) {
    // Already consumed: the new device finished.
    if (graphqlErrorCode(err) === "CONFLICT") return false;
    logger.warn("[RIM:link] cancelling the device link failed:", err);
    return null;
  }
}

async function endLink(linkId: string): Promise<void> {
  await keyCommand<null>("key_identity_link_end", { linkId }).catch((err: unknown) =>
    logger.warn("[RIM:link] forgetting the device link failed:", err),
  );
}

// ─── New device ─────────────────────────────────────────────────────────────

export interface LinkNewDeviceOptions extends PollOptions {
  /** The offer is on the server: show this fingerprint and ask to confirm it on the other device. */
  onOffered?: (offer: { linkId: string; fingerprint: string }) => void;
}

/** Send the sealed offer, resending the same bytes when only the network failed. */
async function sendOffer(sent: SentOffer): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await graphqlClient.request(SEND_OFFER_MUTATION, {
        linkId: sent.linkId,
        offer: sent.offer,
      });
      return;
    } catch (err) {
      if (isTransient(err) && attempt < 3) continue;
      const code = graphqlErrorCode(err);
      if (code === "UNAUTHENTICATED") throw failure("codeUnusable");
      if (code === RATE_LIMITED) throw failure("rateLimited");
      if (code === "VALIDATION") throw failure("malformed");
      throw new DeviceLinkError("failed", messageOf(err, DEVICE_LINK_MESSAGES.failed));
    }
  }
}

/** Poll `deviceLinkAnswer` until the old device answered. */
function awaitAnswer(linkId: string, options: PollOptions): Promise<SealedMessageInput> {
  return poll(async () => {
    try {
      const { deviceLinkAnswer } = await graphqlClient.request<{
        deviceLinkAnswer: SealedMessage | null;
      }>(DEVICE_LINK_ANSWER_QUERY, { linkId });
      return deviceLinkAnswer
        ? { nonce: deviceLinkAnswer.nonce, ciphertext: deviceLinkAnswer.ciphertext }
        : undefined;
    } catch (err) {
      const code = graphqlErrorCode(err);
      if (code === "UNAUTHENTICATED") throw failure("linkEnded");
      // Network trouble and a busy limiter pass; the link stays answerable for 10 minutes.
      if (code === undefined || code === RATE_LIMITED) return undefined;
      throw new DeviceLinkError("failed", messageOf(err, DEVICE_LINK_MESSAGES.failed));
    }
  }, options);
}

/**
 * Link this computer with a code from another device of the account (new device rules), and
 * sign in with the new device key. Returns the account's user id. `onOffered` gets the
 * fingerprint to show while the person confirms on the other device.
 *
 * Nothing is written to the keyring until the certificate verifies against the account's key
 * log; any failure before then cancels the link and drops the key.
 */
export async function linkNewDevice(
  code: string,
  deviceName: string,
  options: LinkNewDeviceOptions = {},
): Promise<string> {
  let sent: SentOffer;
  try {
    sent = await keyCommand<SentOffer>("key_identity_link_offer", {
      endpoint: getGraphqlEndpoint(),
      code,
      deviceName,
    });
  } catch (err) {
    throw new DeviceLinkError("refused", messageOf(err, DEVICE_LINK_MESSAGES.failed));
  }
  const { linkId } = sent;

  let principalId: string;
  try {
    await sendOffer(sent);
    options.onOffered?.({ linkId, fingerprint: sent.fingerprint });
    const answer = await awaitAnswer(linkId, options);
    ({ principalId } = await keyCommand<{ principalId: string }>("key_identity_link_open_answer", {
      linkId,
      answer,
    }));
    const keyLog = await fetchKeyLog(principalId);
    await keyCommand("key_identity_link_accept", { linkId, keyLog });
  } catch (err) {
    // The link is over: the server forgets it, and so does this side, with the unsaved key.
    // A code already used up answers UNAUTHENTICATED to the cancel as well.
    const unusable =
      err instanceof DeviceLinkError &&
      (err.reason === "codeUnusable" || err.reason === "linkEnded");
    if (!unusable) await cancelOnServer(linkId);
    await endLink(linkId);
    if (err instanceof DeviceLinkError) throw err;
    throw new DeviceLinkError("refused", messageOf(err, DEVICE_LINK_MESSAGES.failed));
  }

  // The keys are stored: from here on a failure keeps them for the next sign-in.
  let userId: string;
  try {
    userId = await signInWithDeviceKey(principalId);
  } catch (err) {
    if (graphqlErrorCode(err) === "FORBIDDEN") {
      await forgetDeviceKeys(principalId).catch(() => undefined);
      throw failure("revoked");
    }
    throw new DeviceLinkError(
      "failed",
      "This device is linked, but signing in failed. Sign in with this device from the sign-in screen.",
    );
  }
  // Tried twice at most: the device works either way, and the other device keeps it because
  // it has signed in.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await graphqlClient.request(COMPLETE_MUTATION, { linkId });
      break;
    } catch (err) {
      logger.warn("[RIM:link] completing the device link failed:", err);
    }
  }
  return userId;
}

// ─── Old device ─────────────────────────────────────────────────────────────

/** Start a link for the signed-in account (old device rule 1). */
export async function startLinkingDevice(identity: MyKeyIdentity): Promise<StartedLink> {
  if (!identity.principalId) throw failure("noKeyIdentity");
  let started: Pick<StartedDeviceLink, "linkId" | "expiresAt">;
  try {
    ({ startDeviceLink: started } = await graphqlClient.request<{
      startDeviceLink: Pick<StartedDeviceLink, "linkId" | "expiresAt">;
    }>(START_DEVICE_LINK_MUTATION));
  } catch (err) {
    if (graphqlErrorCode(err) === "VALIDATION") throw failure("noKeyIdentity");
    throw sessionFailure(err) ?? err;
  }
  try {
    const { code } = await keyCommand<{ linkId: string; code: string }>("key_identity_link_begin", {
      principalId: identity.principalId,
      endpoint: getGraphqlEndpoint(),
      linkId: started.linkId,
    });
    return { ...started, code, principalId: identity.principalId };
  } catch (err) {
    await cancelOnServer(started.linkId);
    throw new DeviceLinkError("refused", messageOf(err, DEVICE_LINK_MESSAGES.failed));
  }
}

async function linkStatus(linkId: string): Promise<LinkStatus> {
  const { deviceLink } = await graphqlClient.request<{ deviceLink: LinkStatus }>(
    DEVICE_LINK_QUERY,
    { linkId },
  );
  return deviceLink;
}

function knownDevices(identity: MyKeyIdentity) {
  return identity.devices.map((d) => ({ deviceId: d.deviceId, publicKey: d.publicKey }));
}

/**
 * Wait for the new device's offer, open it and check it against the account (old device
 * rules 2 and 3). An offer that fails to open or breaks a rule cancels the link. Aborting
 * cancels it too.
 */
export async function waitForOffer(
  link: StartedLink,
  options: PollOptions = {},
): Promise<OfferToConfirm> {
  try {
    const offer = await poll(async () => {
      let status: LinkStatus;
      try {
        status = await linkStatus(link.linkId);
      } catch (err) {
        if (isTransient(err)) return undefined;
        throw sessionFailure(err) ?? err;
      }
      switch (status.state) {
        case DeviceLinkState.OPEN:
          return undefined;
        case DeviceLinkState.OFFERED:
          return status.offer ?? undefined;
        case DeviceLinkState.EXPIRED:
          throw failure("expired");
        default:
          // Cancelled by the other side, or moved on without this device's answer.
          throw failure("cancelled");
      }
    }, options);
    const identity = await fetchMyKeyIdentity();
    try {
      return await keyCommand<OfferToConfirm>("key_identity_link_review_offer", {
        linkId: link.linkId,
        keyLog: logStatements(identity.keyLog),
        devices: knownDevices(identity),
        offer: { nonce: offer.nonce, ciphertext: offer.ciphertext },
      });
    } catch (err) {
      throw new DeviceLinkError("refused", messageOf(err, DEVICE_LINK_MESSAGES.failed));
    }
  } catch (err) {
    // The server answers `true` for a link that already ended, so this is safe either way.
    await cancelOnServer(link.linkId);
    await endLink(link.linkId);
    throw err;
  }
}

/** The person declined the offer, or closed the panel before confirming. */
export async function declineLink(link: StartedLink): Promise<void> {
  await cancelOnServer(link.linkId);
  await endLink(link.linkId);
}

/** How a link that ended after the device was certified was settled (old device rule 7). */
export type EndedLink = "revoked" | "kept" | "absent";

/**
 * A link ended `CANCELLED` or `EXPIRED` after this device certified `deviceId`: revoke the
 * device if it never signed in, so no certified key is left that nobody used, then forget the
 * link. A failure keeps the pending record for the next start-up.
 */
export async function settleEndedLink(linkId: string, deviceId: string): Promise<EndedLink> {
  const identity = await fetchMyKeyIdentity();
  const device = identity.devices.find((d) => d.deviceId === deviceId);
  let outcome: EndedLink = "absent";
  if (device && !device.revokedAt && !device.lastUsedAt) {
    await revokeDevice(identity, deviceId);
    outcome = "revoked";
  } else if (device) {
    outcome = "kept";
  }
  await endLink(linkId);
  return outcome;
}

/** `addDeviceKey`; a `CONFLICT` whose device list already shows this device with this key is a
 * retry after a lost answer, and carries on (old device rule 5). */
async function addDevice(answer: LinkAnswer): Promise<void> {
  try {
    await graphqlClient.request(ADD_DEVICE_KEY_MUTATION, { certificate: answer.certificate });
  } catch (err) {
    if (graphqlErrorCode(err) !== "CONFLICT") throw err;
    const identity = await fetchMyKeyIdentity();
    const added = identity.devices.some(
      (d) => d.deviceId === answer.deviceId && d.publicKey === answer.deviceKey && !d.revokedAt,
    );
    if (!added) throw err;
  }
}

/**
 * Add the certified device, send the answer, republish the profile card and wait for the new
 * device to finish (old device rules 5 to 7). Shared by a live link and one resumed at start-up.
 */
async function deliverAnswer(
  linkId: string,
  answer: LinkAnswer,
  displayName: string,
  options: PollOptions,
): Promise<void> {
  try {
    await addDevice(answer);
  } catch (err) {
    // Refused: nothing was added, so nothing is left to revoke. Unanswered: the record stays.
    if (isTransient(err)) {
      throw new DeviceLinkError("failed", messageOf(err, DEVICE_LINK_MESSAGES.failed));
    }
    await cancelOnServer(linkId);
    await endLink(linkId);
    throw new DeviceLinkError("refused", messageOf(err, DEVICE_LINK_MESSAGES.failed));
  }
  // Cancelled meanwhile: `cancelLink` settles the device.
  if (options.signal?.aborted) throw new DeviceLinkError("aborted");

  try {
    await graphqlClient.request(SEND_ANSWER_MUTATION, { linkId, answer: answer.answer });
  } catch (err) {
    if (isTransient(err)) {
      throw new DeviceLinkError("failed", messageOf(err, DEVICE_LINK_MESSAGES.failed));
    }
    if (!options.signal?.aborted) {
      await settleEndedLink(linkId, answer.deviceId).catch((settleErr: unknown) =>
        logger.warn("[RIM:link] settling the ended link failed:", settleErr),
      );
    }
    throw sessionFailure(err) ?? err;
  }
  if (options.signal?.aborted) throw new DeviceLinkError("aborted");

  // Only after the answer, so a card failure never holds up the new device.
  try {
    await publishProfileCard(await fetchMyKeyIdentity(), displayName);
  } catch (err) {
    logger.warn("[RIM:link] republishing the profile card failed:", err);
  }

  await awaitConsumed(linkId, answer.deviceId, options);
}

/** Poll until the new device completes the link; a link that ends otherwise is settled. */
async function awaitConsumed(linkId: string, deviceId: string, options: PollOptions) {
  const ended = await poll<DeviceLinkState | "NOT_FOUND">(async () => {
    try {
      const { state } = await linkStatus(linkId);
      return state === DeviceLinkState.ANSWERED || state === DeviceLinkState.OFFERED
        ? undefined
        : state;
    } catch (err) {
      if (isTransient(err)) return undefined;
      if (graphqlErrorCode(err) === "NOT_FOUND") return "NOT_FOUND";
      throw sessionFailure(err) ?? err;
    }
  }, options);
  if (ended === DeviceLinkState.CONSUMED) {
    await endLink(linkId);
    return;
  }
  const outcome = await settleEndedLink(linkId, deviceId);
  // The new device signed in before the link ended: it is linked all the same.
  if (outcome === "kept") return;
  throw failure(ended === DeviceLinkState.EXPIRED ? "expired" : "cancelled");
}

/**
 * The person confirmed the offer as `deviceName`: sign the certificate (the pending record is
 * written first), add the device, answer, republish the card, and wait for the new device.
 */
export async function confirmLink(
  link: StartedLink,
  deviceName: string,
  displayName: string,
  options: PollOptions = {},
): Promise<void> {
  const identity = await fetchMyKeyIdentity();
  let answer: LinkAnswer;
  try {
    answer = await keyCommand<LinkAnswer>("key_identity_link_confirm", {
      linkId: link.linkId,
      keyLog: logStatements(identity.keyLog),
      deviceName,
    });
  } catch (err) {
    await declineLink(link);
    throw new DeviceLinkError("refused", messageOf(err, DEVICE_LINK_MESSAGES.failed));
  }
  await deliverAnswer(link.linkId, answer, displayName, options);
}

/**
 * Cancel a link at any point; abort the flow's signal first. `certifiedDeviceId` is the
 * offer's device once the person confirmed it: a device that never signed in is then revoked
 * (rule 7). Returns `true` when the new device had already finished, so it stays linked.
 */
export async function cancelLink(link: StartedLink, certifiedDeviceId?: string): Promise<boolean> {
  const cancelled = await cancelOnServer(link.linkId);
  const deviceId = certifiedDeviceId;
  if (cancelled === false) {
    await endLink(link.linkId);
    return true;
  }
  if (deviceId) {
    const outcome = await settleEndedLink(link.linkId, deviceId).catch((err: unknown) => {
      logger.warn("[RIM:link] settling the cancelled link failed:", err);
      return "absent" as const;
    });
    return outcome === "kept";
  }
  await endLink(link.linkId);
  return false;
}

/**
 * Carry on links an earlier run confirmed and did not finish (old device rule 8): `OFFERED`
 * sends the answer again, adding the device first if needed; `ANSWERED` waits for the new
 * device; anything else settles the link. Runs in the background after sign-in; never throws.
 */
export async function resumePendingDeviceLinks(options: PollOptions = {}): Promise<void> {
  const result = await safeInvoke<PendingLink[]>("key_identity_link_pending", {
    endpoint: getGraphqlEndpoint(),
  });
  if (!result.ok || result.value.length === 0) return;
  let identity: MyKeyIdentity;
  try {
    identity = await fetchMyKeyIdentity();
  } catch (err) {
    logger.warn("[RIM:link] cannot check pending device links:", err);
    return;
  }
  // Another account's links on this server wait for that account's sign-in.
  const mine = result.value.filter((p) => p.principalId === identity.principalId);
  for (const pending of mine) {
    try {
      await resumeLink(pending, options);
    } catch (err) {
      logger.warn("[RIM:link] resuming a pending device link failed:", err);
    }
  }
}

async function resumeLink(pending: PendingLink, options: PollOptions): Promise<void> {
  let state: DeviceLinkState | "NOT_FOUND";
  try {
    ({ state } = await linkStatus(pending.linkId));
  } catch (err) {
    if (graphqlErrorCode(err) !== "NOT_FOUND") throw err;
    state = "NOT_FOUND";
  }
  if (state === DeviceLinkState.OFFERED) {
    const answer = await keyCommand<LinkAnswer>("key_identity_link_resume", {
      linkId: pending.linkId,
    });
    const { displayName } = await fetchKeyAccount();
    await deliverAnswer(pending.linkId, answer, displayName, options);
  } else if (state === DeviceLinkState.ANSWERED) {
    await awaitConsumed(pending.linkId, pending.deviceId, options);
  } else if (state === DeviceLinkState.CONSUMED) {
    await endLink(pending.linkId);
  } else {
    await settleEndedLink(pending.linkId, pending.deviceId);
  }
}
