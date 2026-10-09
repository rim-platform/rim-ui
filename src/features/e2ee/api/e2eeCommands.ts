/**
 * Where end-to-end encryption runs: the Tauri side on the desktop (`src-tauri/src/e2ee`), where
 * group state, decryption and the device's MLS identity live in the account's encrypted cache
 * database, or the web app's encrypted store (`../web/`) for a web account. Every command names
 * the account and goes to the backend it belongs to; a failure throws an
 * {@link E2eeCommandError} with the backend's code.
 */

import { invoke, isTauri } from "@tauri-apps/api/core";

import type { SignedStatementInput } from "../../../core/graphql/generated/schema-types";
import { safeInvoke } from "../../../core/tauri/safeInvoke";
import type { CacheAccount } from "../../messages/api/messageCache";
import { isWebAccount } from "../web/webAccount";
import type { DirectoryPrincipal, KeyPackageStatus } from "./e2eeApi";

export class E2eeCommandError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "E2eeCommandError";
    this.code = code;
  }
}

async function command<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const result = await safeInvoke<T>(name, args);
  if (result.ok) return result.value;
  const code = result.error.kind === "backend_error" ? result.error.code : result.error.kind;
  throw new E2eeCommandError(code, result.error.message);
}

export interface DeviceRefView {
  principalId: string;
  deviceId: string;
}

export interface UnverifiedDevice extends DeviceRefView {
  reason: string;
}

export interface Reset extends DeviceRefView {
  incarnation: number;
}

/**
 * A principal a processed Commit brought into the group or took out of it; the timeline shows
 * it before the first message of `epoch`, the epoch the Commit made.
 */
export interface MembershipEvent {
  incarnation: number;
  epoch: number;
  kind: "added" | "removed";
  principalId: string;
}

/** Where a conversation's group stands on this device. */
export interface GroupView {
  conversationId: string;
  incarnation: number;
  nextIncarnation: number | null;
  joinEpoch: number;
  removed: boolean;
  verifyPending: boolean;
  unverified: UnverifiedDevice[];
  misbehaved: DeviceRefView | null;
  readdRequestedAt: number | null;
  lastUpdateAt: number | null;
  resets: Reset[];
  membership: MembershipEvent[];
  hasGroup: boolean;
  epoch: number | null;
  commitPending: boolean;
  awaitingReadd: number | null;
  /** This device knows the conversation is encrypted, whatever the server says now. */
  pinned: boolean;
  /** The server's `encryptedAt` as this device first saw it. */
  pinnedEncryptedAt: string | null;
  /** A direct message's two principals, as pinned. */
  dmPrincipals: string[] | null;
}

export interface OutgoingCommit {
  incarnation: number;
  epoch: number;
  cipherSuite: number;
  commit: string;
  welcome: string | null;
  adds: (DeviceRefView & { keyPackageRef: string })[];
  removes: DeviceRefView[];
}

export interface ClaimedInput extends DeviceRefView {
  keyPackage: string;
}

export interface CommitInput {
  incarnation: number;
  epoch: number;
  message: string;
}

export interface DirectoryInput {
  members: string[];
  principals: {
    principalId: string;
    keyLog: SignedStatementInput[];
    devices: DirectoryPrincipal["devices"];
  }[];
}

export interface VerifyOutcome {
  missing: string[];
  unverified: UnverifiedDevice[];
}

export interface LinkPreviewInput {
  url: string | null;
  title: string | null;
  description: string | null;
  siteName: string | null;
}

export interface DraftInput {
  editOf?: string;
  body: string;
  threadRootId?: string | null;
  threadId?: string | null;
  replyTo?: string | null;
  forwardedFrom?: {
    messageId: string;
    conversationId: string;
    authorPrincipalId: string;
    sentAt: string;
  } | null;
  attachments?: string[];
  linkPreviews?: LinkPreviewInput[];
  authorId: string;
  author: unknown;
}

export interface OutgoingMessage {
  messageId: string;
  incarnation: number;
  epoch: number;
  envelope: string;
  threadRootMessageId: string | null;
  forwardedFromMessageId: string | null;
}

/** The Tauri side's commands. */
const tauriE2eeCommands = {
  status: (account: CacheAccount, workspaceId: string, conversationIds: string[]) =>
    command<GroupView[]>("e2ee_status", { account, workspaceId, conversationIds }),
  ensureIdentity: (account: CacheAccount, principalId: string) =>
    command<{ deviceId: string; statement: SignedStatementInput }>("e2ee_ensure_identity", {
      account,
      principalId,
    }),
  keyPackages: (account: CacheAccount, status: KeyPackageStatus | null, minOneTime = 0) =>
    command<string[]>("e2ee_key_packages", { account, status, minOneTime }),
  createGroup: (
    account: CacheAccount,
    workspaceId: string,
    conversationId: string,
    incarnation: number,
    claimed: ClaimedInput[],
  ) =>
    command<OutgoingCommit>("e2ee_create_group", {
      account,
      workspaceId,
      conversationId,
      incarnation,
      claimed,
    }),
  commit: (
    account: CacheAccount,
    workspaceId: string,
    conversationId: string,
    claimed: ClaimedInput[],
    removes: DeviceRefView[],
  ) =>
    command<OutgoingCommit>("e2ee_commit", {
      account,
      workspaceId,
      conversationId,
      claimed,
      removes,
    }),
  settleCommit: (
    account: CacheAccount,
    principalId: string,
    workspaceId: string,
    conversationId: string,
    accepted: boolean,
    readds: DeviceRefView[] = [],
  ) =>
    command<GroupView>("e2ee_settle_commit", {
      account,
      principalId,
      workspaceId,
      conversationId,
      accepted,
      readds,
    }),
  processCommits: (
    account: CacheAccount,
    workspaceId: string,
    conversationId: string,
    commits: CommitInput[],
  ) =>
    command<{ step: "applied" | "skipped" | "gap" | "cannotProcess"; group: GroupView }>(
      "e2ee_process_commits",
      { account, workspaceId, conversationId, commits },
    ),
  join: (
    account: CacheAccount,
    workspaceId: string,
    conversationId: string,
    incarnation: number,
    welcome: string,
  ) =>
    command<GroupView>("e2ee_join", {
      account,
      workspaceId,
      conversationId,
      incarnation,
      welcome,
    }),
  verify: (
    account: CacheAccount,
    workspaceId: string,
    conversationId: string,
    directory: DirectoryInput,
  ) => command<VerifyOutcome>("e2ee_verify", { account, workspaceId, conversationId, directory }),
  readdRequest: (
    account: CacheAccount,
    principalId: string,
    workspaceId: string,
    conversationId: string,
    incarnation: number,
  ) =>
    command<SignedStatementInput>("e2ee_readd_request", {
      account,
      principalId,
      workspaceId,
      conversationId,
      incarnation,
    }),
  readdCheck: (
    account: CacheAccount,
    workspaceId: string,
    conversationId: string,
    requests: (DeviceRefView & { request: SignedStatementInput })[],
    directory: DirectoryInput,
  ) =>
    command<DeviceRefView[]>("e2ee_readd_check", {
      account,
      workspaceId,
      conversationId,
      requests,
      directory,
    }),
  encryptMessage: (
    account: CacheAccount,
    workspaceId: string,
    conversationId: string,
    draft: DraftInput,
    forwardOf: string | null = null,
  ) =>
    command<OutgoingMessage>("e2ee_encrypt_message", {
      account,
      workspaceId,
      conversationId,
      draft,
      forwardOf,
    }),
  reencryptMessage: (account: CacheAccount, messageId: string) =>
    command<OutgoingMessage>("e2ee_reencrypt_message", { account, messageId }),
  settleMessage: (account: CacheAccount, messageId: string, accepted: unknown) =>
    command<{ unsentBody: string | null }>("e2ee_settle_message", {
      account,
      messageId,
      accepted,
    }),
  forget: (account: CacheAccount, workspaceId: string, conversationId: string) =>
    command<null>("e2ee_forget", { account, workspaceId, conversationId }),
  /**
   * Pin the conversation as encrypted on this device: the server's `encryptedAt`, and a direct
   * message's two principals. The first values pinned stay.
   */
  pin: (
    account: CacheAccount,
    workspaceId: string,
    conversationId: string,
    encryptedAt: string | null,
    dmPrincipals: string[] | null,
  ) =>
    command<GroupView>("e2ee_pin", {
      account,
      workspaceId,
      conversationId,
      encryptedAt,
      dmPrincipals,
    }),
};

/** The encryption commands, whichever backend runs them. */
export type E2eeCommands = typeof tauriE2eeCommands;

function webCommands() {
  return import("../web/webCommands").then((m) => m.webE2eeCommands);
}

/** `name` of the account's backend: the web store for a web account, the Tauri side otherwise. */
function routed<K extends keyof E2eeCommands>(name: K): E2eeCommands[K] {
  type Command = (account: CacheAccount, ...rest: unknown[]) => Promise<unknown>;
  return ((account: CacheAccount, ...rest: unknown[]) =>
    isWebAccount(account)
      ? webCommands().then((web) => (web[name] as Command)(account, ...rest))
      : (tauriE2eeCommands[name] as Command)(account, ...rest)) as E2eeCommands[K];
}

export const e2eeCommands: E2eeCommands = {
  status: routed("status"),
  ensureIdentity: routed("ensureIdentity"),
  keyPackages: routed("keyPackages"),
  createGroup: routed("createGroup"),
  commit: routed("commit"),
  settleCommit: routed("settleCommit"),
  processCommits: routed("processCommits"),
  join: routed("join"),
  verify: routed("verify"),
  readdRequest: routed("readdRequest"),
  readdCheck: routed("readdCheck"),
  encryptMessage: routed("encryptMessage"),
  reencryptMessage: routed("reencryptMessage"),
  settleMessage: routed("settleMessage"),
  forget: routed("forget"),
  pin: routed("pin"),
};

/**
 * A link's preview, fetched by this device (the sender); `null` when the page has none. A
 * browser cannot read other sites' pages, so the web app sends no previews.
 */
export function fetchLinkPreview(url: string): Promise<LinkPreviewInput | null> {
  if (!isTauri()) return Promise.resolve(null);
  return command<LinkPreviewInput | null>("e2ee_link_preview", { url });
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Arguments of a raw-bytes command, in its header: base64url of their JSON. */
function argsHeader(args: unknown): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(args)));
}

/** A file encrypted for upload: its blob and the blob's SHA-256. */
export interface EncryptedFile {
  blob: Uint8Array;
  blobSha256: string;
}

/**
 * Encrypt a file on the Tauri side, or with WebCrypto in the web app; either keeps its secret
 * until the message is encrypted.
 */
export async function encryptAttachment(
  bytes: Uint8Array,
  name: string,
  mime: string,
): Promise<EncryptedFile> {
  if (!isTauri()) {
    const { encryptFile, keepPending } = await import("../web/attachments");
    try {
      const { entry, blob } = await encryptFile(bytes, name, mime);
      keepPending(entry);
      return { blob, blobSha256: entry.blobSha256 };
    } catch (err) {
      throw new E2eeCommandError("E2EE_ATTACHMENT", errorText(err));
    }
  }
  try {
    const out = new Uint8Array(
      await invoke<ArrayBuffer>("e2ee_attachment_encrypt", bytes, {
        headers: { "x-rim-args": argsHeader({ name, mime }) },
      }),
    );
    return { blobSha256: toBase64Url(out.slice(0, 32)), blob: out.slice(32) };
  } catch (err) {
    throw new E2eeCommandError("E2EE_ATTACHMENT", errorText(err));
  }
}

/** Decrypt a downloaded blob of a cached message's attachment (hash, then size, checked). */
export async function decryptAttachment(
  account: CacheAccount,
  messageId: string,
  blobSha256: string,
  blob: Uint8Array,
): Promise<Uint8Array> {
  if (isWebAccount(account)) {
    const [{ webMessageStore }, { decryptFile }] = await Promise.all([
      import("../web/webCommands"),
      import("../web/attachments"),
    ]);
    const entry = await webMessageStore.attachmentEntry(account, messageId, blobSha256);
    if (!entry) throw new E2eeCommandError("E2EE_ATTACHMENT", "the message has no such file");
    try {
      return await decryptFile(entry, blob);
    } catch (err) {
      throw new E2eeCommandError("E2EE_ATTACHMENT", errorText(err));
    }
  }
  try {
    return new Uint8Array(
      await invoke<ArrayBuffer>("e2ee_attachment_decrypt", blob, {
        headers: { "x-rim-args": argsHeader({ account, messageId, blobSha256 }) },
      }),
    );
  } catch (err) {
    throw new E2eeCommandError("E2EE_ATTACHMENT", errorText(err));
  }
}

function errorText(err: unknown): string {
  if (typeof err === "object" && err !== null && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}
