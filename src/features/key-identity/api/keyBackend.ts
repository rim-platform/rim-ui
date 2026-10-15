/**
 * Where this app's keys live, behind one interface for all key work: the Tauri side's secret
 * vault on the desktop, WebCrypto and IndexedDB in the web app. Signing in, enrollment, key-only
 * signup, the recovery kit, recovery, rotation, revocation, the profile card and both roles of
 * device linking go through it. Plugin manifest signing and the identity key backup stay on the
 * Tauri side.
 */

import { isTauri } from "@tauri-apps/api/core";

import type {
  SealedMessageInput,
  SignedStatementInput,
} from "../../../core/graphql/generated/schema-types";
import { safeInvoke } from "../../../core/tauri/safeInvoke";
import { browserKeyBackend } from "../browser/browserKeyBackend";
import {
  replayHistory,
  verifyPluginManifest as verifyInBrowser,
  type SignedPluginSource,
  type VerifiedPluginManifest,
} from "../browser/pluginManifest";

/** An account on this server that this device holds keys for. */
export interface LocalKeyAccount {
  principalId: string;
  /** Unknown right after a recovery or a link, until the first sign-in. */
  userId: string | null;
  username: string | null;
  deviceId: string;
  deviceName: string;
  /** This device holds the identity key (it enrolled or recovered the account). */
  hasIdentityKey: boolean;
  /** The server has shown these keys on the account. */
  confirmed: boolean;
}

/** Who a key sign-in is for on the server. */
export interface ServerAccount {
  endpoint: string;
  userId: string;
  username: string;
}

/** A challenge from `keyLoginChallenge`. */
export interface KeyChallenge {
  challengeId: string;
  nonce: string;
}

/** A started enrollment: the new account id and the recovery kit. */
export interface EnrollmentDraft {
  draftId: string;
  principalId: string;
  /** The payload of the key log's inception, which a signup's proof-of-work is bound to. */
  inceptionPayload: string;
  /** The whole kit text (`RIM recovery kit (v2)` …), to copy. */
  recoveryKit: string;
  /** The kit's 12 recovery phrase words in order, to show as a numbered grid. */
  recoveryPhrase: string[];
}

/** What `enrollIdentityKey` and `signupWithKey` take. */
export interface EnrollmentStatements {
  keyLog: SignedStatementInput[];
  device: SignedStatementInput;
  proof: SignedStatementInput;
}

/** What a recovery `rotateIdentityKey` takes. */
export interface RecoveryStatements {
  principalId: string;
  /** The new device, to undo the recovery with if the server refuses it. */
  deviceId: string;
  entry: SignedStatementInput;
  device: SignedStatementInput;
}

/** The recovery kit of an identity whose kit the person has not confirmed saving yet. */
export interface RecoveryKitText {
  principalId: string;
  recoveryKit: string;
  recoveryPhrase: string[];
}

/** The server's key log, verified on this device. */
export interface LogStatus {
  principalId: string;
  seq: number;
  /** This device can add and revoke devices, rotate and publish the profile card. */
  holdsIdentityKey: boolean;
}

/** The profile card fields the app chooses; the rest comes from the key log. */
export interface CardContent {
  version: number;
  displayName: string;
  relays: string[];
  /** Certificates of the devices to list; only those that verify against the log are listed. */
  certificates: SignedStatementInput[];
}

/** The new device's sealed offer and the fingerprint to show next to it. */
export interface SentOffer {
  linkId: string;
  fingerprint: string;
  offer: SealedMessageInput;
}

/** The device a verified link answer made of this device. */
export interface LinkedDevice {
  principalId: string;
  deviceId: string;
  deviceName: string;
}

/** A link this device started as the old device. `code` holds the secret: show it, never log it. */
export interface IssuedCode {
  linkId: string;
  code: string;
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

/** A device of the account as `myKeyIdentity` lists it, revoked ones included. */
export interface KnownDevice {
  deviceId: string;
  publicKey: string;
}

/** What the old device sends once the person confirmed. */
export interface LinkAnswer {
  deviceId: string;
  deviceKey: string;
  certificate: SignedStatementInput;
  answer: SealedMessageInput;
}

/** A link this device confirmed as the old device and has not finished. */
export interface PendingLink {
  linkId: string;
  principalId: string;
  deviceId: string;
  deviceKey: string;
}

/**
 * Whether the browser keeps this app's storage under pressure: `refused` means it may evict the
 * keys, `unavailable` that it cannot say.
 */
export type StoragePersistence = "persisted" | "refused" | "unavailable";

/** The key work of this platform. */
export interface KeyBackend {
  /** Accounts on `endpoint` this device can sign in to; empty when the store cannot be read. */
  accounts(endpoint: string): Promise<LocalKeyAccount[]>;
  /** A name for this device to start from. */
  defaultDeviceName(): Promise<string>;
  /** A login proof over `challenge`, signed with this device's key for `principalId`. */
  signLogin(
    endpoint: string,
    principalId: string,
    challenge: KeyChallenge,
  ): Promise<SignedStatementInput>;
  /**
   * Reconcile the keys with the server's `principalId` for the signed-in account: keys it
   * shows are confirmed and linked to the account, unconfirmed keys it does not show go.
   */
  settle(account: ServerAccount, principalId: string | null): Promise<LocalKeyAccount | null>;
  /** Remove an account's keys. */
  forget(principalId: string): Promise<void>;
  /** Remove an account's keys unless the server confirmed them. */
  forgetUnconfirmed(principalId: string): Promise<void>;
  /** Ask the platform to keep the keys' storage; the answer says whether it will. */
  persistStorage(): Promise<StoragePersistence>;

  // ─── Enrollment and key-only signup ───────────────────────────────────────

  /** Create the identity, recovery and device keys of a new identity, held as a draft. */
  beginEnrollment(deviceName: string): Promise<EnrollmentDraft>;
  /** Store a draft's keys for `account`, then sign what `enrollIdentityKey` needs. */
  signEnrollment(
    draftId: string,
    account: ServerAccount,
    challenge: KeyChallenge,
  ): Promise<EnrollmentStatements>;
  /** Store a draft's keys for a new account `username`, then sign what `signupWithKey` needs. */
  signSignup(
    draftId: string,
    endpoint: string,
    username: string,
    challenge: KeyChallenge,
  ): Promise<EnrollmentStatements>;
  /** Remove the keys a refused attempt stored, keeping the draft for a retry. */
  removeDraftKeys(draftId: string): Promise<void>;
  /** Store a draft's keys again for a signup the server took after they were removed. */
  restoreDraftKeys(draftId: string, endpoint: string, username: string): Promise<void>;
  /** Drop a draft, with any keys it stored that the server never confirmed. */
  discardEnrollment(draftId: string): Promise<void>;

  // ─── The recovery kit ─────────────────────────────────────────────────────

  /**
   * Whether this device keeps a new identity's recovery kit until the person confirms saving
   * it, so a signup or enrollment may be sent before the kit is saved and the kit shown after.
   */
  readonly keepsRecoveryKit: boolean;
  /**
   * The recovery kit of `principalId`'s identity while the person has not confirmed saving it;
   * `null` once confirmed, or where this device does not keep it.
   */
  recoveryKit(principalId: string): Promise<RecoveryKitText | null>;
  /** The person saved the kit: this device stops keeping its secret. */
  confirmRecoveryKit(principalId: string): Promise<void>;

  // ─── The identity holder ──────────────────────────────────────────────────

  /** Verify the server's key log and settle a pending rotation against it. */
  syncLog(principalId: string, keyLog: SignedStatementInput[]): Promise<LogStatus>;
  /** Revoke `deviceId`: this device's own with its device key, others with the identity key. */
  signRevocation(
    principalId: string,
    keyLog: SignedStatementInput[],
    deviceId: string,
  ): Promise<SignedStatementInput>;
  /** A new identity key, stored as pending, and the rotation entry the current one signs. */
  beginRotation(principalId: string, keyLog: SignedStatementInput[]): Promise<SignedStatementInput>;
  /** A profile card at the log's head. */
  signProfileCard(
    principalId: string,
    keyLog: SignedStatementInput[],
    card: CardContent,
  ): Promise<SignedStatementInput>;
  /**
   * Take an account back with its recovery kit (a kit of either version, a bare phrase or a
   * bare `RK1-` key): a new identity key and device key, stored, and the recovery rotation and
   * certificate they need.
   */
  beginRecovery(
    endpoint: string,
    kit: string,
    accountId: string | null,
    keyLog: SignedStatementInput[],
    deviceName: string,
  ): Promise<RecoveryStatements>;
  /** Undo a recovery the server refused, putting back any keys it replaced. */
  discardRecovery(principalId: string, deviceId: string): Promise<void>;

  // ─── Device linking, old device ───────────────────────────────────────────

  /** Make the code for the link `startDeviceLink` opened; the secret stays here. */
  linkBegin(principalId: string, endpoint: string, linkId: string): Promise<IssuedCode>;
  /** Open the offer and check it against `myKeyIdentity`'s log and devices. */
  linkReviewOffer(
    linkId: string,
    keyLog: SignedStatementInput[],
    devices: KnownDevice[],
    offer: SealedMessageInput,
  ): Promise<OfferToConfirm>;
  /** Sign the certificate, seal the answer and write the pending link, before `addDeviceKey`. */
  linkConfirm(
    linkId: string,
    keyLog: SignedStatementInput[],
    deviceName: string,
  ): Promise<LinkAnswer>;
  /** Pending links on `endpoint` not live in this run; empty when they cannot be read. */
  linkPending(endpoint: string): Promise<PendingLink[]>;
  /** Carry on a pending link: its certificate and sealed answer, as first sent. */
  linkResume(linkId: string): Promise<LinkAnswer>;

  // ─── Device linking, new device ───────────────────────────────────────────

  /** Read a pasted code for `endpoint`, make this device's key in memory, seal the offer. */
  linkOffer(endpoint: string, code: string, deviceName: string): Promise<SentOffer>;
  /** Open the answer; returns the account whose key log must verify its certificate. */
  linkOpenAnswer(linkId: string, answer: SealedMessageInput): Promise<{ principalId: string }>;
  /** Verify the certificate against the account's key log and store this device's key. */
  linkAccept(linkId: string, keyLog: SignedStatementInput[]): Promise<LinkedDevice>;
  /** Either side: forget a link, its secret, an unsaved key and its pending record. */
  linkEnd(linkId: string): Promise<void>;
}

/** A Tauri key command; a failure becomes an `Error` with the command's message. */
export async function keyCommand<T>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const result = await safeInvoke<T>(command, args);
  if (result.ok) return result.value;
  throw new Error(result.error.message);
}

async function done(command: string, args: Record<string, unknown>): Promise<void> {
  await keyCommand<null>(command, args);
}

/**
 * The desktop app's keys, in the secret vault behind the Tauri side's `key_identity` commands.
 * The vault keeps the recovery kit's secret until the person confirms they saved the kit.
 */
export const tauriKeyBackend: KeyBackend = {
  async accounts(endpoint) {
    const result = await safeInvoke<LocalKeyAccount[]>("key_identity_accounts", { endpoint });
    return result.ok ? result.value : [];
  },
  async defaultDeviceName() {
    const result = await safeInvoke<string>("key_identity_default_device_name");
    return result.ok ? result.value : "Desktop";
  },
  signLogin: (endpoint, principalId, challenge) =>
    keyCommand("key_identity_sign_login", { endpoint, principalId, challenge }),
  settle: (account, principalId) => keyCommand("key_identity_settle", { account, principalId }),
  forget: (principalId) => done("key_identity_forget", { principalId }),
  forgetUnconfirmed: (principalId) => done("key_identity_forget_unconfirmed", { principalId }),
  persistStorage: async () => "persisted",

  beginEnrollment: (deviceName) => keyCommand("key_identity_begin_enrollment", { deviceName }),
  signEnrollment: (draftId, account, challenge) =>
    keyCommand("key_identity_sign_enrollment", { draftId, account, challenge }),
  signSignup: (draftId, endpoint, username, challenge) =>
    keyCommand("key_identity_sign_signup", { draftId, endpoint, username, challenge }),
  removeDraftKeys: (draftId) => done("key_identity_remove_draft_keys", { draftId }),
  restoreDraftKeys: (draftId, endpoint, username) =>
    done("key_identity_restore_draft_keys", { draftId, endpoint, username }),
  discardEnrollment: (draftId) => done("key_identity_discard_enrollment", { draftId }),

  keepsRecoveryKit: true,
  recoveryKit: (principalId) => keyCommand("key_identity_recovery_kit", { principalId }),
  confirmRecoveryKit: (principalId) => done("key_identity_confirm_recovery_kit", { principalId }),

  syncLog: (principalId, keyLog) => keyCommand("key_identity_sync_log", { principalId, keyLog }),
  signRevocation: (principalId, keyLog, deviceId) =>
    keyCommand("key_identity_sign_revocation", { principalId, keyLog, deviceId }),
  beginRotation: (principalId, keyLog) =>
    keyCommand("key_identity_begin_rotation", { principalId, keyLog }),
  signProfileCard: (principalId, keyLog, card) =>
    keyCommand("key_identity_sign_profile_card", { principalId, keyLog, card }),
  beginRecovery: (endpoint, kit, accountId, keyLog, deviceName) =>
    keyCommand("key_identity_begin_recovery", { endpoint, kit, accountId, keyLog, deviceName }),
  discardRecovery: (principalId, deviceId) =>
    done("key_identity_discard_recovery", { principalId, deviceId }),

  linkBegin: (principalId, endpoint, linkId) =>
    keyCommand("key_identity_link_begin", { principalId, endpoint, linkId }),
  linkReviewOffer: (linkId, keyLog, devices, offer) =>
    keyCommand("key_identity_link_review_offer", { linkId, keyLog, devices, offer }),
  linkConfirm: (linkId, keyLog, deviceName) =>
    keyCommand("key_identity_link_confirm", { linkId, keyLog, deviceName }),
  async linkPending(endpoint) {
    const result = await safeInvoke<PendingLink[]>("key_identity_link_pending", { endpoint });
    return result.ok ? result.value : [];
  },
  linkResume: (linkId) => keyCommand("key_identity_link_resume", { linkId }),

  linkOffer: (endpoint, code, deviceName) =>
    keyCommand("key_identity_link_offer", { endpoint, code, deviceName }),
  linkOpenAnswer: (linkId, answer) =>
    keyCommand("key_identity_link_open_answer", { linkId, answer }),
  linkAccept: (linkId, keyLog) => keyCommand("key_identity_link_accept", { linkId, keyLog }),
  linkEnd: (linkId) => done("key_identity_link_end", { linkId }),
};

/** The backend of this platform: the Tauri side when it is there, the browser otherwise. */
export function keyBackend(): KeyBackend {
  return isTauri() ? tauriKeyBackend : browserKeyBackend;
}

/**
 * Verify a plugin manifest statement against its publisher's key log: in the Tauri host on
 * the desktop, with WebCrypto in the web app. Refuses with the rule that failed.
 */
export async function verifyPluginManifest(
  statement: SignedStatementInput,
  keyLog: SignedStatementInput[],
): Promise<VerifiedPluginManifest> {
  if (isTauri()) {
    return keyCommand<VerifiedPluginManifest>("key_identity_verify_plugin_manifest", {
      statement,
      keyLog,
    });
  }
  return verifyInBrowser(await replayHistory(keyLog), statement);
}

/** What a publisher chooses for a plugin manifest statement; the rest comes from the key log. */
export interface PluginManifestInput {
  publisherName: string;
  /** The exact text of `rim-plugin.json`. */
  manifest: string;
  source: SignedPluginSource;
}

/**
 * Sign a plugin manifest statement with the identity key at the head of `keyLog`, on the
 * Tauri side. The web app never publishes plugins, so it never signs one.
 */
export function signPluginManifest(
  principalId: string,
  keyLog: SignedStatementInput[],
  input: PluginManifestInput,
): Promise<SignedStatementInput> {
  return keyCommand<SignedStatementInput>("key_identity_sign_plugin_manifest", {
    principalId,
    keyLog,
    input,
  });
}
