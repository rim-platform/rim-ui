/**
 * Where this app's device keys live, behind one interface for the key work that signing in and
 * linking this device need: the Tauri side's secret vault on the desktop, WebCrypto and IndexedDB
 * in the web app. Enrollment, key-only signup, recovery and linking other devices hold the
 * identity key and stay on the Tauri side (`keyCommand`).
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
  /** This device holds the identity key (it enrolled the account). */
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

/** The device key work of signing in and of linking this device as a new device. */
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
  /** Read a pasted code for `endpoint`, make this device's key in memory, seal the offer. */
  linkOffer(endpoint: string, code: string, deviceName: string): Promise<SentOffer>;
  /** Open the answer; returns the account whose key log must verify its certificate. */
  linkOpenAnswer(linkId: string, answer: SealedMessageInput): Promise<{ principalId: string }>;
  /** Verify the certificate against the account's key log and store this device's key. */
  linkAccept(linkId: string, keyLog: SignedStatementInput[]): Promise<LinkedDevice>;
  /** Forget a link and any key it holds in memory. */
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

/** The desktop app's keys, in the secret vault behind the Tauri side's `key_identity` commands. */
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
  forget: async (principalId) => {
    await keyCommand<null>("key_identity_forget", { principalId });
  },
  forgetUnconfirmed: async (principalId) => {
    await keyCommand<null>("key_identity_forget_unconfirmed", { principalId });
  },
  linkOffer: (endpoint, code, deviceName) =>
    keyCommand("key_identity_link_offer", { endpoint, code, deviceName }),
  linkOpenAnswer: (linkId, answer) =>
    keyCommand("key_identity_link_open_answer", { linkId, answer }),
  linkAccept: (linkId, keyLog) => keyCommand("key_identity_link_accept", { linkId, keyLog }),
  linkEnd: async (linkId) => {
    await keyCommand<null>("key_identity_link_end", { linkId });
  },
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
 * Tauri side. The web app holds no identity key, so it never signs.
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
