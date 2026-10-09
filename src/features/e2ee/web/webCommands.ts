/**
 * The web app's encryption backend: the command surface the desktop's Tauri side offers
 * (`e2eeCommands`), and the cache calls of encrypted conversations (`messageCache`), over this
 * browser's encrypted store. A failure throws an `E2eeCommandError` with the code the desktop
 * would answer.
 */

import type { MessageChangesInput } from "../../../core/graphql/generated/schema-types";
import type { MessageCursor, MessageItem } from "../../../core/types/messages";
import { record as keyRecord } from "../../key-identity/browser/keyStore";
import { certificateClaim, CONTEXT, sign } from "../../key-identity/browser/statements";
import type {
  CacheAccount,
  CacheSyncStep,
  FeedConversationChanges,
  MlsSyncInput,
} from "../../messages/api/messageCache";
import { fetchPrincipalDevices, type KeyPackageStatus } from "../api/e2eeApi";
import {
  E2eeCommandError,
  type ClaimedInput,
  type CommitInput,
  type DeviceRefView,
  type DirectoryInput,
  type DraftInput,
  type E2eeCommands,
  type GroupView,
} from "../api/e2eeCommands";
import { forgetPending, pendingEntry } from "./attachments";
import { honorableReadds, verify, type ReaddInput } from "./directory";
import { begin, FeedApplier, isComplete, track } from "./feed";
import * as group from "./groupState";
import { message, thread, timeline, timestampUs } from "./messageRows";
import { isTrap, loadMls, mlsCode } from "./mlsModule";
import { attachmentEntry, encrypt, reencrypt, settle } from "./outgoing";
import { WebStore, type Work } from "./store";
import { isWebAccount, type WebAccount } from "./webAccount";

/** The codes the desktop answers for the engine's failures. */
const SAME_CODES = new Set([
  "E2EE_NO_IDENTITY",
  "E2EE_NO_GROUP",
  "E2EE_COMMIT_PENDING",
  "E2EE_NO_PENDING_COMMIT",
  "E2EE_AWAITING_READD",
  "E2EE_REMOVED",
  "E2EE_EPOCH_MISMATCH",
  "E2EE_STALE_WELCOME",
]);

function commandError(err: unknown): E2eeCommandError {
  if (err instanceof E2eeCommandError) return err;
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof group.GroupError) return new E2eeCommandError(err.code, message);
  const code = mlsCode(err);
  if (code === "E2EE_STORAGE") return new E2eeCommandError("CACHE_STORAGE", message);
  if (code) return new E2eeCommandError(SAME_CODES.has(code) ? code : "E2EE_MLS", message);
  if (isTrap(err)) return new E2eeCommandError("E2EE_MLS", message);
  if (err instanceof DOMException) return new E2eeCommandError("CACHE_STORAGE", message);
  return new E2eeCommandError("E2EE_WEB", message);
}

const stores = new Map<string, Promise<WebStore>>();

function storeKey(account: WebAccount) {
  return `${account.endpoint}\n${account.principalId}`;
}

/** The account's store, opened once per page. */
export function openStore(account: WebAccount): Promise<WebStore> {
  const key = storeKey(account);
  let store = stores.get(key);
  if (!store) {
    store = loadMls().then((mls) => {
      if (!mls) throw new E2eeCommandError("E2EE_UNSUPPORTED", "this browser cannot run MLS");
      return WebStore.open(account, mls);
    });
    stores.set(key, store);
    store.catch(() => {
      if (stores.get(key) === store) stores.delete(key);
    });
  }
  return store;
}

/** Forget the opened stores (tests, and a sign-out). */
export function closeStores() {
  stores.clear();
}

function webAccount(account: CacheAccount): WebAccount {
  if (!isWebAccount(account)) {
    throw new E2eeCommandError("INVALID_ARGS", "not this browser's encrypted store");
  }
  return account;
}

/** Run `task` as one unit of work of the account's store; failures become command errors. */
async function inStore<T>(
  account: CacheAccount,
  task: (work: Work, store: WebStore) => Promise<T>,
): Promise<T> {
  try {
    const store = await openStore(webAccount(account));
    return await store.run((work) => task(work, store));
  } catch (err) {
    throw commandError(err);
  }
}

function me(account: WebAccount): DeviceRefView {
  return { principalId: account.principalId, deviceId: account.deviceId };
}

/** This browser's device key, which signs `mls-key` statements and re-add requests. */
async function deviceKey(account: WebAccount): Promise<CryptoKey> {
  const stored = await keyRecord(account.endpoint, account.principalId);
  if (!stored?.confirmed) {
    throw new E2eeCommandError("E2EE_DEVICE_KEY", "this browser holds no device key for it");
  }
  return stored.deviceKey;
}

interface AccountRecord {
  endpoint: string;
  principalId: string;
  /** This device's public key, as its certificate names it. */
  deviceKey: string | null;
  /** Unix milliseconds this browser last ran encryption for the account. */
  lastUsedAt: number | null;
}

function accountKey(account: WebAccount): IDBValidKey {
  return [account.endpoint, account.principalId];
}

/** This device's public key: kept from its certificate, which the server serves. */
async function publicDeviceKey(account: WebAccount): Promise<string> {
  const store = await openStore(account);
  const kept = await store.run((work) => work.get<AccountRecord>("accounts", accountKey(account)));
  if (kept?.deviceKey) return kept.deviceKey;
  const [principal] = await fetchPrincipalDevices([account.principalId]);
  const device = principal?.devices.find(
    (d) => d.deviceId.toLowerCase() === account.deviceId.toLowerCase(),
  );
  if (!device) throw new E2eeCommandError("E2EE_DEVICE_KEY", "the server lists no such device");
  const key = certificateClaim(device.certificate).deviceKey;
  await store.run(async (work) => {
    const current = await work.get<AccountRecord>("accounts", accountKey(account));
    work.put("accounts", {
      endpoint: account.endpoint,
      principalId: account.principalId,
      lastUsedAt: current?.lastUsedAt ?? null,
      deviceKey: key,
    } satisfies AccountRecord);
  });
  return key;
}

/**
 * When this browser last ran encryption for the account (Unix milliseconds, `null` the first
 * time), noting that it runs now.
 */
export async function touchAccount(account: WebAccount): Promise<number | null> {
  return inStore(account, async (work) => {
    const current = await work.get<AccountRecord>("accounts", accountKey(account));
    work.put("accounts", {
      endpoint: account.endpoint,
      principalId: account.principalId,
      deviceKey: current?.deviceKey ?? null,
      lastUsedAt: Date.now(),
    } satisfies AccountRecord);
    return current?.lastUsedAt ?? null;
  });
}

/** Every conversation this browser holds group state for, in every workspace. */
export async function groupsOf(
  account: WebAccount,
): Promise<{ workspaceId: string; conversationId: string; incarnation: number }[]> {
  return inStore(account, async (work) =>
    (await group.allGroups(work)).map((g) => ({
      workspaceId: g.workspaceId,
      conversationId: g.conversationId,
      incarnation: g.state.incarnation,
    })),
  );
}

function unixSeconds(at: string | null | undefined): number | null {
  if (!at) return null;
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? null : Math.max(0, Math.floor(ms / 1000));
}

export const webE2eeCommands: E2eeCommands = {
  status: (account, workspaceId, conversationIds) =>
    inStore(account, async (work, store) => {
      const ids = conversationIds.length
        ? conversationIds
        : await group.conversations(work, workspaceId);
      const views: GroupView[] = [];
      for (const id of ids) views.push(await group.view(work, store.engine, workspaceId, id));
      return views;
    }),

  ensureIdentity: async (account, principalId) => {
    const web = webAccount(account);
    try {
      const key = await deviceKey(web);
      const publicKey = await publicDeviceKey(web);
      return await inStore(account, async (_work, store) => {
        const existing = store.engine.mlsKeyStatement();
        if (existing) {
          const statement = JSON.parse(existing) as { payload: string; signature: string };
          const claim = JSON.parse(statement.payload) as { principalId: string; deviceId: string };
          if (claim.principalId === principalId && claim.deviceId === web.deviceId.toLowerCase()) {
            return { deviceId: web.deviceId, statement };
          }
        }
        const issuedAt = new Date().toISOString().replace(/\.\d+Z$/, "Z");
        const payload = store.engine.mlsKeyPayload(principalId, web.deviceId, issuedAt);
        const statement = await sign(key, CONTEXT.mlsKey, payload);
        store.engine.installMlsKeyStatement(statement.payload, statement.signature, publicKey);
        return { deviceId: web.deviceId, statement };
      });
    } catch (err) {
      throw commandError(err);
    }
  },

  keyPackages: (account, status: KeyPackageStatus | null, minOneTime = 0) =>
    inStore(account, async (_work, store) => {
      const now = Math.floor(Date.now() / 1000);
      store.engine.pruneKeyPackages(now);
      const plan = JSON.parse(
        store.mls.planKeyPackageUpload(
          JSON.stringify({
            available: status?.available ?? 0,
            lastResortNotAfter: unixSeconds(status?.lastResortNotAfter),
            lastResortClaims: status?.lastResortClaims ?? null,
          }),
          now,
        ),
      ) as { oneTime: number; lastResort: boolean };
      const packages = JSON.parse(
        store.engine.generateKeyPackages(Math.max(plan.oneTime, minOneTime), false, now),
      ) as { message: string }[];
      if (plan.lastResort) {
        packages.push(
          ...(JSON.parse(store.engine.generateKeyPackages(1, true, now)) as { message: string }[]),
        );
      }
      return packages.map((p) => p.message);
    }),

  createGroup: (account, workspaceId, conversationId, incarnation, claimed: ClaimedInput[]) =>
    inStore(account, (work, store) =>
      group.create(work, store.engine, workspaceId, conversationId, incarnation, claimed),
    ),

  commit: (account, workspaceId, conversationId, claimed: ClaimedInput[], removes) =>
    inStore(account, (work, store) =>
      group.commit(work, store.engine, workspaceId, conversationId, claimed, removes),
    ),

  settleCommit: (account, _principalId, workspaceId, conversationId, accepted, readds = []) =>
    inStore(account, async (work, store) => {
      const device = me(webAccount(account));
      await group.settle(work, store.engine, device, workspaceId, conversationId, accepted);
      if (accepted) await group.noteReaddsHonored(work, workspaceId, conversationId, readds);
      return group.view(work, store.engine, workspaceId, conversationId);
    }),

  processCommits: (account, workspaceId, conversationId, commits: CommitInput[]) =>
    inStore(account, async (work, store) => {
      const step = await group.processCommits(
        work,
        store.engine,
        workspaceId,
        conversationId,
        commits,
      );
      return { step, group: await group.view(work, store.engine, workspaceId, conversationId) };
    }),

  join: (account, workspaceId, conversationId, incarnation, welcome) =>
    inStore(account, async (work, store) => {
      await group.join(work, store.engine, workspaceId, conversationId, incarnation, welcome);
      return group.view(work, store.engine, workspaceId, conversationId);
    }),

  verify: (account, workspaceId, conversationId, directory: DirectoryInput) =>
    inStore(account, (work, store) =>
      verify(work, store.engine, workspaceId, conversationId, directory),
    ),

  readdRequest: async (account, _principalId, workspaceId, conversationId, incarnation) => {
    const key = await deviceKey(webAccount(account)).catch((err: unknown) => {
      throw commandError(err);
    });
    return inStore(account, async (work, store) => {
      const payload = await group.prepareReadd(
        work,
        store.engine,
        workspaceId,
        conversationId,
        incarnation,
      );
      return sign(key, CONTEXT.mlsReadd, payload);
    });
  },

  readdCheck: (account, workspaceId, conversationId, requests, directory) =>
    inStore(account, (work, store) =>
      honorableReadds(
        work,
        store.mls,
        workspaceId,
        conversationId,
        requests as ReaddInput[],
        directory,
      ),
    ),

  encryptMessage: async (account, workspaceId, conversationId, draft: DraftInput, forwardOf) => {
    const out = await inStore(account, (work, store) =>
      encrypt(work, store.mls, store.engine, workspaceId, conversationId, draft, async (hash) => {
        return (
          pendingEntry(hash) ?? (forwardOf ? await attachmentEntry(work, forwardOf, hash) : null)
        );
      }),
    );
    forgetPending(draft.attachments ?? []);
    return out;
  },

  reencryptMessage: (account, messageId) =>
    inStore(account, (work, store) => reencrypt(work, store.engine, messageId)),

  settleMessage: (account, messageId, accepted) =>
    inStore(account, (work) => settle(work, messageId, accepted)),

  forget: (account, workspaceId, conversationId) =>
    inStore(account, async (work, store) => {
      await group.forget(work, store.engine, workspaceId, conversationId);
      return null;
    }),

  pin: (account, workspaceId, conversationId, encryptedAt, dmPrincipals) =>
    inStore(account, async (work, store) => {
      await group.pin(work, workspaceId, conversationId, encryptedAt, dmPrincipals);
      return group.view(work, store.engine, workspaceId, conversationId);
    }),
};

// ─── The cache calls of encrypted conversations ─────────────────────────────

/** The web store's side of `messageCache`, for the encrypted conversations it follows. */
export const webMessageStore = {
  track: (account: CacheAccount, workspaceId: string, conversationId: string) =>
    inStore(account, (work) => track(work, workspaceId, conversationId)),

  begin: (
    account: CacheAccount,
    workspaceId: string,
    conversationIds?: string[],
  ): Promise<MessageChangesInput | null> =>
    inStore(account, (work) => begin(work, workspaceId, conversationIds)),

  apply: (
    account: CacheAccount,
    workspaceId: string,
    changes: FeedConversationChanges[],
    mls: MlsSyncInput[],
  ): Promise<CacheSyncStep> =>
    inStore(account, (work, store) =>
      new FeedApplier(work, store.engine, workspaceId, mls).apply(changes),
    ),

  /** A timeline page, or `null` until the conversation's history was read once. */
  timeline: async (
    account: CacheAccount,
    workspaceId: string,
    conversationId: string,
    before: MessageCursor | null,
    limit: number,
  ): Promise<{ items: MessageItem[]; hasOlder: boolean } | null> => {
    const web = webAccount(account);
    const store = await openStore(web);
    const complete = await store.run((work) => isComplete(work, workspaceId, conversationId));
    if (!complete) return null;
    const cursor = before
      ? { sentAtUs: timestampUs(before.sentAt) ?? 0, id: before.messageId }
      : null;
    return store.read((db) => timeline(db, web, workspaceId, conversationId, cursor, limit));
  },

  thread: async (
    account: CacheAccount,
    workspaceId: string,
    conversationId: string,
    threadId: string,
    rootMessageId: string | null,
  ): Promise<MessageItem[]> => {
    const web = webAccount(account);
    const store = await openStore(web);
    return store.read((db) =>
      thread(db, web, workspaceId, conversationId, threadId, rootMessageId),
    );
  },

  message: async (account: CacheAccount, messageId: string): Promise<MessageItem | null> => {
    const web = webAccount(account);
    const store = await openStore(web);
    return store.read((db) => message(db, web, messageId));
  },

  /** The content entry of a stored message's attachment, to decrypt its blob. */
  attachmentEntry: (account: CacheAccount, messageId: string, blobSha256: string) =>
    inStore(account, (work) => attachmentEntry(work, messageId, blobSha256)),
};
