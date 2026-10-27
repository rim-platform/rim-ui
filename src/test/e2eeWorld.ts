/**
 * The web app's encryption against a simulated server, for tests: the MLS module loaded from its
 * file, accounts with key logs and certified browser device keys, and a server that sequences
 * Commits, keeps Welcomes and the change feed, and answers `principalDevices`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { MessageChangesInput } from "../core/graphql/generated/schema-types";
import { insert } from "../features/key-identity/browser/keyStore";
import {
  CONTEXT,
  payloadHash,
  principalId,
  sign,
  type Statement,
} from "../features/key-identity/browser/statements";
import type {
  FeedConversationChanges,
  MlsSyncInput,
  MlsSyncNote,
} from "../features/messages/api/messageCache";
import type { OutgoingCommit, OutgoingMessage } from "../features/e2ee/api/e2eeCommands";
import { initSync } from "../features/e2ee/wasm/rim_mls_wasm";
import type { WebAccount } from "../features/e2ee/web/webAccount";
import { webE2eeCommands, webMessageStore } from "../features/e2ee/web/webCommands";
import { keyFromSeed } from "./ed25519";

export const ENDPOINT = "http://localhost:8080/api";
export const WS = "0199d1a0-0000-7000-8000-0000000000f0";
export const CONVERSATION = "0199d1a0-0000-7000-8000-0000000000c1";

/** Load the committed MLS module into this test process (run from the repository root). */
export function loadMlsModule() {
  initSync({
    module: readFileSync(join(process.cwd(), "src/features/e2ee/wasm/rim_mls_wasm_bg.wasm")),
  });
}

/** An account: its key log, and its devices' certificates as the server lists them. */
export class TestPrincipal {
  readonly devices: {
    deviceId: string;
    name: string;
    certificate: Statement;
    revokedAt: string | null;
    revocation: Statement | null;
    mlsActive: boolean;
  }[] = [];

  private constructor(
    readonly principalId: string,
    readonly keyLog: Statement[],
    private identity: CryptoKey,
    private readonly recoveryKey: string,
  ) {}

  static async create(seed: number): Promise<TestPrincipal> {
    const identity = await keyFromSeed(seed);
    const recovery = await keyFromSeed(seed + 100);
    const payload = JSON.stringify({
      v: 2,
      type: "inception",
      seq: 0,
      identityKey: identity.publicKey,
      recoveryKey: recovery.publicKey,
      createdAt: "2026-10-09T00:00:00Z",
    });
    const inception = await sign(identity.privateKey, CONTEXT.keyLog, payload);
    return new TestPrincipal(
      await principalId(payload),
      [inception],
      identity.privateKey,
      recovery.publicKey,
    );
  }

  /** An identity rotation to the key of `seed`, extending `log` (the key log by default). */
  async rotation(seed: number, log: Statement[] = this.keyLog): Promise<Statement> {
    const next = await keyFromSeed(seed);
    const head = log[log.length - 1];
    const payload = JSON.stringify({
      v: 2,
      type: "rotate",
      principalId: this.principalId,
      seq: log.length,
      prev: await payloadHash(head.payload),
      identityKey: next.publicKey,
      recoveryKey: this.recoveryKey,
      signer: "identity",
      createdAt: "2026-10-09T00:00:00Z",
    });
    return sign(this.identity, CONTEXT.keyLog, payload);
  }

  /** Rotate the identity key to the key of `seed`; devices certified before stay. */
  async rotate(seed: number) {
    this.keyLog.push(await this.rotation(seed));
    this.identity = (await keyFromSeed(seed)).privateKey;
  }

  /** A revocation of `deviceId` signed by the current identity key. */
  signedRevocation(deviceId: string): Promise<Statement> {
    const payload = JSON.stringify({
      v: 2,
      type: "device-revoke",
      principalId: this.principalId,
      deviceId,
      signer: "identity",
      issuedAt: "2026-10-09T01:00:00Z",
    });
    return sign(this.identity, CONTEXT.deviceRevoke, payload);
  }

  async certify(deviceId: string, deviceKey: string) {
    const payload = JSON.stringify({
      v: 2,
      type: "device",
      principalId: this.principalId,
      deviceId,
      deviceKey,
      name: `Browser ${deviceId.slice(-2)}`,
      keySeq: 0,
      issuedAt: "2026-10-09T00:00:00Z",
    });
    this.devices.push({
      deviceId,
      name: `Browser ${deviceId.slice(-2)}`,
      certificate: await sign(this.identity, CONTEXT.device, payload),
      revokedAt: null,
      revocation: null,
      mlsActive: true,
    });
  }

  revoke(deviceId: string) {
    const device = this.devices.find((d) => d.deviceId === deviceId);
    if (device) device.revokedAt = "2026-10-09T01:00:00Z";
  }

  /** What `directoryFor` hands the backend for this principal. */
  directory() {
    return { principalId: this.principalId, keyLog: this.keyLog, devices: this.devices };
  }
}

/** A browser of `principal`: its device key in the key store, and its web account. */
export class TestDevice {
  private constructor(
    readonly principal: TestPrincipal,
    readonly userId: string,
    readonly account: WebAccount,
  ) {}

  static async create(principal: TestPrincipal, userId: string, n: number): Promise<TestDevice> {
    const deviceId = `0199d1a0-0000-7000-8000-0000000000${n.toString(16).padStart(2, "0")}`;
    const key = await keyFromSeed(n);
    await principal.certify(deviceId, key.publicKey);
    await insert({
      v: 1,
      endpoint: ENDPOINT,
      principalId: principal.principalId,
      deviceId,
      deviceName: "Test browser",
      deviceKey: key.privateKey,
      confirmed: true,
      userId,
      username: userId,
    });
    const account: WebAccount = {
      endpoint: ENDPOINT,
      userId,
      principalId: principal.principalId,
      deviceId,
      web: true,
    };
    const device = new TestDevice(principal, userId, account);
    await webE2eeCommands.ensureIdentity(account, principal.principalId);
    await webMessageStore.track(account, WS, CONVERSATION);
    return device;
  }

  get ref() {
    return { principalId: this.principal.principalId, deviceId: this.account.deviceId };
  }

  /** One fresh one-time key package, as `claimMlsKeyPackages` would hand it out. */
  async keyPackage() {
    const [keyPackage] = await webE2eeCommands.keyPackages(
      this.account,
      {
        cipherSuite: 0x4f,
        available: 20,
        lastResortNotAfter: "2036-01-01T00:00:00Z",
        lastResortClaims: 0,
      },
      1,
    );
    return { ...this.ref, keyPackage };
  }

  /** A last-resort key package: its private key stays after a join. */
  async lastResortKeyPackage() {
    const packages = await webE2eeCommands.keyPackages(this.account, {
      cipherSuite: 0x4f,
      available: 20,
      lastResortNotAfter: null,
      lastResortClaims: 0,
    });
    return { ...this.ref, keyPackage: packages[packages.length - 1] };
  }

  author() {
    return { id: this.userId, username: this.userId, displayName: null, avatarUrl: null };
  }

  /** Encrypt `body` as a new message and store its plaintext. */
  encrypt(body: string, extra: { threadRootId?: string; threadId?: string } = {}) {
    return webE2eeCommands.encryptMessage(this.account, WS, CONVERSATION, {
      body,
      ...extra,
      authorId: this.userId,
      author: this.author(),
    });
  }

  /** Read the feed into the store until it is drained, as the runtime's sync loop does. */
  async sync(server: TestServer, input?: Partial<MlsSyncInput>): Promise<MlsSyncNote[]> {
    const notes: MlsSyncNote[] = [];
    let request = await webMessageStore.begin(this.account, WS, [CONVERSATION]);
    while (request) {
      const step = await webMessageStore.apply(this.account, WS, server.respond(request), [
        { ...server.input(), ...input },
      ]);
      notes.push(...step.e2ee);
      request = step.next;
    }
    return notes;
  }

  row(id: string) {
    return webMessageStore.message(this.account, id);
  }

  async timeline() {
    return (await webMessageStore.timeline(this.account, WS, CONVERSATION, null, 50))?.items ?? [];
  }
}

interface FeedRow {
  version: number;
  message: Record<string, unknown>;
  /** When the envelope was last replaced; absent for a message never edited. */
  editedAt?: string;
}

/** The server's side of one conversation: sequencing, Welcomes, the feed. */
export class TestServer {
  incarnation = 1;
  /** The epoch the next Commit must be made in. */
  epoch = 0;
  readonly commits: { incarnation: number; epoch: number; message: string }[] = [];
  readonly welcomes = new Map<string, { incarnation: number; message: string }>();
  private readonly rows = new Map<string, FeedRow>();
  private version = 0;
  private sentAt = Date.parse("2026-10-09T10:00:00Z");

  /** Accept a Commit made in the current epoch; `false` is `STALE_EPOCH`. */
  submit(commit: OutgoingCommit): boolean {
    if (commit.incarnation !== this.incarnation || commit.epoch !== this.epoch) return false;
    this.commits.push({
      incarnation: commit.incarnation,
      epoch: commit.epoch,
      message: commit.commit,
    });
    this.epoch += 1;
    for (const add of commit.adds) {
      if (commit.welcome) {
        this.welcomes.set(add.deviceId, {
          incarnation: commit.incarnation,
          message: commit.welcome,
        });
      }
    }
    return true;
  }

  welcomeFor(device: TestDevice) {
    const welcome = this.welcomes.get(device.account.deviceId);
    if (!welcome) throw new Error("no Welcome for this device");
    return welcome;
  }

  /**
   * Accept a message made in the current epoch (`null` is `STALE_EPOCH`), filed under `asId`
   * when given (a server moving a ciphertext to another row).
   */
  deliver(
    from: TestDevice,
    out: OutgoingMessage,
    options: { asId?: string; threadId?: string } = {},
  ): Record<string, unknown> | null {
    if (out.incarnation !== this.incarnation || out.epoch !== this.epoch) return null;
    this.sentAt += 1000;
    const id = options.asId ?? out.messageId;
    const existing = this.rows.get(id);
    const sentAt = existing ? String(existing.message.sentAt) : new Date(this.sentAt).toISOString();
    const message = {
      id,
      serverId: WS,
      conversationId: CONVERSATION,
      threadId: options.threadId ?? null,
      rootThreadId: null,
      authorId: from.userId,
      author: { ...from.author(), principalId: from.principal.principalId },
      text: null,
      hasAttachments: false,
      parentMessageId: null,
      isPinned: false,
      isDeleted: false,
      mentionedUserIds: [],
      forwardedFromMessageId: null,
      forwardedFrom: null,
      sentAt,
      reactions: [],
      attachments: [],
      linkPreviews: [],
      encryption: {
        incarnation: out.incarnation,
        epoch: out.epoch,
        senderDeviceId: from.account.deviceId,
        ciphertext: out.envelope,
        frankingReceipt: "cmVjZWlwdA",
        frankingKeyId: 1,
        sentAtUs: String(Date.parse(sentAt) * 1000),
      },
    };
    this.version += 1;
    this.rows.set(id, {
      version: this.version,
      message,
      editedAt: existing ? new Date(this.sentAt).toISOString() : undefined,
    });
    return message;
  }

  /** When the server last replaced message `id`'s envelope; null for a message never edited. */
  editedAt(id: string): string | null {
    return this.rows.get(id)?.editedAt ?? null;
  }

  /** A plaintext message from before the conversation was encrypted. */
  plaintext(id: string, author: TestDevice, text: string) {
    this.sentAt += 1000;
    this.version += 1;
    this.rows.set(id, {
      version: this.version,
      message: {
        id,
        serverId: WS,
        conversationId: CONVERSATION,
        threadId: null,
        authorId: author.userId,
        author: author.author(),
        text,
        isDeleted: false,
        sentAt: new Date(this.sentAt).toISOString(),
        reactions: [],
        attachments: [],
        linkPreviews: [],
        encryption: null,
      },
    });
  }

  /** Change a row's message in place, as a misbehaving server might, with a new version. */
  tamper(id: string, change: (message: Record<string, unknown>) => void) {
    const row = this.rows.get(id);
    if (!row) return;
    const message = structuredClone(row.message);
    change(message);
    this.version += 1;
    this.rows.set(id, { version: this.version, message });
  }

  delete(id: string) {
    const row = this.rows.get(id);
    if (!row) return;
    this.version += 1;
    this.rows.set(id, {
      version: this.version,
      message: {
        ...row.message,
        isDeleted: true,
        encryption: { ...(row.message.encryption as object), ciphertext: null },
      },
    });
  }

  /** The `messageChanges` answer: every row changed after the cursor, oldest first. */
  respond(request: MessageChangesInput): FeedConversationChanges[] {
    return request.conversations.map(({ conversationId, after }) => {
      const since = after ? Number(after) : 0;
      const changes = [...this.rows.values()]
        .filter((r) => r.version > since)
        .sort((a, b) => a.version - b.version)
        .map((r) => ({
          kind: "CREATED" as FeedConversationChanges["changes"][number]["kind"],
          version: String(r.version),
          editedAt: r.editedAt ?? null,
          message: r.message as unknown as FeedConversationChanges["changes"][number]["message"],
        }));
      return {
        conversationId,
        status: "OK" as FeedConversationChanges["status"],
        cursor: String(Math.max(since, ...changes.map((c) => Number(c.version)))),
        hasMore: false,
        changes,
      };
    });
  }

  /** What the runtime fetches for a feed page: the conversation's Commits. */
  input(): MlsSyncInput {
    return { conversationId: CONVERSATION, commits: [...this.commits], threadRoots: {} };
  }

  /** `principalDevices` over the principals the test registered. */
  principalDevices(principals: TestPrincipal[], ids: string[]) {
    return ids.map((id) => ({
      principalId: id,
      devices: principals.find((p) => p.principalId === id)?.devices ?? [],
    }));
  }
}
