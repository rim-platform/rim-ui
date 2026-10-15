/**
 * The identity in the browser: creating an identity for enrollment and key-only signup, the
 * recovery kit kept until the person confirms they saved it, and the work only the identity key
 * does (device certificates, revocations, profile cards, rotation), plus recovery with a kit.
 *
 * Keys are non-extractable WebCrypto Ed25519 keys. A draft holds a new identity's keys in this
 * page's memory until they are signed for the server; they are written to IndexedDB before the
 * request that uses them is sent, so an account the server takes never ends up without its keys.
 * The recovery key is derived from the kit's secret when it is needed and never stored; the
 * kit's 16 entropy bytes stay in the account's record only until the person confirms the kit.
 */

import type { SignedStatementInput } from "../../../core/graphql/generated/schema-types";
import type {
  CardContent,
  EnrollmentDraft,
  EnrollmentStatements,
  KeyChallenge,
  LogStatus,
  RecoveryKitText,
  RecoveryStatements,
  ServerAccount,
} from "../api/keyBackend";
import {
  principalRecords,
  record,
  storedEndpoint,
  update,
  updatePrincipal,
  type BrowserKeyRecord,
  type StoredKey,
} from "./keyStore";
import { audience, deviceName, uuidV7 } from "./naming";
import { persistStorage, serialized } from "./persistence";
import {
  formatKit,
  generateEntropy,
  parseKit,
  phraseRecoveryKey,
  phraseWords,
} from "./recoveryKit";
import {
  certifiedDevice,
  now,
  principalId as principalIdOf,
  publicKeyText,
  replay,
  signDeviceCertificate,
  signInception,
  signLogin,
  signProfileCard as signCard,
  signRevocation as signRevoke,
  signRotation,
  StatementError,
  type CertifiedDevice,
  type KeyHead,
  type Statement,
} from "./statements";

/** Why a key operation could not run; each reads as the person sees it. */
export const KEY_ERRORS = {
  noKeys: "this browser has no keys for that account",
  noIdentityKey: "this browser does not hold the account's current identity key",
  noDraft: "the enrollment was cancelled or already finished; start again",
  collided: "random keys collided",
} as const;

/** A new identity's keys and first statements, held in this page until it settles. */
interface Draft {
  principalId: string;
  identity: StoredKey;
  device: StoredKey;
  deviceId: string;
  deviceName: string;
  inception: Statement;
  certificate: Statement;
  /** The kit's entropy until the person confirms they saved the kit; `null` after. */
  recoveryEntropy: Uint8Array | null;
}

const drafts = new Map<string, Draft>();

/** A fresh non-extractable Ed25519 key and its tagged public key. */
async function generateKey(): Promise<StoredKey> {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  return { privateKey: pair.privateKey, publicKey: await publicKeyText(pair.publicKey) };
}

function heldDraft(draftId: string): Draft {
  const draft = drafts.get(draftId);
  if (!draft) throw new Error(KEY_ERRORS.noDraft);
  return draft;
}

async function putRecord(next: BrowserKeyRecord): Promise<void> {
  await update(next.endpoint, () => ({ put: [next] }));
}

/** Principals whose drafts this page holds: their keys may be in flight to the server. */
export function draftingPrincipals(): string[] {
  return [...drafts.values()].map((d) => d.principalId);
}

/** The server confirmed `principalId`: its enrollment is finished. */
export function settledDrafts(principalId: string): void {
  for (const [draftId, draft] of drafts) {
    if (draft.principalId === principalId) drafts.delete(draftId);
  }
}

// ─── Enrollment and key-only signup ─────────────────────────────────────────

/** Create the identity, recovery and device keys of a new identity, held as a draft. */
export async function beginEnrollment(name: string): Promise<EnrollmentDraft> {
  const named = deviceName(name);
  const identity = await generateKey();
  const entropy = generateEntropy();
  const recovery = await phraseRecoveryKey(entropy);
  const device = await generateKey();
  if (identity.publicKey === recovery.publicKey || device.publicKey === identity.publicKey) {
    throw new Error(KEY_ERRORS.collided);
  }
  const at = now();
  const inception = await signInception(
    identity.privateKey,
    identity.publicKey,
    recovery.publicKey,
    at,
  );
  const principalId = await principalIdOf(inception.payload);
  const deviceId = uuidV7();
  const certificate = await signDeviceCertificate(identity.privateKey, {
    principalId,
    deviceId,
    deviceKey: device.publicKey,
    name: named,
    keySeq: 0,
    issuedAt: at,
  });
  const draftId = crypto.randomUUID();
  drafts.set(draftId, {
    principalId,
    identity,
    device,
    deviceId,
    deviceName: named,
    inception,
    certificate,
    recoveryEntropy: entropy,
  });
  return {
    draftId,
    principalId,
    inceptionPayload: inception.payload,
    recoveryKit: await formatKit(principalId, entropy),
    recoveryPhrase: await phraseWords(entropy),
  };
}

/**
 * Write a draft's keys for the account on `endpoint`: the identity and device keys, the
 * account, and the kit's entropy while the kit is unconfirmed. Keys the server already
 * confirmed stay confirmed, and a known user id is kept. A failed write throws, so nothing is
 * sent.
 */
async function storeDraft(
  draft: Draft,
  endpoint: string,
  userId: string | null,
  username: string,
): Promise<void> {
  void persistStorage();
  await serialized(() =>
    update(endpoint, (current) => {
      const existing = current.find((r) => r.principalId === draft.principalId);
      const next: BrowserKeyRecord = {
        v: 1,
        endpoint,
        principalId: draft.principalId,
        deviceId: draft.deviceId,
        deviceName: draft.deviceName,
        deviceKey: draft.device.privateKey,
        confirmed: existing?.confirmed ?? false,
        userId: userId ?? existing?.userId ?? null,
        username,
        identity: draft.identity,
        kitConfirmed: draft.recoveryEntropy === null,
        ...(draft.recoveryEntropy && { recoveryEntropy: draft.recoveryEntropy }),
      };
      return { put: [next] };
    }),
  );
}

/** Store a draft's keys, then sign its log, its certificate and a login proof. */
async function signDraft(
  draftId: string,
  endpoint: string,
  userId: string | null,
  username: string,
  challenge: KeyChallenge,
): Promise<EnrollmentStatements> {
  const proofAudience = audience(endpoint);
  const draft = heldDraft(draftId);
  await storeDraft(draft, endpoint, userId, username);
  const proof = await signLogin(draft.device.privateKey, {
    challengeId: challenge.challengeId,
    nonce: challenge.nonce,
    audience: proofAudience,
    principalId: draft.principalId,
    deviceId: draft.deviceId,
  });
  return { keyLog: [draft.inception], device: draft.certificate, proof };
}

/** Store a draft's keys for the signed-in `account` and sign what `enrollIdentityKey` needs. */
export function signEnrollment(
  draftId: string,
  account: ServerAccount,
  challenge: KeyChallenge,
): Promise<EnrollmentStatements> {
  return signDraft(draftId, account.endpoint, account.userId, account.username, challenge);
}

/**
 * Store a draft's keys for a new account `username` and sign what `signupWithKey` needs. The
 * account has no user id until the server answers; settling links the keys to it.
 */
export async function signSignup(
  draftId: string,
  endpoint: string,
  username: string,
  challenge: KeyChallenge,
): Promise<EnrollmentStatements> {
  const name = username.trim();
  if (!name) throw new Error("choose a username");
  return signDraft(draftId, endpoint, null, name, challenge);
}

/** Store a draft's keys again for a signup the server took after a failed attempt removed them. */
export async function restoreDraftKeys(
  draftId: string,
  endpoint: string,
  username: string,
): Promise<void> {
  audience(endpoint);
  await storeDraft(heldDraft(draftId), endpoint, null, username.trim());
}

/**
 * Remove keys of `principalId` the server never confirmed, putting back the confirmed keys an
 * unconfirmed recovery replaced, if any. Confirmed keys stay.
 */
export function forgetUnconfirmed(principalId: string): Promise<void> {
  return serialized(() =>
    updatePrincipal(principalId, (r) => (r.confirmed ? undefined : (r.replaced ?? null))),
  );
}

/** Remove the keys a refused attempt stored, keeping the draft so a retry signs the same keys. */
export async function removeDraftKeys(draftId: string): Promise<void> {
  await forgetUnconfirmed(heldDraft(draftId).principalId);
}

/** Drop a draft the person cancelled or the server refused, with its unconfirmed keys. */
export async function discardEnrollment(draftId: string): Promise<void> {
  const draft = drafts.get(draftId);
  if (!draft) return;
  drafts.delete(draftId);
  draft.recoveryEntropy?.fill(0);
  await forgetUnconfirmed(draft.principalId);
}

// ─── The recovery kit ───────────────────────────────────────────────────────

async function kitText(principalId: string, entropy: Uint8Array): Promise<RecoveryKitText> {
  return {
    principalId,
    recoveryKit: await formatKit(principalId, entropy),
    recoveryPhrase: await phraseWords(entropy),
  };
}

/** The kit of `principalId`'s identity while the person has not confirmed saving it. */
export async function recoveryKit(principalId: string): Promise<RecoveryKitText | null> {
  for (const draft of drafts.values()) {
    if (draft.principalId === principalId && draft.recoveryEntropy) {
      return kitText(principalId, draft.recoveryEntropy);
    }
  }
  const kept = (await principalRecords(principalId)).find(
    (r) => r.recoveryEntropy && r.kitConfirmed !== true,
  );
  return kept?.recoveryEntropy ? kitText(principalId, kept.recoveryEntropy) : null;
}

/** The person saved the kit: its entropy leaves the drafts and the records, and the flag is set. */
export async function confirmRecoveryKit(principalId: string): Promise<void> {
  for (const draft of drafts.values()) {
    if (draft.principalId !== principalId) continue;
    draft.recoveryEntropy?.fill(0);
    draft.recoveryEntropy = null;
  }
  await serialized(() =>
    updatePrincipal(principalId, (r) => {
      if (!r.recoveryEntropy && r.kitConfirmed !== false) return undefined;
      const next: BrowserKeyRecord = { ...r, kitConfirmed: true };
      delete next.recoveryEntropy;
      return next;
    }),
  );
}

// ─── The identity holder ────────────────────────────────────────────────────

/** The server's key log for `principalId`, verified. */
export async function headOf(principalId: string, log: Statement[]): Promise<KeyHead> {
  const head = await replay(log);
  if (head.principalId !== principalId) {
    throw new StatementError("the server's key log belongs to another account");
  }
  return head;
}

function withoutPending(r: BrowserKeyRecord): BrowserKeyRecord {
  const next = { ...r };
  delete next.pendingIdentity;
  return next;
}

/**
 * The identity key of `r` that is the head's, promoting a pending one the head names. A pending
 * key is dropped only once the log reaches the seq its rotation creates with another key; a log
 * that ends before it (a stale copy, or the rotation in flight) leaves it pending.
 */
export function identityAtHead(
  r: BrowserKeyRecord,
  head: KeyHead,
): { record: BrowserKeyRecord; changed: boolean; identity: CryptoKey | null } {
  let next = r;
  let changed = false;
  const pending = r.pendingIdentity;
  if (pending && pending.publicKey === head.identityKey) {
    next = withoutPending({
      ...r,
      identity: { privateKey: pending.privateKey, publicKey: pending.publicKey },
    });
    changed = true;
  } else if (pending && head.seq >= pending.seq) {
    next = withoutPending(r);
    changed = true;
  }
  const identity = next.identity?.publicKey === head.identityKey ? next.identity.privateKey : null;
  return { record: next, changed, identity };
}

/** The record of `principalId` that holds its identity, if one does, else any record of it. */
async function holderRecord(principalId: string): Promise<BrowserKeyRecord> {
  const found = await principalRecords(principalId);
  const held = found.find((r) => r.identity || r.pendingIdentity) ?? found[0];
  if (!held) throw new Error(KEY_ERRORS.noKeys);
  return held;
}

/**
 * The identity key at the log's head, writing back a settled rotation. Run inside
 * `serialized`.
 */
export async function heldIdentity(
  principalId: string,
  head: KeyHead,
): Promise<{ record: BrowserKeyRecord; identity: CryptoKey }> {
  const at = identityAtHead(await holderRecord(principalId), head);
  if (at.changed) await putRecord(at.record);
  if (!at.identity) throw new Error(KEY_ERRORS.noIdentityKey);
  return { record: at.record, identity: at.identity };
}

/** Verify the server's key log, settle a pending rotation, and say whether this browser holds it. */
export async function syncLog(principalId: string, log: Statement[]): Promise<LogStatus> {
  const head = await headOf(principalId, log);
  let holds = false;
  await serialized(() =>
    updatePrincipal(principalId, (r) => {
      const at = identityAtHead(r, head);
      if (at.identity) holds = true;
      return at.changed ? at.record : undefined;
    }),
  );
  return { principalId: head.principalId, seq: head.seq, holdsIdentityKey: holds };
}

/** Revoke `deviceId`: this browser's own device with its device key, others with the identity key. */
export async function signRevocation(
  principalId: string,
  log: Statement[],
  deviceId: string,
): Promise<SignedStatementInput> {
  const head = await headOf(principalId, log);
  return serialized(async () => {
    const own = await holderRecord(principalId);
    if (own.deviceId === deviceId) {
      return signRevoke(own.deviceKey, true, principalId, deviceId, now());
    }
    const { identity } = await heldIdentity(principalId, head);
    return signRevoke(identity, false, principalId, deviceId, now());
  });
}

/**
 * Start an identity rotation: a new identity key, stored as pending with the seq its rotation
 * creates, and the entry the current key signs. A rotation already pending for that seq signs
 * the same key again, so a rotation whose answer was lost never loses the key it put on the
 * server.
 */
export async function beginRotation(
  principalId: string,
  log: Statement[],
): Promise<SignedStatementInput> {
  const head = await headOf(principalId, log);
  return serialized(async () => {
    const { record: held, identity } = await heldIdentity(principalId, head);
    let next = held.pendingIdentity?.seq === head.seq + 1 ? held.pendingIdentity : undefined;
    if (!next) {
      next = { ...(await generateKey()), seq: head.seq + 1 };
      await putRecord({ ...held, pendingIdentity: next });
    }
    return signRotation(head, "identity", identity, next.publicKey, now());
  });
}

/**
 * Sign a profile card at the log's head. A device is listed only if its certificate verifies
 * against the log, so a server cannot add a key of its own to the card.
 */
export async function signProfileCard(
  principalId: string,
  log: Statement[],
  card: CardContent,
): Promise<SignedStatementInput> {
  const head = await headOf(principalId, log);
  const displayName = card.displayName.trim();
  if (!displayName) throw new Error("a profile card needs a name");
  const devices: CertifiedDevice[] = [];
  for (const certificate of card.certificates)
    devices.push(await certifiedDevice(certificate, head));
  return serialized(async () => {
    const { identity } = await heldIdentity(principalId, head);
    return signCard(identity, {
      principalId,
      version: card.version,
      keySeq: head.seq,
      displayName,
      relays: card.relays,
      devices,
      issuedAt: now(),
    });
  });
}

// ─── Recovery ───────────────────────────────────────────────────────────────

function withoutReplaced(r: BrowserKeyRecord): BrowserKeyRecord {
  const next = { ...r };
  delete next.replaced;
  return next;
}

/**
 * Take an account back with its recovery kit: check that the server's log ends at the kit's
 * recovery key, make a new identity key and device key, sign the recovery rotation and the new
 * device's certificate, and store the keys. Keys the server had confirmed for the account are
 * kept aside until it takes the recovery.
 */
export async function beginRecovery(
  endpoint: string,
  kit: string,
  accountId: string | null,
  log: Statement[],
  name: string,
): Promise<RecoveryStatements> {
  const named = deviceName(name);
  const { principalId, recovery } = await parseKit(kit, accountId);
  if (log.length === 0) throw new Error("this server has no account with that account id");
  const head = await headOf(principalId, log);
  if (recovery.publicKey !== head.recoveryKey) {
    throw new Error("this recovery phrase or key does not belong to that account");
  }
  void persistStorage();
  return serialized(async () => {
    const existing = await record(endpoint, principalId);
    if (existing && identityAtHead(existing, head).identity) {
      throw new Error(
        "this browser still holds the account's identity key: sign in with it instead of recovering",
      );
    }
    const replaced = existing?.confirmed ? withoutReplaced(existing) : existing?.replaced;
    const identity = await generateKey();
    const device = await generateKey();
    if (identity.publicKey === head.recoveryKey || identity.publicKey === head.identityKey) {
      throw new Error(KEY_ERRORS.collided);
    }
    const at = now();
    const entry = await signRotation(head, "recovery", recovery.privateKey, identity.publicKey, at);
    const deviceId = uuidV7();
    const certificate = await signDeviceCertificate(identity.privateKey, {
      principalId,
      deviceId,
      deviceKey: device.publicKey,
      name: named,
      keySeq: head.seq + 1,
      issuedAt: at,
    });
    await putRecord({
      v: 1,
      endpoint: storedEndpoint(endpoint),
      principalId,
      deviceId,
      deviceName: named,
      deviceKey: device.privateKey,
      confirmed: false,
      userId: existing?.userId ?? null,
      username: existing?.username ?? null,
      identity,
      // The person just used the kit, so they hold it.
      kitConfirmed: true,
      ...(replaced && { replaced }),
    });
    return { principalId, deviceId, entry, device: certificate };
  });
}

/** Undo a recovery the server refused: its keys go, and the keys it replaced come back. */
export function discardRecovery(principalId: string, deviceId: string): Promise<void> {
  return serialized(() =>
    updatePrincipal(principalId, (r) =>
      !r.confirmed && r.deviceId === deviceId ? (r.replaced ?? null) : undefined,
    ),
  );
}
