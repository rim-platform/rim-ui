import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationTypeEnum } from "../../../core/graphql/generated/schema-types";
import { makeConversation } from "../__fixtures__/conversations";

const create = vi.hoisted(() => ({ createConversation: vi.fn() }));
const session = vi.hoisted(() => ({ e2eeSession: vi.fn() }));
const groups = vi.hoisted(() => ({ allMembersReady: vi.fn(), createGroup: vi.fn() }));
const web = vi.hoisted(() => ({ isWebAccount: vi.fn() }));
const relay = vi.hoisted(() => ({ startDirectConversation: vi.fn() }));
vi.mock("./useCreateConversation", () => create);
vi.mock("../../e2ee/runtime/session", () => session);
vi.mock("../../e2ee/runtime/groups", () => groups);
vi.mock("../../e2ee/web/webAccount", () => web);
vi.mock("../../relay/conversations/startDirect", () => relay);

import { startDirectMessage } from "./startDirectMessage";

const device = { account: {}, userId: "me", principalId: "rimp1_me", deviceId: "d1" };
const toBob = { workspaceId: "ws-1", otherUserId: "u2" };

function dm(overrides: Parameters<typeof makeConversation>[0] = {}) {
  return makeConversation({
    id: "c5",
    title: null,
    conversationType: ConversationTypeEnum.DIRECT,
    memberIds: ["me", "u2"],
    encryptedAt: null,
    ...overrides,
  });
}

/** A promise with its resolver, to hold a step open. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  Object.values({ ...create, ...session, ...groups, ...web, ...relay }).forEach((fn) =>
    fn.mockReset(),
  );
  groups.createGroup.mockResolvedValue(true);
  groups.allMembersReady.mockResolvedValue(false);
  web.isWebAccount.mockReturnValue(false);
});

describe("startDirectMessage in a workspace", () => {
  it("creates an encrypted DM when this device is ready and returns once its group exists", async () => {
    session.e2eeSession.mockResolvedValue(device);
    create.createConversation.mockResolvedValue(
      dm({ memberIds: ["me"], pendingMemberIds: ["u2"], encryptedAt: "2026-10-15T00:00:00Z" }),
    );
    const group = deferred<boolean>();
    groups.createGroup.mockReturnValue(group.promise);
    let settled = false;
    const started = startDirectMessage(toBob).then((result) => {
      settled = true;
      return result;
    });
    await vi.waitFor(() => expect(groups.createGroup).toHaveBeenCalledWith(device, "ws-1", "c5"));
    expect(settled).toBe(false);
    group.resolve(true);
    expect(await started).toEqual({ workspaceId: "ws-1", conversationId: "c5", encrypted: true });
    expect(create.createConversation).toHaveBeenCalledWith({
      serverId: "ws-1",
      otherUserId: "u2",
      encrypted: true,
    });
  });

  it("creates a plaintext DM when this device is not set up for encryption", async () => {
    session.e2eeSession.mockResolvedValue(null);
    create.createConversation.mockResolvedValue(dm({ id: "c6" }));
    expect(await startDirectMessage(toBob)).toEqual({
      workspaceId: "ws-1",
      conversationId: "c6",
      encrypted: false,
    });
    expect(create.createConversation).toHaveBeenCalledWith({ serverId: "ws-1", otherUserId: "u2" });
    expect(groups.createGroup).not.toHaveBeenCalled();
  });

  it("leaves an existing plaintext DM unencrypted while a member is not ready", async () => {
    session.e2eeSession.mockResolvedValue(device);
    create.createConversation.mockResolvedValue(dm({ id: "c7" }));
    expect((await startDirectMessage(toBob)).encrypted).toBe(false);
    expect(groups.allMembersReady).toHaveBeenCalledWith(device, "ws-1", ["u2"]);
    expect(groups.createGroup).not.toHaveBeenCalled();
  });

  it("upgrades an existing plaintext DM from a desktop when everyone is ready", async () => {
    session.e2eeSession.mockResolvedValue(device);
    groups.allMembersReady.mockResolvedValue(true);
    create.createConversation.mockResolvedValue(dm({ id: "c8" }));
    expect((await startDirectMessage(toBob)).encrypted).toBe(true);
    expect(groups.createGroup).toHaveBeenCalledWith(device, "ws-1", "c8");
  });

  it("leaves the upgrade to a desktop: a browser does not create the group", async () => {
    session.e2eeSession.mockResolvedValue(device);
    groups.allMembersReady.mockResolvedValue(true);
    web.isWebAccount.mockReturnValue(true);
    create.createConversation.mockResolvedValue(dm({ id: "c9" }));
    expect((await startDirectMessage(toBob)).encrypted).toBe(false);
    expect(groups.createGroup).not.toHaveBeenCalled();
  });

  it("fails when the group cannot be created, so nothing goes out unencrypted", async () => {
    session.e2eeSession.mockResolvedValue(device);
    create.createConversation.mockResolvedValue(dm({ encryptedAt: "2026-10-15T00:00:00Z" }));
    groups.createGroup.mockRejectedValue(new Error("no key packages"));
    await expect(startDirectMessage(toBob)).rejects.toThrow("no key packages");
  });
});

describe("startDirectMessage in a direct space", () => {
  const bob = { principalId: "rimp1_bob", relayUrls: [], name: "Bob" };

  it("starts the DM with the member and waits for its group", async () => {
    const group = deferred<boolean>();
    relay.startDirectConversation.mockResolvedValue({
      spaceId: "direct-1",
      conversationId: "c10",
      encrypted: true,
      group: group.promise,
    });
    let settled = false;
    const started = startDirectMessage({ spaceId: "direct-1", member: bob }).then((result) => {
      settled = true;
      return result;
    });
    await vi.waitFor(() => expect(relay.startDirectConversation).toHaveBeenCalledWith([bob]));
    await Promise.resolve();
    expect(settled).toBe(false);
    group.resolve(true);
    expect(await started).toEqual({
      workspaceId: "direct-1",
      conversationId: "c10",
      encrypted: true,
    });
  });
});
