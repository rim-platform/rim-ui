import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  JoinByPublicLinkOutcome,
  PublicJoinLinkMode,
} from "../../../core/graphql/generated/schema-types";

const roots = vi.hoisted(() => ({
  remoteJoinChallenge: vi.fn(),
  joinRemoteWorkspace: vi.fn(),
  fetchStreamHeads: vi.fn(async () => new Map([["w", 3]])),
  fetchRemoteWorkspaceName: vi.fn(async () => "Acme"),
  fetchRemoteWorkspaceOwner: vi.fn(async () => "alice"),
  renewDelegations: vi.fn(),
}));
vi.mock("../api/relayApi", () => roots);
const pins = vi.hoisted(() => ({
  pinServer: vi.fn(async (origin: string) => ({ serverId: "rims1_host", origin })),
}));
vi.mock("../state/serverPins", () => pins);
vi.mock("../crypto/relayCrypto", () => ({
  relayCrypto: () => ({
    signLoginForServer: vi.fn(async () => ({ payload: "login", signature: "sig" })),
    signDelegation: vi.fn(async () => ({ payload: "{}", signature: "sig" })),
  }),
}));
vi.mock("./relaySelf", () => ({
  relaySelf: vi.fn(async () => ({ serverId: "rims1_relay", keyHash: "relay-key" })),
}));
const db = vi.hoisted(() => ({
  putRecord: vi.fn(async () => undefined),
  getRecord: vi.fn(async () => null),
  allRecords: vi.fn(async () => []),
}));
vi.mock("../state/relayDb", () => db);
const spaces = vi.hoisted(() => ({
  registerSpace: vi.fn(async () => true),
  setSpaceDetails: vi.fn(async () => undefined),
}));
vi.mock("../state/spaces", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/spaces")>()),
  ...spaces,
}));

import { useRelayStore } from "../state/useRelayStore";
import { listPendingRemoteJoins } from "./pendingRemoteJoins";
import { joinAsMember, joinWithPublicLink, previewPublicLink } from "./remoteWorkspaces";
import { unlockTestVault } from "../../../test/accountVault";

const LINK = "https://host.example/join/rim_pjl_AAAAAAAAAAAAAAAAAAAAAA";
const TOKEN = "rim_pjl_AAAAAAAAAAAAAAAAAAAAAA";
const EXPIRES = "2026-11-23T00:00:00Z";

function challengeFor(mode: PublicJoinLinkMode) {
  return {
    challengeId: "c1",
    nonce: "n1",
    expiresAt: "2026-10-24T00:05:00Z",
    workspaceId: "ws-acme",
    workspaceName: "Acme",
    publicLinkMode: mode,
  };
}

function answer(outcome: JoinByPublicLinkOutcome) {
  const requested = outcome === JoinByPublicLinkOutcome.REQUESTED;
  return {
    hostServerId: "rims1_host",
    workspaceId: "ws-acme",
    userId: "r_me",
    role: "member",
    outcome,
    joinRequestId: requested ? "jr-1" : null,
    joinRequestExpiresAt: requested ? EXPIRES : null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useRelayStore.setState({
    account: {
      endpoint: "http://localhost:8080/api",
      userId: "u-me",
      principalId: "rimp1_me",
      deviceId: "d-1",
    },
  });
});

afterEach(() => {
  useRelayStore.getState().reset();
  localStorage.clear();
});

// The stores these tests use are sealed under the unlocked account.
beforeEach(() => unlockTestVault());

describe("a public link of another server", () => {
  it("is looked up by pinning the server at its origin and asking for a challenge", async () => {
    roots.remoteJoinChallenge.mockResolvedValue(challengeFor(PublicJoinLinkMode.REQUESTS));
    await expect(previewPublicLink(LINK)).resolves.toEqual({
      workspaceName: "Acme",
      mode: PublicJoinLinkMode.REQUESTS,
      hostServerId: "rims1_host",
      hostOrigin: "https://host.example",
    });
    expect(pins.pinServer).toHaveBeenCalledWith("https://host.example");
    expect(roots.remoteJoinChallenge).toHaveBeenCalledWith("rims1_host", "https://host.example", {
      inviteToken: null,
      publicLinkToken: TOKEN,
    });
    expect(roots.joinRemoteWorkspace).not.toHaveBeenCalled();
  });

  it("refuses a link of this server, or anything else", async () => {
    await expect(previewPublicLink(`${window.location.origin}/join/${TOKEN}`)).rejects.toThrow(
      /not a public link of another server/,
    );
    await expect(joinWithPublicLink("rim_inv_x")).rejects.toThrow(/not a public link/);
    expect(roots.remoteJoinChallenge).not.toHaveBeenCalled();
  });

  it("joins directly: binds the space, keeps the delegation and reads its details", async () => {
    roots.remoteJoinChallenge.mockResolvedValue(challengeFor(PublicJoinLinkMode.DIRECT));
    roots.joinRemoteWorkspace.mockResolvedValue(answer(JoinByPublicLinkOutcome.JOINED));
    const joined = await joinWithPublicLink(LINK);
    expect(joined).toMatchObject({
      outcome: JoinByPublicLinkOutcome.JOINED,
      workspaceId: "ws-acme",
    });
    expect(roots.joinRemoteWorkspace.mock.calls[0][0]).toMatchObject({
      hostServerId: "rims1_host",
      hostOrigin: "https://host.example",
      inviteToken: null,
      publicLinkToken: TOKEN,
      message: null,
    });
    expect(spaces.registerSpace).toHaveBeenCalledWith("ws-acme", "rims1_host", "workspace");
    expect(db.putRecord).toHaveBeenCalledWith("delegations", expect.anything());
    expect(spaces.setSpaceDetails).toHaveBeenCalledWith("ws-acme", { name: "Acme" });
    expect(listPendingRemoteJoins()).toEqual([]);
  });

  it("asks to join: keeps the request and binds nothing", async () => {
    roots.remoteJoinChallenge.mockResolvedValue(challengeFor(PublicJoinLinkMode.REQUESTS));
    roots.joinRemoteWorkspace.mockResolvedValue(answer(JoinByPublicLinkOutcome.REQUESTED));
    const requested = await joinWithPublicLink(LINK, "Hi from the meetup");
    expect(requested).toMatchObject({
      outcome: JoinByPublicLinkOutcome.REQUESTED,
      workspaceName: "Acme",
      joinRequestId: "jr-1",
    });
    expect(roots.joinRemoteWorkspace.mock.calls[0][0].message).toBe("Hi from the meetup");
    expect(spaces.registerSpace).not.toHaveBeenCalled();
    expect(db.putRecord).not.toHaveBeenCalled();
    expect(roots.fetchStreamHeads).not.toHaveBeenCalled();
    expect(listPendingRemoteJoins()).toEqual([
      {
        hostServerId: "rims1_host",
        hostOrigin: "https://host.example",
        workspaceId: "ws-acme",
        workspaceName: "Acme",
        joinRequestId: "jr-1",
        expiresAt: Date.parse(EXPIRES),
      },
    ]);
  });
});

describe("joinAsMember", () => {
  it("joins as a current member, with no token", async () => {
    roots.remoteJoinChallenge.mockResolvedValue({ ...challengeFor(PublicJoinLinkMode.DIRECT) });
    roots.joinRemoteWorkspace.mockResolvedValue(answer(JoinByPublicLinkOutcome.JOINED));
    await joinAsMember({
      hostServerId: "rims1_host",
      hostOrigin: "https://host.example",
      workspaceId: "ws-acme",
    });
    expect(pins.pinServer).toHaveBeenCalledWith("https://host.example", "rims1_host");
    expect(roots.remoteJoinChallenge).toHaveBeenCalledWith("rims1_host", "https://host.example", {
      inviteToken: null,
      publicLinkToken: null,
    });
    expect(roots.joinRemoteWorkspace.mock.calls[0][0]).toMatchObject({
      inviteToken: null,
      publicLinkToken: null,
    });
    expect(spaces.registerSpace).toHaveBeenCalledWith("ws-acme", "rims1_host", "workspace");
  });
});
