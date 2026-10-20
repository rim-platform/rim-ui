import { beforeEach, describe, expect, it, vi } from "vitest";

const identity = vi.hoisted(() => ({ resolveIdentity: vi.fn() }));
const create = vi.hoisted(() => ({ createConversation: vi.fn() }));
const groups = vi.hoisted(() => ({ createGroup: vi.fn() }));
const session = vi.hoisted(() => ({ e2eeSession: vi.fn() }));
vi.mock("../contacts/identity", () => identity);
vi.mock("../../conversations/api/useCreateConversation", () => create);
vi.mock("../../e2ee/runtime/groups", () => groups);
vi.mock("../../e2ee/runtime/session", () => session);
vi.mock("../../e2ee/web/webAccount", () => ({ isWebAccount: () => false }));
const own = vi.hoisted(() => ({ origin: "http://localhost:8080" }));
vi.mock("../state/serverOrigin", () => ({ serverOrigin: async () => own.origin }));

import { useRelayStore } from "../state/useRelayStore";
import { directMemberReady, NotReadyError, startDirectConversation } from "./startDirect";

const HERE = "http://localhost:8080";

function person(relays: string[], ready: boolean) {
  return {
    identity: {
      devices: [{ deviceId: "d", mlsActive: ready, revocation: null }],
    },
    card: { displayName: "Bob", relays, version: 1 },
  };
}

beforeEach(() => {
  own.origin = HERE;
  Object.values({ ...identity, ...create, ...groups, ...session }).forEach((fn) => fn.mockReset());
  groups.createGroup.mockResolvedValue(true);
  useRelayStore.getState().reset();
  useRelayStore
    .getState()
    .setStarted(
      { serverId: "rims1_relay", roles: ["host", "relay"], directSpaceId: "direct-1" },
      { endpoint: `${HERE}/api`, userId: "u1", principalId: "rimp1_me", deviceId: "d1" },
      [],
    );
});

describe("startDirectConversation", () => {
  it("starts an encrypted DM in this relay's direct space with the contact's relays", async () => {
    identity.resolveIdentity.mockResolvedValue(person(["https://relay-b.example"], true));
    session.e2eeSession.mockResolvedValue({ account: {} });
    create.createConversation.mockResolvedValue({ id: "c1", encryptedAt: "2026-10-10T00:00:00Z" });
    const result = await startDirectConversation([
      { principalId: "rimp1_bob", relayUrls: ["https://relay-b.example"], name: "Bob" },
    ]);
    expect(result).toMatchObject({ spaceId: "direct-1", conversationId: "c1", encrypted: true });
    await expect(result.group).resolves.toBe(true);
    expect(create.createConversation).toHaveBeenCalledWith({
      serverId: "direct-1",
      encrypted: true,
      remoteMembers: [{ principalId: "rimp1_bob", relayUrls: ["https://relay-b.example"] }],
    });
    expect(groups.createGroup).toHaveBeenCalledWith({ account: {} }, "direct-1", "c1");
  });

  it("creates nothing with someone on another relay who cannot receive encrypted messages", async () => {
    identity.resolveIdentity.mockResolvedValue(person(["https://relay-b.example"], false));
    session.e2eeSession.mockResolvedValue({ account: {} });
    await expect(
      startDirectConversation([{ principalId: "rimp1_bob", relayUrls: [], name: "Bob" }]),
    ).rejects.toBeInstanceOf(NotReadyError);
    expect(create.createConversation).not.toHaveBeenCalled();
  });

  it("keeps today's rule for members on this relay: plaintext when someone is not ready", async () => {
    identity.resolveIdentity.mockResolvedValue(person([HERE], false));
    session.e2eeSession.mockResolvedValue(null);
    create.createConversation.mockResolvedValue({ id: "c2", encryptedAt: null });
    const result = await startDirectConversation([
      { principalId: "rimp1_a", relayUrls: [], name: "A" },
      { principalId: "rimp1_b", relayUrls: [], name: "B" },
    ]);
    expect(create.createConversation).toHaveBeenCalledWith({
      serverId: "direct-1",
      remoteMembers: [
        { principalId: "rimp1_a", relayUrls: [HERE] },
        { principalId: "rimp1_b", relayUrls: [HERE] },
      ],
    });
    expect(groups.createGroup).not.toHaveBeenCalled();
    expect(result).toMatchObject({ encrypted: false, group: null });
  });

  it("knows members on this relay by the origin it is known by, not the page's", async () => {
    own.origin = "https://relay.example";
    identity.resolveIdentity.mockResolvedValueOnce(person(["https://relay.example"], false));
    identity.resolveIdentity.mockResolvedValueOnce({
      identity: { devices: [{ deviceId: "d", mlsActive: false, revocation: null }] },
      card: null,
    });
    session.e2eeSession.mockResolvedValue(null);
    create.createConversation.mockResolvedValue({ id: "c4", encryptedAt: null });
    await startDirectConversation([
      { principalId: "rimp1_a", relayUrls: [], name: "A" },
      { principalId: "rimp1_b", relayUrls: [], name: "B" },
    ]);
    expect(create.createConversation).toHaveBeenCalledWith({
      serverId: "direct-1",
      remoteMembers: [
        { principalId: "rimp1_a", relayUrls: ["https://relay.example"] },
        { principalId: "rimp1_b", relayUrls: ["https://relay.example"] },
      ],
    });
  });

  it("says whether a member has a device that can receive encrypted messages", async () => {
    identity.resolveIdentity.mockResolvedValueOnce(person([HERE], true));
    identity.resolveIdentity.mockResolvedValueOnce(person([HERE], false));
    const bob = { principalId: "rimp1_bob", relayUrls: [], name: "Bob" };
    expect(await directMemberReady(bob)).toBe(true);
    expect(await directMemberReady(bob)).toBe(false);
  });

  it("names the conversation a successor continues", async () => {
    identity.resolveIdentity.mockResolvedValue(person(["https://relay-b.example"], true));
    session.e2eeSession.mockResolvedValue({ account: {} });
    create.createConversation.mockResolvedValue({ id: "c3", encryptedAt: "x" });
    await startDirectConversation([{ principalId: "rimp1_bob", relayUrls: [], name: "Bob" }], {
      hostServerId: "rims1_old",
      conversationId: "old",
    });
    expect(create.createConversation.mock.calls[0][0].predecessor).toEqual({
      hostServerId: "rims1_old",
      conversationId: "old",
    });
  });
});
