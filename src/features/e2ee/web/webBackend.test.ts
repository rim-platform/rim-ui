import { IDBFactory, IDBKeyRange, IDBObjectStore } from "fake-indexeddb";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CONVERSATION,
  loadMlsModule,
  TestDevice,
  TestPrincipal,
  TestServer,
  WS,
} from "../../../test/e2eeWorld";
import { withEncryptionNotices } from "../utils/timeline";

const principals: TestPrincipal[] = [];
const requestMock = vi.hoisted(() => vi.fn());
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));

import { E2eeCommandError, e2eeCommands, encryptAttachment } from "../api/e2eeCommands";
import { webE2eeCommands as commands, closeStores } from "./webCommands";
import { lockVault } from "../../../core/accountVault/accountVault";
import { unlockTestVault } from "../../../test/accountVault";
import { database, done } from "./db";

function operation(doc: unknown): string {
  return /(?:query|mutation)\s+(\w+)/.exec(String(doc))?.[1] ?? "";
}

const server = { current: new TestServer() };

beforeAll(() => {
  loadMlsModule();
  (globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = IDBKeyRange;
});

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  closeStores();
  principals.length = 0;
  server.current = new TestServer();
  requestMock.mockImplementation(async (doc: unknown, vars: Record<string, unknown>) => {
    if (operation(doc) === "PrincipalDevices") {
      return {
        principalDevices: server.current.principalDevices(
          principals,
          vars.principalIds as string[],
        ),
      };
    }
    throw new Error(`unexpected ${operation(doc)}`);
  });
});

/** Make the next write of a message row fail, as a full disk would. */
function failNextRowWrite() {
  const original = IDBObjectStore.prototype.put;
  let failed = false;
  return vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    this: IDBObjectStore,
    value: unknown,
    key?: IDBValidKey,
  ) {
    if (!failed && this.name === "messages") {
      failed = true;
      throw new DOMException("the disk is full", "QuotaExceededError");
    }
    return original.call(this, value, key);
  });
}

async function principal(seed: number) {
  const p = await TestPrincipal.create(seed);
  principals.push(p);
  return p;
}

/** Alice's browser creates the conversation's group with Bob's; Bob joins from the Welcome. */
async function aliceAndBob() {
  const s = server.current;
  const alice = await TestDevice.create(await principal(1), "u-alice", 0x11);
  const bob = await TestDevice.create(await principal(2), "u-bob", 0x21);
  const commit = await commands.createGroup(alice.account, WS, CONVERSATION, 1, [
    await bob.keyPackage(),
  ]);
  expect(s.submit(commit)).toBe(true);
  await commands.settleCommit(alice.account, alice.ref.principalId, WS, CONVERSATION, true);
  const welcome = s.welcomeFor(bob);
  const joined = await commands.join(bob.account, WS, CONVERSATION, 1, welcome.message);
  expect(joined).toMatchObject({ incarnation: 1, joinEpoch: 1, hasGroup: true, epoch: 1 });
  return { s, alice, bob };
}

/** Send `body` from `from` the way the runtime does: encrypt and store, deliver, settle. */
async function send(s: TestServer, from: TestDevice, body: string) {
  const out = await from.encrypt(body);
  const message = s.deliver(from, out);
  expect(message).not.toBeNull();
  await commands.settleMessage(from.account, out.messageId, message);
  return out.messageId;
}

// The stores these tests use are sealed under the unlocked account.
beforeEach(() => unlockTestVault());

describe("the web backend against a simulated server", () => {
  it("decrypts a message once into its plaintext row", async () => {
    const { s, alice, bob } = await aliceAndBob();
    const id = await send(s, alice, "hi bob");

    const notes = await bob.sync(s);
    expect(notes[0].decrypted.map((d) => d.body)).toEqual(["hi bob"]);
    expect(await bob.row(id)).toMatchObject({
      id,
      text: "hi bob",
      e2ee: { status: "decrypted", epoch: 1, senderPrincipalId: alice.ref.principalId, rev: 0 },
    });
    expect((await bob.row(id))?.e2ee?.content).toContain('"body":"hi bob"');

    // The same entry again is skipped; the key it used is gone either way.
    expect((await bob.sync(s))[0]?.decrypted ?? []).toEqual([]);
    expect((await bob.timeline()).map((m) => m.text)).toEqual(["hi bob"]);
  });

  it("refreshes attachment metadata without decrypting the same ciphertext twice", async () => {
    const { s, alice, bob } = await aliceAndBob();
    const blob = await encryptAttachment(new Uint8Array([1, 2, 3]), "photo.png", "image/png");
    const out = await commands.encryptMessage(alice.account, WS, CONVERSATION, {
      body: "a picture",
      attachments: [blob.blobSha256],
      authorId: alice.userId,
      author: alice.author(),
    });
    expect(s.deliver(alice, out)).not.toBeNull();
    await bob.sync(s);
    expect((await bob.row(out.messageId))?.attachments).toMatchObject([
      { status: "PENDING_UPLOAD", filename: "photo.png" },
    ]);
    s.tamper(out.messageId, (message) => {
      message.hasAttachments = true;
      message.attachments = [
        {
          id: "att-ready",
          blobSha256: blob.blobSha256,
          status: "READY",
          filename: "encrypted",
          contentType: "application/octet-stream",
          sizeBytes: blob.blob.length,
        },
      ];
    });
    await bob.sync(s);
    expect(await bob.row(out.messageId)).toMatchObject({
      text: "a picture",
      e2ee: { status: "decrypted" },
      attachments: [
        { id: "att-ready", filename: "photo.png", contentType: "image/png", status: "READY" },
      ],
    });
  });

  it("keeps every record sealed, and reads nothing while the account is locked", async () => {
    const { s, alice, bob } = await aliceAndBob();
    const id = await send(s, alice, "sealed for bob");
    await bob.sync(s);

    const db = await database();
    const names = [...db.objectStoreNames];
    const tx = db.transaction(names, "readonly");
    const stored = await Promise.all(names.map((name) => done(tx.objectStore(name).getAll())));
    const text = JSON.stringify(stored);
    expect(text).not.toContain("sealed for bob");
    // The index fields stay plain, so the timeline still finds the row by conversation and time.
    expect(text).toContain(id);
    expect((await bob.timeline()).map((m) => m.text)).toEqual(["sealed for bob"]);

    lockVault();
    closeStores();
    await expect(bob.timeline()).rejects.toThrow();
  });

  it("keeps the sender's plaintext and takes the server's fields when its message comes back", async () => {
    const { s, alice } = await aliceAndBob();
    const out = await alice.encrypt("from alice");
    expect(await alice.row(out.messageId)).toMatchObject({ text: "from alice" });
    const message = s.deliver(alice, out);
    await commands.settleMessage(alice.account, out.messageId, message);
    await alice.sync(s);
    expect(await alice.row(out.messageId)).toMatchObject({
      text: "from alice",
      sentAt: message?.sentAt,
      e2ee: { status: "decrypted", senderDeviceId: alice.account.deviceId },
    });
  });

  it("stores a message that breaks a rule without its content", async () => {
    const { s, alice, bob } = await aliceAndBob();
    const out = await alice.encrypt("moved by the server");
    const moved = "0199d1a0-0000-7000-8000-00000000ab01";
    s.deliver(alice, out, { asId: moved });
    await bob.sync(s);
    const row = await bob.row(moved);
    expect(row?.text).toBe("");
    expect(row?.e2ee?.status).toBe("invalid");
  });

  it("shows entries from before a device joined as placeholders, collapsed in the timeline", async () => {
    const { s, alice, bob } = await aliceAndBob();
    const early = await send(s, alice, "before carol");
    await bob.sync(s);
    const carol = await TestDevice.create(await principal(3), "u-carol", 0x31);
    const commit = await commands.commit(
      alice.account,
      WS,
      CONVERSATION,
      [await carol.keyPackage()],
      [],
    );
    expect(s.submit(commit)).toBe(true);
    await commands.settleCommit(alice.account, alice.ref.principalId, WS, CONVERSATION, true);
    await commands.join(carol.account, WS, CONVERSATION, 1, s.welcomeFor(carol).message);
    const late = await send(s, alice, "after carol");

    await carol.sync(s);
    expect((await carol.row(early))?.e2ee?.status).toBe("undecryptable");
    expect((await carol.row(late))?.text).toBe("after carol");
    await bob.sync(s);
    expect((await bob.row(late))?.text).toBe("after carol");

    s.plaintext("0199d1a0-0000-7000-8000-00000000ab02", alice, "plaintext before encryption");
    await carol.sync(s);
    const timeline = withEncryptionNotices(await carol.timeline(), {
      encryptedAt: "2026-10-09T10:00:00Z",
      resets: [],
      userOfPrincipal: () => undefined,
    });
    expect(timeline.map((m) => m.e2eeNotice?.kind ?? m.text)).toEqual([
      "encryptedFrom",
      "earlier",
      "after carol",
      "plaintext before encryption",
    ]);
  });

  it("rolls the engine back when the write fails, so the message decrypts on the next sync", async () => {
    const { s, alice, bob } = await aliceAndBob();
    const id = await send(s, alice, "decrypt me once");
    const put = failNextRowWrite();
    await expect(bob.sync(s)).rejects.toMatchObject({ code: "CACHE_STORAGE" });
    put.mockRestore();
    expect(await bob.row(id)).toBeNull();

    await bob.sync(s);
    expect((await bob.row(id))?.text).toBe("decrypt me once");
  });

  it("sends nothing and keeps nothing when the plaintext cannot be stored", async () => {
    const { s, alice, bob } = await aliceAndBob();
    const put = failNextRowWrite();
    await expect(alice.encrypt("not stored")).rejects.toBeInstanceOf(E2eeCommandError);
    put.mockRestore();
    expect(await alice.timeline()).toEqual([]);

    const id = await send(s, alice, "stored");
    await bob.sync(s);
    expect((await bob.row(id))?.text).toBe("stored");
  });

  it("keeps the state across a reload of the page", async () => {
    const { s, alice, bob } = await aliceAndBob();
    closeStores();
    const id = await send(s, alice, "after the reload");
    await bob.sync(s);
    expect((await bob.row(id))?.text).toBe("after the reload");
  });

  it("sends a stale message again with the same id in the new epoch", async () => {
    const { s, alice, bob } = await aliceAndBob();
    const out = await alice.encrypt("stale at first");
    const update = await commands.commit(bob.account, WS, CONVERSATION, [], []);
    expect(s.submit(update)).toBe(true);
    await commands.settleCommit(bob.account, bob.ref.principalId, WS, CONVERSATION, true);
    expect(s.deliver(alice, out)).toBeNull();

    const processed = await commands.processCommits(alice.account, WS, CONVERSATION, s.commits);
    expect(processed.step).toBe("applied");
    const again = await commands.reencryptMessage(alice.account, out.messageId);
    expect(again).toMatchObject({ messageId: out.messageId, epoch: 2 });
    const message = s.deliver(alice, again);
    await commands.settleMessage(alice.account, out.messageId, message);
    await bob.sync(s);
    expect((await bob.row(out.messageId))?.text).toBe("stale at first");
  });

  it("gives a refused message's body back and puts a refused edit's text back", async () => {
    const { s, alice } = await aliceAndBob();
    const out = await alice.encrypt("refused");
    expect(await commands.settleMessage(alice.account, out.messageId, null)).toEqual({
      unsentBody: "refused",
    });
    expect(await alice.row(out.messageId)).toBeNull();

    const id = await send(s, alice, "original");
    await commands.encryptMessage(alice.account, WS, CONVERSATION, {
      editOf: id,
      body: "edited",
      authorId: alice.userId,
      author: alice.author(),
    });
    expect((await alice.row(id))?.text).toBe("edited");
    await commands.settleMessage(alice.account, id, null);
    expect((await alice.row(id))?.text).toBe("original");
  });

  it("carries an edit as the whole message at a higher revision", async () => {
    const { s, alice, bob } = await aliceAndBob();
    const id = await send(s, alice, "first");
    await bob.sync(s);
    const edit = await commands.encryptMessage(alice.account, WS, CONVERSATION, {
      editOf: id,
      body: "second",
      authorId: alice.userId,
      author: alice.author(),
    });
    expect(edit.messageId).toBe(id);
    s.deliver(alice, edit);
    await bob.sync(s);
    expect(await bob.row(id)).toMatchObject({ text: "second", e2ee: { rev: 1 } });
  });

  it("re-adds a device that lost its state; what was sent meanwhile stays unreadable there", async () => {
    const { s, alice, bob } = await aliceAndBob();
    const before = await send(s, alice, "before the loss");
    await bob.sync(s);

    const request = await commands.readdRequest(
      bob.account,
      bob.ref.principalId,
      WS,
      CONVERSATION,
      1,
    );
    expect(request.payload).toContain('"type":"mls-readd"');
    expect((await commands.status(bob.account, WS, [CONVERSATION]))[0]).toMatchObject({
      hasGroup: false,
      readdRequestedAt: expect.any(Number),
    });
    const missed = await send(s, alice, "while bob waits");
    const notes = await bob.sync(s);
    expect(notes[0].stopped).toEqual({ kind: "awaitingReadd", incarnation: 1, epoch: null });

    const directory = {
      members: [alice.ref.principalId, bob.ref.principalId],
      principals: [bob.principal.directory()],
    };
    const honorable = await commands.readdCheck(
      alice.account,
      WS,
      CONVERSATION,
      [{ ...bob.ref, request }],
      directory,
    );
    expect(honorable).toEqual([bob.ref]);
    const commit = await commands.commit(
      alice.account,
      WS,
      CONVERSATION,
      [await bob.keyPackage()],
      [bob.ref],
    );
    expect(s.submit(commit)).toBe(true);
    await commands.settleCommit(alice.account, alice.ref.principalId, WS, CONVERSATION, true, [
      bob.ref,
    ]);
    // Honored once a day: the same request is not acted on again.
    expect(
      await commands.readdCheck(
        alice.account,
        WS,
        CONVERSATION,
        [{ ...bob.ref, request }],
        directory,
      ),
    ).toEqual([]);

    await commands.join(bob.account, WS, CONVERSATION, 1, s.welcomeFor(bob).message);
    const after = await send(s, alice, "welcome back");
    await bob.sync(s);
    expect((await bob.row(before))?.text).toBe("before the loss");
    expect((await bob.row(missed))?.e2ee?.status).toBe("undecryptable");
    expect((await bob.row(after))?.text).toBe("welcome back");
  });

  it("checks leaves against key logs and certificates, and stops sending beside one that fails", async () => {
    const { s, alice, bob } = await aliceAndBob();
    const directory = {
      members: [alice.ref.principalId, bob.ref.principalId],
      principals: [alice.principal.directory(), bob.principal.directory()],
    };
    expect(await commands.verify(alice.account, WS, CONVERSATION, directory)).toEqual({
      missing: [],
      unverified: [],
    });
    // Remembered now: nothing needs fetching.
    expect(
      await commands.verify(alice.account, WS, CONVERSATION, {
        members: directory.members,
        principals: [],
      }),
    ).toEqual({ missing: [], unverified: [] });

    bob.principal.revoke(bob.account.deviceId);
    const outcome = await commands.verify(alice.account, WS, CONVERSATION, {
      members: directory.members,
      principals: [bob.principal.directory()],
    });
    expect(outcome.unverified).toEqual([{ ...bob.ref, reason: "revokedDevice" }]);
    await expect(alice.encrypt("not while bob's device is revoked")).rejects.toMatchObject({
      code: "E2EE_UNVERIFIED_DEVICE",
    });
    void s;
  });

  it("follows a new incarnation and notes who reset it", async () => {
    const { s, alice, bob } = await aliceAndBob();
    await send(s, alice, "first incarnation");
    await bob.sync(s);
    const next = await commands.createGroup(alice.account, WS, CONVERSATION, 2, [
      await bob.keyPackage(),
    ]);
    s.incarnation = 2;
    s.epoch = 0;
    expect(s.submit(next)).toBe(true);
    const settled = await commands.settleCommit(
      alice.account,
      alice.ref.principalId,
      WS,
      CONVERSATION,
      true,
    );
    expect(settled).toMatchObject({ incarnation: 2, resets: [{ incarnation: 2 }] });
    const joined = await commands.join(bob.account, WS, CONVERSATION, 2, s.welcomeFor(bob).message);
    expect(joined.resets).toEqual([{ incarnation: 2, ...alice.ref }]);
    const id = await send(s, alice, "second incarnation");
    await bob.sync(s);
    expect((await bob.row(id))?.text).toBe("second incarnation");
  });

  it("refuses a Welcome for an older incarnation as a stale one", async () => {
    const { s, bob } = await aliceAndBob();
    await expect(
      commands.join(bob.account, WS, CONVERSATION, 0, s.welcomeFor(bob).message),
    ).rejects.toMatchObject({ code: expect.stringMatching(/INVALID_ARGS|E2EE_MLS/) });
  });

  it("is what the encryption commands reach for a web account", async () => {
    const { alice } = await aliceAndBob();
    const [view] = await e2eeCommands.status(alice.account, WS, []);
    expect(view).toMatchObject({ conversationId: CONVERSATION, hasGroup: true, epoch: 1 });
  });

  it("tombstones a deleted message's plaintext", async () => {
    const { s, alice, bob } = await aliceAndBob();
    const id = await send(s, alice, "soon gone");
    await bob.sync(s);
    s.delete(id);
    await bob.sync(s);
    expect(await bob.row(id)).toMatchObject({ isDeleted: true, text: "" });
    expect(await bob.timeline()).toEqual([]);
  });
});
