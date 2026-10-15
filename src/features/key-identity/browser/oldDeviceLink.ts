/**
 * The browser as the old device of a device link, as the Tauri side's `device_link.rs` has it:
 * it makes the code, opens and checks the new device's offer against the replayed key log,
 * signs the certificate with the identity key, and writes a pending link before `addDeviceKey`
 * so a reload can send the same answer again or revoke a certified device nobody used.
 *
 * The link secret lives only in this page. A pending link keeps the sealed answer, not the
 * secret: resuming only resends what was sealed.
 */

import type { SealedMessageInput } from "../../../core/graphql/generated/schema-types";
import type {
  IssuedCode,
  KnownDevice,
  LinkAnswer,
  OfferToConfirm,
  PendingLink,
} from "../api/keyBackend";
import {
  answerPlaintext,
  fingerprint,
  formatLinkCode,
  generateLinkCode,
  open,
  parseLinkId,
  parseOffer,
  seal,
  type LinkCode,
  type OpenedOffer,
} from "./channel";
import { headOf, heldIdentity, KEY_ERRORS } from "./identityKeys";
import {
  deletePendingLink,
  pendingLinks,
  principalRecords,
  putPendingLink,
  storedEndpoint,
} from "./keyStore";
import { absoluteEndpoint, deviceName } from "./naming";
import { serialized } from "./persistence";
import {
  canonicalKey,
  now,
  signDeviceCertificate,
  usableDeviceKey,
  WRITE_VERSION,
  type Statement,
} from "./statements";

/** Message for a link this page no longer holds. */
export const NO_LINK = "this device link is no longer open on this page; start again";

/** A link this page takes part in as the old device. */
interface OldLink {
  principalId: string;
  /** Absent on a link resumed from its pending record, whose answer is already sealed. */
  code?: LinkCode;
  /** The offer, once opened and checked. */
  offer?: OpenedOffer;
  /** Set once the person confirmed; a retry sends these same bytes. */
  answer?: LinkAnswer;
}

const oldLinks = new Map<string, OldLink>();

function oldLink(linkId: string): OldLink {
  const link = oldLinks.get(linkId);
  if (!link) throw new Error(NO_LINK);
  return link;
}

/** Make the code for a link `startDeviceLink` opened for `principalId`. */
export async function linkBegin(
  principalId: string,
  endpoint: string,
  linkId: string,
): Promise<IssuedCode> {
  parseLinkId(linkId);
  if ((await principalRecords(principalId)).length === 0) throw new Error(KEY_ERRORS.noKeys);
  const code = generateLinkCode(linkId, absoluteEndpoint(endpoint));
  oldLinks.set(linkId, { principalId, code });
  return { linkId, code: formatLinkCode(code) };
}

/** Checks of the offer's fields that do not need the account. */
function checkFields(offer: OpenedOffer): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(offer.deviceId)) {
    throw new Error("the new device sent a malformed device id");
  }
  usableDeviceKey(offer.deviceKey);
  const chars = Array.from(offer.name).length;
  if (offer.name.trim() !== offer.name || chars < 1 || chars > 64 || /\p{Cc}/u.test(offer.name)) {
    throw new Error("the new device's name is not a valid device name");
  }
  if (offer.platform !== "desktop" && offer.platform !== "web") {
    throw new Error("the new device names an unknown platform");
  }
  if (offer.statementVersion < WRITE_VERSION) {
    throw new Error("the new device is too old to be linked; update it");
  }
}

/**
 * Open the offer and check it against the account: `keyLog` and `devices` are
 * `myKeyIdentity`'s. Any error means the link must be cancelled.
 */
export async function linkReviewOffer(
  linkId: string,
  keyLog: Statement[],
  devices: KnownDevice[],
  sealed: SealedMessageInput,
): Promise<OfferToConfirm> {
  const link = oldLink(linkId);
  const head = await headOf(link.principalId, keyLog);
  await serialized(() => heldIdentity(link.principalId, head));
  const someoneElse = () =>
    new Error(
      "someone other than your new device used this code, so the link was cancelled. Start again and keep the code to yourself",
    );
  if (!link.code) throw someoneElse();
  let plaintext: Uint8Array;
  let offer: OpenedOffer;
  try {
    plaintext = await open(link.code, "offer", sealed);
    offer = parseOffer(plaintext);
  } catch {
    throw someoneElse();
  }
  checkFields(offer);

  if (head.identityKeys.includes(offer.deviceKey) || head.recoveryKey === offer.deviceKey) {
    throw new Error("the new device offered one of this account's own keys");
  }
  const sameKey = (d: KnownDevice) => {
    try {
      return canonicalKey(d.publicKey, WRITE_VERSION) === offer.deviceKey;
    } catch {
      return d.publicKey === offer.deviceKey;
    }
  };
  if (devices.some(sameKey)) {
    throw new Error("the new device's key is already used by a device of this account");
  }
  if (devices.some((d) => d.deviceId === offer.deviceId)) {
    throw new Error("the new device's id is already used by a device of this account");
  }
  link.offer = offer;
  return {
    deviceId: offer.deviceId,
    name: offer.name,
    platform: offer.platform,
    fingerprint: await fingerprint(plaintext),
  };
}

/**
 * Sign the confirmed offer's certificate as `name` at the head's `keySeq`, seal the answer and
 * write the pending link. A second confirmation returns the same certificate and bytes.
 */
export async function linkConfirm(
  linkId: string,
  keyLog: Statement[],
  name: string,
): Promise<LinkAnswer> {
  const certifiedName = deviceName(name);
  return serialized(async () => {
    const link = oldLink(linkId);
    if (link.answer) return link.answer;
    const { offer, code } = link;
    if (!offer || !code) throw new Error("there is no offer to confirm yet");
    const head = await headOf(link.principalId, keyLog);
    const { identity } = await heldIdentity(link.principalId, head);
    const certificate = await signDeviceCertificate(identity, {
      principalId: link.principalId,
      deviceId: offer.deviceId,
      deviceKey: offer.deviceKey,
      name: certifiedName,
      keySeq: head.seq,
      issuedAt: now(),
    });
    const answer: LinkAnswer = {
      deviceId: offer.deviceId,
      deviceKey: offer.deviceKey,
      certificate,
      answer: await seal(code, "answer", answerPlaintext(certificate)),
    };
    await putPendingLink({
      v: 1,
      linkId,
      endpoint: storedEndpoint(code.endpoint),
      principalId: link.principalId,
      deviceId: answer.deviceId,
      deviceKey: answer.deviceKey,
      certificate: answer.certificate,
      answer: answer.answer,
    });
    link.answer = answer;
    return answer;
  });
}

/** Pending links on `endpoint` that this page is not running; empty when they cannot be read. */
export async function linkPending(endpoint: string): Promise<PendingLink[]> {
  const here = storedEndpoint(absoluteEndpoint(endpoint));
  try {
    return (await pendingLinks())
      .filter((p) => storedEndpoint(p.endpoint) === here && !oldLinks.has(p.linkId))
      .map((p) => ({
        linkId: p.linkId,
        principalId: p.principalId,
        deviceId: p.deviceId,
        deviceKey: p.deviceKey,
      }));
  } catch {
    return [];
  }
}

/** Load a pending link into this page: its certificate and the answer exactly as sealed. */
export async function linkResume(linkId: string): Promise<LinkAnswer> {
  const live = oldLinks.get(linkId);
  if (live?.answer) return live.answer;
  const pending = (await pendingLinks()).find((p) => p.linkId === linkId);
  if (!pending) throw new Error(NO_LINK);
  const answer: LinkAnswer = {
    deviceId: pending.deviceId,
    deviceKey: pending.deviceKey,
    certificate: pending.certificate,
    answer: pending.answer,
  };
  oldLinks.set(linkId, { principalId: pending.principalId, answer });
  return answer;
}

/** Forget a link this page held as the old device, and its pending record. */
export async function endOldLink(linkId: string): Promise<void> {
  oldLinks.delete(linkId);
  await deletePendingLink(linkId);
}
