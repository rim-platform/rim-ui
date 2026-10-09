import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CONVERSATION,
  loadMlsModule,
  TestDevice,
  TestPrincipal,
  TestServer,
  WS,
} from "../../../test/e2eeWorld";

const requestMock = vi.hoisted(() => vi.fn());
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));

import type { DirectoryInput } from "../api/e2eeCommands";
import { applyCommit, emptyState } from "./groupState";
import type { MlsEngine } from "./mlsModule";
import { webE2eeCommands as commands, closeStores } from "./webCommands";

const principals: TestPrincipal[] = [];
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
    if (/query\s+PrincipalDevices/.test(String(doc))) {
      return {
        principalDevices: server.current.principalDevices(
          principals,
          vars.principalIds as string[],
        ),
      };
    }
    throw new Error(`unexpected request ${String(doc).slice(0, 40)}`);
  });
});

async function principal(seed: number) {
  const p = await TestPrincipal.create(seed);
  principals.push(p);
  return p;
}

async function aliceAndBob(lastResort = false) {
  const s = server.current;
  const alice = await TestDevice.create(await principal(1), "u-alice", 0x11);
  const bob = await TestDevice.create(await principal(2), "u-bob", 0x21);
  const claimed = lastResort ? await bob.lastResortKeyPackage() : await bob.keyPackage();
  const commit = await commands.createGroup(alice.account, WS, CONVERSATION, 1, [claimed]);
  expect(s.submit(commit)).toBe(true);
  await commands.settleCommit(alice.account, alice.ref.principalId, WS, CONVERSATION, true);
  await commands.join(bob.account, WS, CONVERSATION, 1, s.welcomeFor(bob).message);
  return { s, alice, bob };
}

async function send(s: TestServer, from: TestDevice, body: string) {
  const out = await from.encrypt(body);
  const message = s.deliver(from, out);
  await commands.settleMessage(from.account, out.messageId, message);
  return out.messageId;
}

/** Commit `adds` and `removes` from `by`, accepted by the server. */
async function commitFrom(
  s: TestServer,
  by: TestDevice,
  adds: Awaited<ReturnType<TestDevice["keyPackage"]>>[],
  removes: { principalId: string; deviceId: string }[] = [],
) {
  const commit = await commands.commit(by.account, WS, CONVERSATION, adds, removes);
  expect(s.submit(commit)).toBe(true);
  await commands.settleCommit(by.account, by.ref.principalId, WS, CONVERSATION, true);
}

function directory(devices: TestDevice[], members = devices): DirectoryInput {
  return {
    members: members.map((d) => d.ref.principalId),
    principals: devices.map((d) => d.principal.directory()),
  };
}

describe("the web backend against a misbehaving server", () => {
  it("finding 1: a conversation stays pinned as encrypted, through forget and the feed", async () => {
    const { s, alice, bob } = await aliceAndBob();
    const [held] = await commands.status(bob.account, WS, [CONVERSATION]);
    expect(held).toMatchObject({ pinned: true, pinnedEncryptedAt: null });

    await commands.pin(bob.account, WS, CONVERSATION, "2026-10-09T00:00:00Z", null);
    const later = await commands.pin(bob.account, WS, CONVERSATION, "2030-01-01T00:00:00Z", null);
    expect(later.pinnedEncryptedAt).toBe("2026-10-09T00:00:00Z");

    await commands.forget(bob.account, WS, CONVERSATION);
    const [forgotten] = await commands.status(bob.account, WS, []);
    expect(forgotten).toMatchObject({
      conversationId: CONVERSATION,
      pinned: true,
      hasGroup: false,
      pinnedEncryptedAt: "2026-10-09T00:00:00Z",
    });

    // A browser that only ever saw an encrypted entry pins the conversation too.
    const other = await TestDevice.create(alice.principal, "u-alice", 0x12);
    await send(s, alice, "seen elsewhere");
    await other.sync(s, { inGroup: false });
    const [seen] = await commands.status(other.account, WS, [CONVERSATION]);
    expect(seen.pinned).toBe(true);
  });

  it("finding 4: a direct message is pinned to its two principals", async () => {
    const { s, alice, bob } = await aliceAndBob();
    const carol = await TestDevice.create(await principal(3), "u-carol", 0x31);
    const pair = [alice.ref.principalId, bob.ref.principalId];
    const pinned = await commands.pin(bob.account, WS, CONVERSATION, null, pair);
    expect(pinned.dmPrincipals).toEqual([...pair].sort());
    await expect(
      commands.pin(bob.account, WS, CONVERSATION, null, [...pair, carol.ref.principalId]),
    ).rejects.toMatchObject({ code: "INVALID_ARGS" });
    const again = await commands.pin(bob.account, WS, CONVERSATION, null, [
      alice.ref.principalId,
      carol.ref.principalId,
    ]);
    expect(again.dmPrincipals).toEqual([...pair].sort());

    // Alice's device adds Carol, whom the server lists as a member: Bob does not take her leaf.
    await commitFrom(s, alice, [await carol.keyPackage()]);
    await bob.sync(s);
    const outcome = await commands.verify(
      bob.account,
      WS,
      CONVERSATION,
      directory([alice, bob, carol]),
    );
    expect(outcome.unverified).toEqual([{ ...carol.ref, reason: "notMember" }]);
  });

  it("finding 4: adds and removes come from the Commits this browser processed", async () => {
    const { s, alice, bob } = await aliceAndBob();
    const carol = await TestDevice.create(await principal(3), "u-carol", 0x31);
    await commitFrom(s, alice, [await carol.keyPackage()]);
    await commitFrom(s, alice, [], [carol.ref]);
    // A second device of a principal already in the group is not a member added.
    const bobPhone = await TestDevice.create(bob.principal, "u-bob", 0x22);
    await commitFrom(s, alice, [await bobPhone.keyPackage()]);
    await bob.sync(s);

    const expected = [
      { incarnation: 1, epoch: 2, kind: "added", principalId: carol.ref.principalId },
      { incarnation: 1, epoch: 3, kind: "removed", principalId: carol.ref.principalId },
    ];
    const [byAlice] = await commands.status(alice.account, WS, [CONVERSATION]);
    const [byBob] = await commands.status(bob.account, WS, [CONVERSATION]);
    expect(byAlice.membership).toEqual(expected);
    expect(byBob.membership).toEqual(expected);
  });

  it("finding 5: a row must name its author principal and the MLS sender's device", async () => {
    const { s, alice, bob } = await aliceAndBob();
    const nameless = await send(s, alice, "who am i");
    s.tamper(nameless, (m) => {
      (m.author as Record<string, unknown>).principalId = null;
    });
    const moved = await send(s, alice, "from another device");
    s.tamper(moved, (m) => {
      (m.encryption as Record<string, unknown>).senderDeviceId =
        "0199d1a0-0000-7000-8000-0000000000ee";
    });
    const claimed = await send(s, alice, "claimed by bob");
    s.tamper(claimed, (m) => {
      (m.author as Record<string, unknown>).principalId = bob.ref.principalId;
    });
    const honest = await send(s, alice, "honest");
    await bob.sync(s);

    for (const [id, reason] of [
      [nameless, "the row names no author principal"],
      [moved, "the sender device is not the row's"],
      [claimed, "the sender is not the row's author"],
    ]) {
      expect(await bob.row(id), reason).toMatchObject({
        text: "",
        e2ee: { status: "invalid", reason },
      });
    }
    expect(await bob.row(honest)).toMatchObject({
      text: "honest",
      e2ee: { senderPrincipalId: alice.ref.principalId, senderDeviceId: alice.account.deviceId },
    });
  });

  it("finding 6: a replayed Welcome is refused and keeps the group", async () => {
    const { s, alice, bob } = await aliceAndBob(true);
    const welcome = s.welcomeFor(bob).message;
    await expect(commands.join(bob.account, WS, CONVERSATION, 1, welcome)).rejects.toMatchObject({
      code: "E2EE_STALE_WELCOME",
    });
    await commitFrom(s, alice, []);
    await bob.sync(s);
    await expect(commands.join(bob.account, WS, CONVERSATION, 1, welcome)).rejects.toMatchObject({
      code: "E2EE_STALE_WELCOME",
    });
    const [held] = await commands.status(bob.account, WS, [CONVERSATION]);
    expect(held.epoch).toBe(2);
    const after = await send(s, alice, "still in step");
    await bob.sync(s);
    expect((await bob.row(after))?.text).toBe("still in step");
  });

  it("finding 11: a key log must extend the head pinned here", async () => {
    const { alice, bob } = await aliceAndBob();
    const check = async (alicePrincipal: ReturnType<TestPrincipal["directory"]>) =>
      (
        await commands.verify(bob.account, WS, CONVERSATION, {
          members: [alice.ref.principalId, bob.ref.principalId],
          principals: [alicePrincipal, bob.principal.directory()],
        })
      ).unverified.map((u) => u.reason);

    const original = { ...alice.principal.directory(), keyLog: [...alice.principal.keyLog] };
    expect(await check(original)).toEqual([]);
    // A fork at seq 1, made with the identity key of seq 0.
    const fork = [...original.keyLog, await alice.principal.rotation(78, original.keyLog)];
    await alice.principal.rotate(77);
    expect(await check(alice.principal.directory())).toEqual([]);
    // The older prefix and the fork are both refused; the extended log still verifies.
    expect(await check(original)).toEqual(["keyLogForked"]);
    expect(await check({ ...original, keyLog: fork })).toEqual(["keyLogForked"]);
    expect(await check(alice.principal.directory())).toEqual([]);
  });

  it("finding 2: a signed revocation is verified and remembered", async () => {
    const { alice, bob } = await aliceAndBob();
    const devices = () => directory([alice, bob]);
    const aliceDevice = alice.principal.devices[0];

    // A revocation nobody with a key signed keeps the device out this time only.
    aliceDevice.revocation = await bob.principal.signedRevocation(aliceDevice.deviceId);
    expect((await commands.verify(bob.account, WS, CONVERSATION, devices())).unverified).toEqual([
      { ...alice.ref, reason: "revokedDevice" },
    ]);
    aliceDevice.revocation = null;
    expect((await commands.verify(bob.account, WS, CONVERSATION, devices())).unverified).toEqual(
      [],
    );

    // One the identity key signed stays, though the server stops listing it.
    aliceDevice.revocation = await alice.principal.signedRevocation(aliceDevice.deviceId);
    await commands.verify(bob.account, WS, CONVERSATION, devices());
    aliceDevice.revocation = null;
    expect((await commands.verify(bob.account, WS, CONVERSATION, devices())).unverified).toEqual([
      { ...alice.ref, reason: "revokedDevice" },
    ]);
  });

  it("finding 20: a Commit refused for breaking a rule names its committer and waits for a re-add", () => {
    const committer = { principalId: "rimp1_mallory", deviceId: "dev-m" };
    const engine = {
      groupStatus: () => JSON.stringify({ epoch: 4, commitPending: false, awaitingReadd: null }),
      processCommit: () =>
        JSON.stringify({ kind: "cannotProcess", reason: "the summary lies", committer }),
    } as unknown as MlsEngine;
    const state = { ...emptyState(), incarnation: 1 };
    const step = applyCommit(engine, state, CONVERSATION, {
      incarnation: 1,
      epoch: 4,
      message: "commit",
    });
    expect(step).toBe("cannotProcess");
    expect(state.misbehaved).toEqual(committer);
    expect(state.membership).toEqual([]);
  });
});
