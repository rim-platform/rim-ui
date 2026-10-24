import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import vectors from "../../../../protocol/relay-vectors.json";
import { keyFromSeed } from "../../../test/ed25519";
import { getGraphqlEndpoint } from "../../../core/graphql/config";
import { createGraphqlClient, setSpaceRouter, spaceOfRequest } from "../../../core/graphql/client";
import { b64, unb64, utf8 } from "../../key-identity/browser/bytes";
import { insert } from "../../key-identity/browser/keyStore";
import { sign, verify } from "../../key-identity/browser/statements";
import { RELAY_CONTEXT, replayServerLog, sha256Text } from "../crypto/serverStatements";
import { putRecord, type ServerPin } from "../state/relayDb";
import { resetPinCache } from "../state/serverPins";
import { useRelayStore } from "../state/useRelayStore";
import { RelayFailure, remoteFetch, replayHighestSeq, sendGraphql } from "./remoteFetch";
import { seqAfter } from "./requestSeq";
import { unlockTestVault } from "../../../test/accountVault";

const HOST = vectors.host.serverId;
const DEVICE = vectors.device;

interface Sent {
  url: string;
  headers: Headers;
  body: Uint8Array;
  request: { payload: string; signature: string };
}

/** A relay that forwards to a host signing with seed 40, answering `respond(request)`. */
function fakeRelay(
  respond: (sent: Sent) => { status: number; body: string; sign?: boolean; tamper?: boolean },
) {
  const sent: Sent[] = [];
  const fetchMock = vi.fn(async (target: string | URL, init: RequestInit) => {
    const url = String(target);
    const headers = new Headers(init.headers);
    const encoded = headers.get("Rim-Device-Request") ?? "";
    const request = {
      payload: new TextDecoder().decode(unb64(encoded) ?? new Uint8Array()),
      signature: headers.get("Rim-Device-Signature") ?? "",
    };
    const body = init.body ? new Uint8Array(init.body as Uint8Array) : new Uint8Array();
    const entry = { url, headers, body, request };
    sent.push(entry);
    const answer = respond(entry);
    const responseHeaders = new Headers({ "Content-Type": "application/json" });
    if (answer.sign !== false) {
      const payload = JSON.stringify({
        v: 2,
        type: "host-response",
        host: HOST,
        keySeq: 0,
        requestSha256: await sha256Text(utf8(request.payload)),
        status: answer.status,
        bodySha256: await sha256Text(utf8(answer.tamper ? "{}" : answer.body)),
      });
      const hostKey = await keyFromSeed(vectors.host.seed);
      const signed = await sign(hostKey.privateKey, RELAY_CONTEXT.hostResponse, payload);
      responseHeaders.set("Rim-Host-Response", b64(utf8(payload)));
      responseHeaders.set("Rim-Host-Signature", signed.signature);
    }
    return new Response(answer.body, { status: answer.status, headers: responseHeaders });
  });
  vi.stubGlobal("fetch", fetchMock);
  return sent;
}

async function pinHost(): Promise<void> {
  const head = await replayServerLog([vectors.host.inception]);
  const pin: ServerPin = {
    serverId: HOST,
    origin: "https://host.example",
    log: [vectors.host.inception],
    hashes: head.hashes,
    keys: head.keys,
    signers: head.signers,
    previousKeyUntil: null,
    descriptorVersion: 1,
    status: "active",
    pinnedAt: 0,
    fetchedAt: 0,
  };
  await putRecord("servers", pin);
}

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  resetPinCache();
  const device = await keyFromSeed(DEVICE.seed);
  await insert({
    v: 1,
    endpoint: getGraphqlEndpoint(),
    principalId: DEVICE.principalId,
    deviceId: DEVICE.deviceId,
    deviceName: "Laptop",
    deviceKey: device.privateKey,
    confirmed: true,
    userId: "u1",
    username: "ada",
  });
  useRelayStore.getState().setStarted(
    { serverId: vectors.relay.serverId, roles: ["host", "relay"], directSpaceId: "direct-1" },
    {
      endpoint: getGraphqlEndpoint(),
      userId: "u1",
      principalId: DEVICE.principalId,
      deviceId: DEVICE.deviceId,
    },
    [{ account: "a", spaceId: "remote-space", hostServerId: HOST, kind: "direct" }],
  );
  await pinHost();
});

afterEach(() => {
  vi.unstubAllGlobals();
  setSpaceRouter(null);
  useRelayStore.getState().reset();
});

// The stores these tests use are sealed under the unlocked account.
beforeEach(() => unlockTestVault());

describe("remoteFetch", () => {
  it("sends a device-signed request and returns the host-verified answer", async () => {
    const sent = fakeRelay(() => ({ status: 200, body: '{"data":{"ok":true}}' }));
    const body = utf8('{"query":"{ ok }"}');
    const res = await remoteFetch(HOST, "/api", {
      method: "POST",
      body,
      contentType: "application/json",
    });
    expect(res.status).toBe(200);
    expect(new TextDecoder().decode(res.body)).toBe('{"data":{"ok":true}}');

    const [request] = sent;
    expect(request.url).toMatch(new RegExp(`/api/remote/${HOST}/api$`));
    const fields = JSON.parse(request.request.payload) as Record<string, unknown>;
    expect(fields).toMatchObject({
      type: "device-request",
      principalId: DEVICE.principalId,
      deviceId: DEVICE.deviceId,
      host: HOST,
      method: "POST",
      path: "/api",
      bodySha256: await sha256Text(body),
    });
    const deviceKey = (await keyFromSeed(DEVICE.seed)).publicKey;
    expect(await verify(request.request, RELAY_CONTEXT.deviceRequest, deviceKey, 2)).toBe(true);
  });

  it("counts an unsigned or tampered answer as a relay failure", async () => {
    fakeRelay(() => ({ status: 502, body: "{}", sign: false }));
    await expect(remoteFetch(HOST, "/api", { method: "GET" })).rejects.toBeInstanceOf(RelayFailure);
    fakeRelay(() => ({ status: 200, body: '{"data":{}}', tamper: true }));
    await expect(remoteFetch(HOST, "/api", { method: "GET" })).rejects.toThrow(/another body/);
  });

  it("signs once more above highestSeq after a replay refusal", async () => {
    const highest = Date.now() * 1000 + 5_000_000_000;
    let calls = 0;
    const sent = fakeRelay(() => {
      calls += 1;
      return calls === 1
        ? { status: 409, body: JSON.stringify({ error: "replay", highestSeq: String(highest) }) }
        : { status: 200, body: '{"data":{}}' };
    });
    const res = await remoteFetch(HOST, "/api", { method: "POST", body: utf8("{}") });
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(2);
    const second = JSON.parse(sent[1].request.payload) as { seq: number };
    expect(second.seq).toBeGreaterThan(highest);
  });

  it("refuses an answer from a host signing at a key it does not accept", async () => {
    await putRecord("servers", {
      serverId: HOST,
      origin: "https://host.example",
      log: [],
      hashes: [],
      keys: ["ed25519:6S62BU_pvGgqG887dZ9lqzikz72BxNHzNC5Myc3tiws", "ed25519:other"],
      signers: [null, "recovery"],
      previousKeyUntil: null,
      descriptorVersion: 1,
      status: "active",
      pinnedAt: 0,
      fetchedAt: 0,
    } satisfies ServerPin);
    resetPinCache();
    fakeRelay(() => ({ status: 200, body: "{}" }));
    await expect(remoteFetch(HOST, "/api", { method: "GET" })).rejects.toThrow(/does not accept/);
  });
});

describe("GraphQL routing", () => {
  it("reads the space from serverId, workspaceId or the input", () => {
    expect(spaceOfRequest(JSON.stringify({ variables: { serverId: "s" } }))).toBe("s");
    expect(spaceOfRequest(JSON.stringify({ variables: { input: { workspaceId: "w" } } }))).toBe(
      "w",
    );
    expect(spaceOfRequest(JSON.stringify({ variables: {} }))).toBeNull();
    expect(spaceOfRequest("not json")).toBeNull();
  });

  it("sends a request about a remote space to its host and keeps others local", async () => {
    const sent = fakeRelay(() => ({ status: 200, body: '{"data":{"x":1}}' }));
    setSpaceRouter({
      hostOf: (id) => (id === "remote-space" ? HOST : null),
      send: sendGraphql,
    });
    const client = createGraphqlClient();
    const remote = await client.request<{ x: number }>("query($serverId: ID!) { x }", {
      serverId: "remote-space",
    });
    expect(remote.x).toBe(1);
    expect(sent[0].url).toContain(`/api/remote/${HOST}/api`);
    await client.request("query($serverId: ID!) { x }", { serverId: "local-space" });
    expect(sent[1].url).toBe(getGraphqlEndpoint());
  });
});

describe("request seq", () => {
  it("is above the previous one and the clock, and above a reported highest", () => {
    expect(seqAfter(null, 1_000)).toBe(1_000_000);
    expect(seqAfter(5_000_000, 1_000)).toBe(5_000_001);
    expect(seqAfter(1, 1_000, 9_000_000)).toBe(9_000_000);
    expect(() => seqAfter(Number.MAX_SAFE_INTEGER, 0)).toThrow(/exhausted/);
  });

  it("reads highestSeq only from a replay refusal", () => {
    const body = (text: string) => ({ status: 409, body: utf8(text), contentType: null });
    expect(replayHighestSeq(body('{"error":"replay","highestSeq":"42"}'))).toBe(42);
    expect(replayHighestSeq(body('{"error":"conflict"}'))).toBeNull();
    expect(replayHighestSeq({ ...body('{"error":"replay","highestSeq":"42"}'), status: 200 })).toBe(
      null,
    );
  });
});
