import { beforeEach, describe, expect, it, vi } from "vitest";

const e2eeApi = vi.hoisted(() => ({ fetchPrincipalDevices: vi.fn() }));
const keys = vi.hoisted(() => ({ fetchKeyLog: vi.fn() }));
const identity = vi.hoisted(() => ({ resolveIdentity: vi.fn() }));
vi.mock("../api/e2eeApi", () => e2eeApi);
vi.mock("../../key-identity/api/keyIdentity", () => keys);
vi.mock("../../relay/contacts/identity", () => identity);

import { rememberRelays } from "../../relay/contacts/knownRelays";
import { useRelayStore } from "../../relay/state/useRelayStore";
import { directoryFor, isReady, notReadyMembers, notReadyMessage } from "./members";

const LOG = [{ payload: "inception", signature: "s" }];
const CERT = { payload: "cert", signature: "s" };
const CARD = { payload: "card", signature: "s" };

beforeEach(() => {
  Object.values({ ...e2eeApi, ...keys, ...identity }).forEach((fn) => fn.mockReset());
  useRelayStore.getState().reset();
  useRelayStore
    .getState()
    .setStarted(
      { serverId: "rims1_relay", roles: ["host", "relay"], directSpaceId: "direct-1" },
      { endpoint: "e", userId: "u1", principalId: "rimp1_me", deviceId: "d1" },
      [],
    );
});

describe("directoryFor", () => {
  it("fetches a principal this relay does not know from their own relay, card included", async () => {
    e2eeApi.fetchPrincipalDevices.mockResolvedValue([
      { principalId: "rimp1_local", devices: [{ deviceId: "d", certificate: CERT }] },
    ]);
    keys.fetchKeyLog.mockImplementation(async (id: string) => (id === "rimp1_local" ? LOG : []));
    rememberRelays("rimp1_remote", ["https://relay-b.example"]);
    identity.resolveIdentity.mockResolvedValue({
      identity: {
        keyLog: LOG,
        devices: [{ deviceId: "r1", certificate: CERT, revocation: null, mlsActive: true }],
        card: CARD,
      },
      card: { displayName: "Bob", relays: [], version: 1 },
    });
    const input = await directoryFor(
      ["rimp1_local", "rimp1_remote"],
      ["rimp1_local", "rimp1_remote"],
    );
    expect(identity.resolveIdentity).toHaveBeenCalledWith("rimp1_remote", [
      "https://relay-b.example",
    ]);
    const remote = input.principals.find((p) => p.principalId === "rimp1_remote");
    expect(remote?.card).toEqual(CARD);
    expect(remote?.devices[0]).toMatchObject({ deviceId: "r1", mlsActive: true, revokedAt: null });
    expect(input.principals.find((p) => p.principalId === "rimp1_local")?.card).toBeUndefined();
  });

  it("leaves a principal unverified when their relay cannot be reached", async () => {
    e2eeApi.fetchPrincipalDevices.mockResolvedValue([]);
    keys.fetchKeyLog.mockResolvedValue([]);
    identity.resolveIdentity.mockRejectedValue(new Error("unreachable"));
    const input = await directoryFor(["rimp1_x"], ["rimp1_x"]);
    expect(input.principals).toEqual([{ principalId: "rimp1_x", keyLog: [], devices: [] }]);
  });
});

describe("readiness of remote members", () => {
  it("asks a remote principal's relay, and a signed revocation means not ready", async () => {
    e2eeApi.fetchPrincipalDevices.mockResolvedValue([]);
    identity.resolveIdentity.mockResolvedValue({
      identity: {
        keyLog: LOG,
        devices: [{ deviceId: "r1", certificate: CERT, revocation: CERT, mlsActive: true }],
        card: null,
      },
      card: null,
    });
    const { names } = await notReadyMembers([
      { userId: "u2", username: "bob", principalId: "rimp1_remote" } as never,
    ]);
    expect(names).toEqual(["bob"]);
    expect(notReadyMessage(names)).toBe("bob has no device set up for encryption yet");
    expect(notReadyMessage(["Ann", "bob", "Cy"])).toBe(
      "Ann, bob and Cy have no device set up for encryption yet",
    );
    expect(
      isReady({
        principalId: "p",
        devices: [
          {
            deviceId: "d",
            name: "",
            certificate: CERT,
            revocation: null,
            revokedAt: null,
            mlsActive: true,
          },
        ],
      }),
    ).toBe(true);
  });
});
