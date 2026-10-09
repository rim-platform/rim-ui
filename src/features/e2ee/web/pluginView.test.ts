import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import vectors from "../../../../protocol/plugin-chat-vectors.json";
import { loadMlsModule } from "../../../test/e2eeWorld";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { webChatCache } from "../../plugins/chat/appMessageService";
import type { PluginReadScope } from "../../plugins/chat/chatTypes";
import { createMessageService } from "../../plugins/chat/messageService";
import { committed, database } from "./db";
import { principalMentions } from "./pluginView";
import { timestampUs } from "./messageRows";
import { closeStores } from "./webCommands";
import type { WebAccount } from "./webAccount";

const WS = vectors.workspaceId;
const CONV = vectors.conversationId;
const account: WebAccount = {
  endpoint: "http://localhost:8080/api",
  userId: "user-1",
  principalId: "rimp1_ThisBrowser",
  deviceId: "0192f000-0000-7000-8000-0000000d0001",
  web: true,
};
const reader: PluginReadScope = { encryptedAllowed: true, knownEncrypted: [] };
const plainReader: PluginReadScope = { encryptedAllowed: false, knownEncrypted: [] };
const rowId = (n: number) => vectors.rows[n].id;

type VectorRow = (typeof vectors.rows)[number];

function stored(row: VectorRow, conversationId = CONV) {
  return {
    endpoint: account.endpoint,
    principalId: account.principalId,
    id: row.id,
    workspaceId: WS,
    conversationId,
    threadId: row.threadId,
    authorId: row.authorId,
    version: 1,
    sentAtUs: timestampUs(row.sentAt),
    editedAt: row.editedAt,
    isDeleted: row.isDeleted,
    text: row.text,
    payload: { ...row.payload, conversationId },
    e2eeState: row.e2eeState,
  };
}

function follow(conversationId: string, complete: boolean) {
  return {
    endpoint: account.endpoint,
    principalId: account.principalId,
    workspaceId: WS,
    conversationId,
    cursor: null,
    pending: false,
    complete,
    lastViewedAt: 0,
  };
}

/** The store holding the vector's encrypted group, with this browser in its group. */
async function load(extra: (tx: IDBTransaction) => void = () => {}) {
  const db = await database();
  const tx = db.transaction(["messages", "sync", "groups"], "readwrite");
  const done = committed(tx);
  for (const row of vectors.rows) tx.objectStore("messages").put(stored(row));
  tx.objectStore("sync").put(follow(CONV, true));
  tx.objectStore("groups").put({
    endpoint: account.endpoint,
    principalId: account.principalId,
    workspaceId: WS,
    conversationId: CONV,
    incarnation: 1,
  });
  extra(tx);
  await done;
}

beforeAll(() => {
  loadMlsModule();
  (globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = IDBKeyRange;
});

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  closeStores();
  useAuthStore.getState().setSession({ userId: account.userId });
  await load();
});

describe("plugins reading the web app's encrypted store", () => {
  it("get the shared vector's list, as from the desktop's cache", async () => {
    const page = await webChatCache(account).list(WS, CONV, null, 50, reader);
    expect(page).toEqual(vectors.listMessages.result);
  });

  it("get the same answer through the message service", async () => {
    const service = createMessageService({
      workspaceId: () => WS,
      encrypted: async (_ws, id) => id === CONV,
      cache: () => webChatCache(account),
      post: async () => "unused",
      recordEncryptedReads: async () => {},
    });
    const result = await service.call(
      "dev.example.reader",
      "rim.chat.list_messages",
      vectors.listMessages.params,
      vectors.listMessages.grantedCapabilities,
    );
    expect(result).toEqual(vectors.listMessages.result);
  });

  it("never get anything secret, unverified or unsent", async () => {
    const cache = webChatCache(account);
    const seen: unknown[] = [await cache.list(WS, CONV, null, null, reader)];
    for (const row of vectors.rows) seen.push(await cache.get(WS, row.id, reader));
    for (const query of ["plan", "still", "shall", "edited"]) {
      seen.push(await cache.search(WS, query, null, null, reader));
    }
    const text = JSON.stringify(seen);
    for (const forbidden of vectors.forbiddenStrings) expect(text).not.toContain(forbidden);
    for (const key of ["frankingKey", "secret", "blobSha256", "e2ee", "ciphertext", "epoch"]) {
      expect(text).not.toContain(key);
    }
    for (const n of [2, 3, 4, 5]) expect(await cache.get(WS, rowId(n), reader)).toBeNull();
    expect(await cache.search(WS, "still", null, null, reader)).toEqual([]);
  });

  it("need the encrypted grant for an encrypted conversation, its old plaintext included", async () => {
    const cache = webChatCache(account);
    await expect(cache.list(WS, CONV, null, null, plainReader)).rejects.toMatchObject({
      code: -32000,
    });
    for (const n of [0, 1]) {
      await expect(cache.get(WS, rowId(n), plainReader)).rejects.toMatchObject({ code: -32000 });
    }
    await expect(cache.search(WS, "plan", CONV, null, plainReader)).rejects.toMatchObject({
      code: -32000,
    });
    expect(await cache.search(WS, "plan", null, null, plainReader)).toEqual([]);
    expect((await cache.search(WS, "plan", null, null, reader)).map((m) => m.id)).toEqual([
      rowId(1),
    ]);
  });

  it("read a plaintext conversation with chat.read unless it is known to be encrypted", async () => {
    const plain = "0192f000-0000-7000-8000-00000000c0b2";
    const copy = { ...vectors.rows[0], id: "0192f000-0000-7000-8000-0000000000f1" };
    globalThis.indexedDB = new IDBFactory();
    closeStores();
    await load((tx) => {
      tx.objectStore("messages").put(stored(copy, plain));
      tx.objectStore("sync").put(follow(plain, true));
    });
    const cache = webChatCache(account);
    const page = await cache.list(WS, plain, null, null, plainReader);
    expect(page?.messages.map((m) => [m.id, m.encrypted])).toEqual([[copy.id, false]]);
    const hits = await cache.search(WS, "ENCRYPT", null, null, plainReader);
    expect(hits.map((m) => m.conversationId)).toEqual([plain]);
    await expect(
      cache.list(WS, plain, null, null, { encryptedAllowed: false, knownEncrypted: [plain] }),
    ).rejects.toMatchObject({ code: -32000 });
  });

  it("page with `before` and wait for a complete history", async () => {
    const cache = webChatCache(account);
    const newest = await cache.list(WS, CONV, null, 1, reader);
    expect(newest?.messages.map((m) => m.id)).toEqual([rowId(6)]);
    expect(newest?.hasOlder).toBe(true);
    const older = await cache.list(WS, CONV, rowId(6), 5, reader);
    expect(older?.messages.map((m) => m.id)).toEqual([rowId(0), rowId(1)]);
    expect(older?.hasOlder).toBe(false);
    await expect(cache.list(WS, CONV, "nope", null, reader)).rejects.toMatchObject({
      code: -32602,
    });

    const partial = "0192f000-0000-7000-8000-00000000c0c3";
    const db = await database();
    const tx = db.transaction("sync", "readwrite");
    tx.objectStore("sync").put(follow(partial, false));
    await committed(tx);
    expect(await cache.list(WS, partial, null, null, reader)).toBeNull();
    expect(await cache.get("ws-other", rowId(0), reader)).toBeNull();
  });

  it("answers notCached for a conversation not stored yet, and starts storing it", async () => {
    const other = "0192f000-0000-7000-8000-00000000c0d4";
    const service = createMessageService({
      workspaceId: () => WS,
      encrypted: async () => true,
      cache: () => webChatCache(account),
      post: async () => "unused",
      recordEncryptedReads: async () => {},
    });
    await expect(
      service.call(
        "dev.example.reader",
        "rim.chat.list_messages",
        { conversationId: other },
        vectors.listMessages.grantedCapabilities,
      ),
    ).rejects.toMatchObject({ data: { reason: "notCached" } });
    const db = await database();
    const record = await new Promise((resolve) => {
      const request = db
        .transaction("sync")
        .objectStore("sync")
        .get([account.endpoint, account.principalId, WS, other]);
      request.onsuccess = () => resolve(request.result);
    });
    expect(record).toMatchObject({ conversationId: other, complete: false });
  });

  it("rewrite account mentions to provisional principal ids", async () => {
    const user = "0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b";
    const text = await principalMentions(`hi <@${user}> and <@rimp1_abc>, <@nope> <@`);
    expect(text).toMatch(/^hi <@rimp0_[A-Za-z0-9_-]{43}> and <@rimp1_abc>, <@nope> <@$/);
    expect(await principalMentions(`<@${user.toUpperCase()}>`)).toBe(
      text.slice(3, text.indexOf(" and")),
    );
  });
});
