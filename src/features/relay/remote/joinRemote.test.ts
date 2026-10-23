import { describe, expect, it, vi } from "vitest";

import {
  JoinByPublicLinkOutcome,
  PublicJoinLinkMode,
} from "../../../core/graphql/generated/schema-types";

import vectors from "../../../../protocol/relay-vectors.json";
import { keyFromSeed } from "../../../test/ed25519";
import { verify } from "../../key-identity/browser/statements";
import { RELAY_CONTEXT, replayServerLog, signDelegation } from "../crypto/serverStatements";
import type { ServerPin } from "../state/relayDb";
import { DELEGATION_MS } from "./delegations";
import type { InviteLink } from "./inviteLink";
import { InviteKeyError, joinRemote, pinNamesKey, type JoinDeps } from "./joinRemote";

const host = vectors.host;
const relay = vectors.relay;
const device = vectors.device;
const WORKSPACE = "0199d1a0-0000-7000-8000-000000000002";
const NOW = Date.UTC(2026, 9, 9, 0, 0, 0, 400);

async function pinOf(log = [host.inception]): Promise<ServerPin> {
  const head = await replayServerLog(log);
  return {
    serverId: head.serverId,
    origin: "https://host.example",
    log,
    hashes: head.hashes,
    keys: head.keys,
    signers: head.signers,
    previousKeyUntil: null,
    descriptorVersion: 1,
    status: "active",
    pinnedAt: 0,
    fetchedAt: 0,
  };
}

const invite: InviteLink = {
  hostServerId: host.serverId,
  hostKeyHash: host.keyHash,
  inviteToken: "rim_inv_token",
  hostOrigin: "https://host.example",
};

async function deps(overrides: Partial<JoinDeps> = {}): Promise<JoinDeps> {
  const key = await keyFromSeed(device.seed);
  return {
    principalId: device.principalId,
    account: "relay|me",
    pinHost: vi.fn(async () => pinOf()),
    relay: vi.fn(async () => ({ serverId: relay.serverId, keyHash: relay.keyHash })),
    challenge: vi.fn(async () => ({ challengeId: "c1", nonce: "n1", workspaceId: WORKSPACE })),
    signLogin: vi.fn(async () => ({ payload: "login", signature: "sig" })),
    // The device key of the vectors signs, as the browser backend would.
    signDelegation: vi.fn((fields) =>
      signDelegation(key.privateKey, {
        ...fields,
        principalId: device.principalId,
        deviceId: device.deviceId,
      }),
    ),
    join: vi.fn(async () => ({
      hostServerId: host.serverId,
      workspaceId: WORKSPACE,
      userId: "u-remote",
      role: "member",
      outcome: JoinByPublicLinkOutcome.JOINED,
    })),
    registerSpace: vi.fn(async () => true),
    saveDelegation: vi.fn(async () => undefined),
    streamHeads: vi.fn(async () => new Map([["w", 17]])),
    setBaseline: vi.fn(async () => undefined),
    now: () => NOW,
    ...overrides,
  };
}

describe("an invite's host key", () => {
  it("names the current key, or one followed only by server rotations", async () => {
    expect(await pinNamesKey(await pinOf(), host.keyHash)).toBe(true);
    const rotated = await pinOf([host.inception, host.rotation]);
    expect(await pinNamesKey(rotated, host.keyHash)).toBe(true);
    expect(await pinNamesKey(rotated, host.rotatedKeyHash)).toBe(true);
    expect(await pinNamesKey(rotated, relay.keyHash)).toBe(false);
  });

  it("does not name a key from before a recovery rotation", async () => {
    const recovered = { ...(await pinOf([host.inception, host.rotation])) };
    recovered.signers = [null, "recovery"];
    expect(await pinNamesKey(recovered, host.keyHash)).toBe(false);
    expect(await pinNamesKey(recovered, host.rotatedKeyHash)).toBe(true);
  });
});

describe("joining a workspace on another server", () => {
  it("pins the host, signs a proof and a delegation, joins and takes the stream heads", async () => {
    const d = await deps();
    const joined = await joinRemote(invite, d);
    expect(joined).toEqual({
      outcome: JoinByPublicLinkOutcome.JOINED,
      hostServerId: host.serverId,
      workspaceId: WORKSPACE,
      role: "member",
    });
    expect(d.pinHost).toHaveBeenCalledWith("https://host.example", host.serverId);
    expect(d.challenge).toHaveBeenCalledWith(host.serverId, "https://host.example", {
      inviteToken: "rim_inv_token",
      publicLinkToken: null,
    });
    expect(d.signLogin).toHaveBeenCalledWith(
      host.serverId,
      expect.objectContaining({ nonce: "n1" }),
    );

    const input = vi.mocked(d.join).mock.calls[0][0];
    expect(input).toMatchObject({
      hostServerId: host.serverId,
      hostOrigin: "https://host.example",
      inviteToken: "rim_inv_token",
      publicLinkToken: null,
      message: null,
      proof: { payload: "login", signature: "sig" },
    });
    const delegation = JSON.parse(input.delegation.payload) as Record<string, string>;
    expect(delegation).toMatchObject({
      type: "delegation",
      principalId: device.principalId,
      deviceId: device.deviceId,
      relay: relay.serverId,
      relayKeyHash: relay.keyHash,
      host: host.serverId,
      workspaceId: WORKSPACE,
      scope: "workspace",
      issuedAt: "2026-10-09T00:00:00Z",
    });
    expect(Date.parse(delegation.expiresAt) - Date.parse(delegation.issuedAt)).toBe(DELEGATION_MS);
    const deviceKey = (await keyFromSeed(device.seed)).publicKey;
    expect(await verify(input.delegation, RELAY_CONTEXT.delegation, deviceKey, 2)).toBe(true);

    expect(d.registerSpace).toHaveBeenCalledWith(WORKSPACE, host.serverId);
    expect(d.saveDelegation).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WORKSPACE,
        host: host.serverId,
        relay: relay.serverId,
      }),
    );
    expect(d.streamHeads).toHaveBeenCalledWith(WORKSPACE, ["w", `u:${device.principalId}`]);
    expect(d.setBaseline).toHaveBeenCalledWith(host.serverId, WORKSPACE, new Map([["w", 17]]));
  });

  it("refuses an invite whose key the host no longer uses, before asking anything", async () => {
    const d = await deps();
    await expect(joinRemote({ ...invite, hostKeyHash: relay.keyHash }, d)).rejects.toThrow(
      InviteKeyError,
    );
    expect(d.challenge).not.toHaveBeenCalled();
    expect(d.join).not.toHaveBeenCalled();
  });

  it("refuses a host the origin does not serve", async () => {
    const d = await deps({
      pinHost: vi.fn(async () => {
        throw new Error("https://host.example is another server than the one expected");
      }),
    });
    await expect(joinRemote(invite, d)).rejects.toThrow(/another server/);
    expect(d.join).not.toHaveBeenCalled();
  });

  it("refuses an answer for another workspace, or a space id already taken", async () => {
    const other = await deps({
      join: vi.fn(async () => ({
        hostServerId: host.serverId,
        workspaceId: "0199d1a0-0000-7000-8000-00000000000f",
        userId: "u",
        role: "member",
      })),
    });
    await expect(joinRemote(invite, other)).rejects.toThrow(/another workspace/);
    const taken = await deps({ registerSpace: vi.fn(async () => false) });
    await expect(joinRemote(invite, taken)).rejects.toThrow(/already used/);
    expect(taken.saveDelegation).not.toHaveBeenCalled();
  });

  it("joins without heads, the first event seen becoming the baseline", async () => {
    const d = await deps({
      streamHeads: vi.fn(async () => {
        throw new Error("the host is slow");
      }),
    });
    await expect(joinRemote(invite, d)).resolves.toMatchObject({ workspaceId: WORKSPACE });
    expect(d.setBaseline).not.toHaveBeenCalled();
  });

  it("rejoins as a current member without an invite token", async () => {
    const d = await deps({
      challenge: vi.fn(async () => ({ challengeId: "c2", nonce: "n2", workspaceId: null })),
    });
    await joinRemote(
      { hostServerId: host.serverId, hostOrigin: "https://host.example", workspaceId: WORKSPACE },
      d,
    );
    expect(d.challenge).toHaveBeenCalledWith(host.serverId, "https://host.example", {
      inviteToken: null,
      publicLinkToken: null,
    });
    expect(vi.mocked(d.join).mock.calls[0][0]).toMatchObject({
      inviteToken: null,
      publicLinkToken: null,
      message: null,
    });
  });
});

describe("joining through a public link of another server", () => {
  const link = {
    hostServerId: host.serverId,
    hostOrigin: "https://host.example",
    publicLinkToken: "rim_pjl_AAAAAAAAAAAAAAAAAAAAAA",
    message: "Hi, I run the meetup.",
  };
  const challenge = vi.fn(async () => ({
    challengeId: "c3",
    nonce: "n3",
    workspaceId: WORKSPACE,
    workspaceName: "Acme",
    publicLinkMode: PublicJoinLinkMode.REQUESTS,
  }));

  it("joins at once through a direct link, as through an invite", async () => {
    const d = await deps({ challenge });
    const joined = await joinRemote({ ...link, message: undefined }, d);
    expect(joined).toMatchObject({
      outcome: JoinByPublicLinkOutcome.JOINED,
      workspaceId: WORKSPACE,
    });
    expect(d.challenge).toHaveBeenCalledWith(host.serverId, "https://host.example", {
      inviteToken: null,
      publicLinkToken: link.publicLinkToken,
    });
    expect(vi.mocked(d.join).mock.calls[0][0]).toMatchObject({
      inviteToken: null,
      publicLinkToken: link.publicLinkToken,
      message: null,
    });
    expect(d.registerSpace).toHaveBeenCalledWith(WORKSPACE, host.serverId);
    expect(d.saveDelegation).toHaveBeenCalled();
    expect(d.setBaseline).toHaveBeenCalled();
  });

  it("returns the request filed and binds, keeps and subscribes nothing", async () => {
    const expiresAt = "2026-11-08T00:00:00Z";
    const d = await deps({
      challenge,
      join: vi.fn(async () => ({
        hostServerId: host.serverId,
        workspaceId: WORKSPACE,
        userId: "u-remote",
        role: "member",
        outcome: JoinByPublicLinkOutcome.REQUESTED,
        joinRequestId: "jr-9",
        joinRequestExpiresAt: expiresAt,
      })),
    });
    const requested = await joinRemote(link, d);
    expect(requested).toEqual({
      outcome: JoinByPublicLinkOutcome.REQUESTED,
      hostServerId: host.serverId,
      workspaceId: WORKSPACE,
      workspaceName: "Acme",
      joinRequestId: "jr-9",
      expiresAt: Date.parse(expiresAt),
    });
    expect(vi.mocked(d.join).mock.calls[0][0].message).toBe("Hi, I run the meetup.");
    expect(d.registerSpace).not.toHaveBeenCalled();
    expect(d.saveDelegation).not.toHaveBeenCalled();
    expect(d.streamHeads).not.toHaveBeenCalled();
    expect(d.setBaseline).not.toHaveBeenCalled();
  });

  it("refuses a request answer that names no request", async () => {
    const d = await deps({
      challenge,
      join: vi.fn(async () => ({
        hostServerId: host.serverId,
        workspaceId: WORKSPACE,
        userId: "u-remote",
        role: "member",
        outcome: JoinByPublicLinkOutcome.REQUESTED,
        joinRequestId: null,
        joinRequestExpiresAt: null,
      })),
    });
    await expect(joinRemote(link, d)).rejects.toThrow(/did not say which/);
  });
});
