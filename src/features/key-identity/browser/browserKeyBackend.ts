/**
 * The web app's key backend: a linked device whose key is a non-extractable WebCrypto Ed25519
 * key kept in IndexedDB. It signs login proofs and becomes a new device through a pasted link
 * code; it never holds an identity key.
 *
 * A link in progress lives only in this page's memory (the link secret and the new device key),
 * so a reload abandons it; nothing is stored until the answer's certificate verifies against the
 * account's key log.
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
  insert,
  record,
  records,
  removeWhere,
  storedEndpoint,
  update,
  type BrowserKeyRecord,
} from "./keyStore";
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

/** The endpoint resolved against this page, so a relative `/api` reads as the absolute URL. */
function absoluteEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim();
  if (trimmed.includes("://")) return trimmed;
  try {
    return new URL(trimmed, window.location.origin).href;
  } catch {
    return trimmed;
  }
}

/** The `host[:port]` of the endpoint URL as written, lowercased: a login proof's `audience`. */
export function audience(endpoint: string): string {
  const absolute = absoluteEndpoint(endpoint);
  const invalid = () => new Error(`not an absolute server URL: ${endpoint}`);
  const at = absolute.indexOf("://");
  if (at < 0) throw invalid();
  const authority = absolute
    .slice(at + 3)
    .split(/[/?#]/)[0]
    .split("@")
    .pop();
  if (!authority) throw invalid();
  return authority.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/** A device name as certificates allow it: trimmed, 1 to 64 characters, no control characters. */
export function deviceName(name: string): string {
  const kept = Array.from(name.trim())
    .filter((c) => !/\p{Cc}/u.test(c))
    .slice(0, 64)
    .join("")
    .trim();
  if (!kept) throw new Error("give this device a name");
  return kept;
}

/** This browser and system, as the default device name ("Firefox on Linux"). */
export function browserDeviceName(userAgent: string = navigator.userAgent): string {
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /OPR\//.test(userAgent)
      ? "Opera"
      : /Firefox\//.test(userAgent)
        ? "Firefox"
        : /Chrome\//.test(userAgent)
          ? "Chrome"
          : /Safari\//.test(userAgent)
            ? "Safari"
            : "Browser";
  const system = /Windows/.test(userAgent)
    ? "Windows"
    : /Mac OS|Macintosh/.test(userAgent)
      ? "macOS"
      : /Android/.test(userAgent)
        ? "Android"
        : /iPhone|iPad/.test(userAgent)
          ? "iOS"
          : /CrOS/.test(userAgent)
            ? "ChromeOS"
            : /Linux/.test(userAgent)
              ? "Linux"
              : null;
  return system ? `${browser} on ${system}` : `${browser}`;
}

/** A UUID v7: the time in milliseconds, then random bits. */
export function uuidV7(now: number = Date.now()): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let time = now;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = time % 256;
    time = Math.floor(time / 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function localAccount(r: BrowserKeyRecord): LocalKeyAccount {
  return {
    principalId: r.principalId,
    userId: r.userId,
    username: r.username,
    deviceId: r.deviceId,
    deviceName: r.deviceName,
    hasIdentityKey: false,
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
  if (!link) throw new Error("this device link is no longer open on this page; start again");
  return link;
}

/** Ask the browser to keep this origin's storage, so it does not evict the keys under pressure. */
function persistStorage(): void {
  void navigator.storage?.persist?.().catch(() => false);
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
    return signLogin(found.deviceKey, {
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      audience: audience(endpoint),
      principalId,
      deviceId: found.deviceId,
    });
  },

  async settle(account: ServerAccount, principalId) {
    let result: LocalKeyAccount | null = null;
    await update(account.endpoint, (current) => {
      const put: BrowserKeyRecord[] = [];
      const shown = current.find((r) => r.principalId === principalId);
      if (shown) {
        const settled = {
          ...shown,
          confirmed: true,
          userId: account.userId,
          username: account.username,
        };
        put.push(settled);
        result = localAccount(settled);
      }
      // Unconfirmed keys of this account that the server does not show.
      const remove = current
        .filter((r) => r.userId === account.userId && r.principalId !== principalId && !r.confirmed)
        .map((r) => r.principalId);
      return { put, remove };
    });
    return result;
  },

  async forget(principalId) {
    await removeWhere(principalId);
  },

  async forgetUnconfirmed(principalId) {
    await removeWhere(principalId, (r) => !r.confirmed);
  },

  async linkOffer(endpoint, text, name): Promise<SentOffer> {
    const code = parseLinkCode(text);
    const here = storedEndpoint(absoluteEndpoint(endpoint));
    if (storedEndpoint(code.endpoint) !== here) {
      throw new Error(`this code is for another server (${code.endpoint}); this app uses ${here}`);
    }
    const deviceKey = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, [
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
    persistStorage();
    return { principalId: claim.principalId, deviceId: claim.deviceId, deviceName: claim.name };
  },

  async linkEnd(linkId) {
    liveLinks.delete(linkId);
  },
};
