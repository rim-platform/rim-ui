/**
 * The web app's key backend: keys are WebCrypto Ed25519 keys kept in IndexedDB, sealed under
 * the account's data key (`keyStore`). The browser signs in with its device key, becomes a new
 * device through a pasted link code, and can hold the identity: create one for enrollment or
 * key-only signup, keep its recovery kit until the person confirms it, link other devices, revoke
 * them, rotate, publish the profile card, and recover an account with its kit (`identityKeys`,
 * `oldDeviceLink`). It never signs plugin manifests and keeps no identity key backup.
 *
 * A link in progress as the new device lives only in this page's memory (the link secret and
 * the new device key), so a reload abandons it; nothing is stored until the answer's
 * certificate verifies against the account's key log.
 */

import type {
  KeyBackend,
  KeyChallenge,
  LinkedDevice,
  LocalKeyAccount,
  SentOffer,
  ServerAccount,
} from "../api/keyBackend";
import {
  answerCertificate,
  offerPlaintext,
  open,
  parseLinkCode,
  seal,
  fingerprint,
  LinkChannelError,
  type LinkCode,
  type Offer,
  type Sealed,
} from "./channel";
import {
  beginEnrollment,
  beginRecovery,
  beginRotation,
  confirmRecoveryKit,
  discardEnrollment,
  discardRecovery,
  draftingPrincipals,
  forgetUnconfirmed,
  recoveryKit,
  removeDraftKeys,
  restoreDraftKeys,
  settledDrafts,
  signEnrollment,
  signProfileCard,
  signRevocation,
  signSignup,
  syncLog,
} from "./identityKeys";
import {
  insert,
  record,
  records,
  removeWhere,
  signingKey,
  storedEndpoint,
  update,
  type BrowserKeyRecord,
} from "./keyStore";
import { absoluteEndpoint, audience, browserDeviceName, deviceName, uuidV7 } from "./naming";
import {
  endOldLink,
  linkBegin,
  linkConfirm,
  linkPending,
  linkResume,
  linkReviewOffer,
  NO_LINK,
} from "./oldDeviceLink";
import { persistStorage } from "./persistence";
import {
  certificateClaim,
  certifiedDevice,
  publicKeyText,
  replay,
  signLogin,
  StatementError,
  WRITE_VERSION,
  type CertificateClaim,
  type Statement,
} from "./statements";

export { audience, browserDeviceName, deviceName, uuidV7 } from "./naming";

/** A link this page takes part in as the new device. */
interface NewLink {
  endpoint: string;
  code: LinkCode;
  deviceKey: CryptoKeyPair;
  offer: Offer;
  /** The answer's certificate, once opened and found to name this offer's device. */
  certificate?: { statement: Statement; claim: CertificateClaim };
}

/** Links in progress, by link id: their secrets and unsaved device keys. */
const liveLinks = new Map<string, NewLink>();

function localAccount(r: BrowserKeyRecord): LocalKeyAccount {
  return {
    principalId: r.principalId,
    userId: r.userId,
    username: r.username,
    deviceId: r.deviceId,
    deviceName: r.deviceName,
    hasIdentityKey: Boolean(r.identity),
    confirmed: r.confirmed,
  };
}

/** Every refusal of an answer reads the same to the person: the link did not verify. */
function answerRefused(err: unknown): Error {
  if (err instanceof StatementError || err instanceof LinkChannelError) {
    return new Error(
      `the answer from your other device did not verify (${err.message}), so this device was not linked. Start again`,
    );
  }
  return err instanceof Error ? err : new Error(String(err));
}

function liveLink(linkId: string): NewLink {
  const link = liveLinks.get(linkId);
  if (!link) throw new Error(NO_LINK);
  return link;
}

export const browserKeyBackend: KeyBackend = {
  async accounts(endpoint) {
    try {
      return (await records(endpoint)).map(localAccount);
    } catch {
      return [];
    }
  },

  async defaultDeviceName() {
    return deviceName(browserDeviceName());
  },

  async signLogin(endpoint, principalId, challenge: KeyChallenge) {
    const found = await record(endpoint, principalId);
    if (!found) throw new Error("this browser has no keys for that account");
    return signLogin(signingKey(found), {
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      audience: audience(endpoint),
      principalId,
      deviceId: found.deviceId,
    });
  },

  async settle(account: ServerAccount, principalId) {
    let result: LocalKeyAccount | null = null;
    // Read after any draft that got there first: a draft this page holds may be in flight.
    const drafting = draftingPrincipals();
    await update(account.endpoint, (current) => {
      const put: BrowserKeyRecord[] = [];
      const shown = current.find((r) => r.principalId === principalId);
      if (shown) {
        const settled: BrowserKeyRecord = {
          ...shown,
          confirmed: true,
          userId: account.userId,
          username: account.username,
        };
        delete settled.replaced;
        put.push(settled);
        result = localAccount(settled);
      }
      // Unconfirmed keys of this account that the server does not show.
      const remove = current
        .filter(
          (r) =>
            r.userId === account.userId &&
            r.principalId !== principalId &&
            !r.confirmed &&
            !drafting.includes(r.principalId),
        )
        .map((r) => r.principalId);
      return { put, remove };
    });
    if (principalId && result) settledDrafts(principalId);
    return result;
  },

  async forget(principalId) {
    await removeWhere(principalId);
  },

  forgetUnconfirmed,

  persistStorage,

  beginEnrollment,
  signEnrollment,
  signSignup,
  removeDraftKeys,
  restoreDraftKeys,
  discardEnrollment,

  keepsRecoveryKit: true,
  recoveryKit,
  confirmRecoveryKit,

  syncLog,
  signRevocation,
  beginRotation,
  signProfileCard,
  beginRecovery,
  discardRecovery,

  linkBegin,
  linkReviewOffer,
  linkConfirm,
  linkPending,
  linkResume,

  async linkOffer(endpoint, text, name, knownAs): Promise<SentOffer> {
    const code = parseLinkCode(text);
    const here = storedEndpoint(absoluteEndpoint(endpoint));
    const named = storedEndpoint(code.endpoint);
    if (named !== here && (!knownAs || named !== storedEndpoint(absoluteEndpoint(knownAs)))) {
      throw new Error(`this code is for another server (${code.endpoint}); this app uses ${here}`);
    }
    // Extractable so that the key store can seal it at the account's first unlock.
    const deviceKey = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const offer: Offer = {
      deviceId: uuidV7(),
      deviceKey: await publicKeyText(deviceKey.publicKey),
      name: deviceName(name),
      platform: "web",
      statementVersion: WRITE_VERSION,
    };
    const plaintext = offerPlaintext(offer);
    const sent: SentOffer = {
      linkId: code.linkIdText,
      fingerprint: await fingerprint(plaintext),
      offer: await seal(code, "offer", plaintext),
    };
    liveLinks.set(code.linkIdText, { endpoint, code, deviceKey, offer });
    return sent;
  },

  async linkOpenAnswer(linkId, answer: Sealed) {
    const link = liveLink(linkId);
    try {
      const statement = answerCertificate(await open(link.code, "answer", answer));
      const claim = certificateClaim(statement);
      if (claim.deviceId !== link.offer.deviceId || claim.deviceKey !== link.offer.deviceKey) {
        throw new StatementError("the certificate is for another device");
      }
      link.certificate = { statement, claim };
      return { principalId: claim.principalId };
    } catch (err) {
      liveLinks.delete(linkId);
      throw answerRefused(err);
    }
  },

  async linkAccept(linkId, keyLog): Promise<LinkedDevice> {
    const link = liveLink(linkId);
    // Stored or refused, the link is over on this side.
    liveLinks.delete(linkId);
    const { statement, claim } = link.certificate ?? {};
    if (!statement || !claim) throw new Error("the link has no opened answer; start again");
    try {
      const head = await replay(keyLog);
      if (head.principalId !== claim.principalId) {
        throw new StatementError("the server's key log belongs to another account");
      }
      const device = await certifiedDevice(statement, head);
      if (device.deviceId !== link.offer.deviceId || device.deviceKey !== link.offer.deviceKey) {
        throw new StatementError("the certificate is for another device");
      }
    } catch (err) {
      throw answerRefused(err);
    }
    void persistStorage();
    const stored = await insert({
      v: 1,
      endpoint: storedEndpoint(link.endpoint),
      principalId: claim.principalId,
      deviceId: claim.deviceId,
      deviceName: claim.name,
      deviceKey: link.deviceKey.privateKey,
      confirmed: false,
      userId: null,
      username: null,
    });
    if (!stored) {
      throw new Error(
        "this browser already holds keys for that account: sign in with them, or remove them from the sign-in screen first",
      );
    }
    return { principalId: claim.principalId, deviceId: claim.deviceId, deviceName: claim.name };
  },

  async linkEnd(linkId) {
    // A new device's link never has a pending record.
    if (liveLinks.delete(linkId)) return;
    await endOldLink(linkId);
  },
};
