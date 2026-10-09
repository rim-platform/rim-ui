import { describe, expect, it } from "vitest";

import vectors from "../../../../protocol/relay-vectors.json";
import { keyFromSeed } from "../../../test/ed25519";
import { b64, utf8 } from "../../key-identity/browser/bytes";
import { sign, type Statement } from "../../key-identity/browser/statements";
import {
  comparePin,
  deviceRequestHeaders,
  deviceRequestPayload,
  issuedAtNow,
  keyHash,
  namesCurrentKey,
  readHostEvent,
  readHostResponse,
  RELAY_CONTEXT,
  replayServerLog,
  serverId,
  sha256Text,
  signDeviceRequest,
  verifyDescriptor,
  verifyDiscovery,
  verifyHostEventSignature,
  verifyHostResponse,
  type DeviceRequestInput,
} from "./serverStatements";

const host = vectors.host;
const request = vectors.deviceRequest;
const response = vectors.hostResponse;
const requestInput = {
  ...request.input,
  method: "POST",
  bodySha256: request.bodySha256,
} as DeviceRequestInput;

function discovery(log: Statement[], descriptor: Statement): string {
  return JSON.stringify({ rim: "server-discovery", keyLog: log, descriptor });
}

describe("server key log", () => {
  it("replays the inceptions to the vector ids, key hashes and prev links", async () => {
    for (const server of [vectors.relay, vectors.host]) {
      const head = await replayServerLog([server.inception]);
      expect(head.serverId).toBe(server.serverId);
      expect(head.serverKey).toBe(server.serverKey);
      expect(head.hash).toBe(server.prev);
      expect(await keyHash(server.serverKey)).toBe(server.keyHash);
      expect(await serverId(server.inception.payload)).toBe(server.serverId);
    }
  });

  it("follows a server rotation and verifies the re-signed descriptor", async () => {
    const head = await replayServerLog([host.inception, host.rotation]);
    expect(head.seq).toBe(1);
    expect(head.hash).toBe(host.rotatedPrev);
    expect(await keyHash(head.serverKey)).toBe(host.rotatedKeyHash);
    const descriptor = await verifyDescriptor(head, host.rotatedDescriptor);
    expect(descriptor.version).toBe(2);
    await expect(verifyDescriptor(head, host.descriptor)).rejects.toThrow(/head key/);
  });

  it("verifies the descriptor at seq 0", async () => {
    const head = await replayServerLog([host.inception]);
    const descriptor = await verifyDescriptor(head, host.descriptor);
    expect(descriptor.roles).toEqual(["host", "relay"]);
    expect(descriptor.endpoints.s2s).toBe("https://host.example/s2s/v1");
  });

  it("refuses a tampered entry, an unknown field and a version 1 entry", async () => {
    const tampered = { ...host.inception, payload: host.inception.payload.replace("09T", "08T") };
    await expect(replayServerLog([tampered])).rejects.toThrow(/signature/);
    const extra = await keyFromSeed(40);
    const withField = await sign(
      extra.privateKey,
      RELAY_CONTEXT.serverKey,
      host.inception.payload.replace('{"v":2,', '{"v":2,"x":1,'),
    );
    await expect(replayServerLog([withField])).rejects.toThrow(/not a server key log entry/);
    const v1 = await sign(
      extra.privateKey,
      RELAY_CONTEXT.serverKey,
      host.inception.payload.replace('{"v":2,', '{"v":1,'),
    );
    await expect(replayServerLog([v1])).rejects.toThrow(/not a server key log entry/);
  });

  it("names the pinned key through server rotations, not through a recovery", async () => {
    const head = await replayServerLog([host.inception, host.rotation]);
    expect(await namesCurrentKey(head, host.keyHash)).toBe(true);
    expect(await namesCurrentKey(head, host.rotatedKeyHash)).toBe(true);
    expect(await namesCurrentKey({ ...head, signers: [null, "recovery"] }, host.keyHash)).toBe(
      false,
    );
  });

  it("compares a fetched log with the pin", async () => {
    const one = await replayServerLog([host.inception]);
    const two = await replayServerLog([host.inception, host.rotation]);
    const other = await replayServerLog([vectors.relay.inception]);
    expect(comparePin(one.hashes, one)).toBe("equal");
    expect(comparePin(one.hashes, two)).toBe("extends");
    expect(comparePin(two.hashes, one)).toBe("prefix");
    expect(comparePin(one.hashes, other)).toBe("fork");
    expect(comparePin(two.hashes, other)).toBe("fork");
  });

  it("verifies a discovery document for its origin", async () => {
    const document = discovery([host.inception], host.descriptor);
    const verified = await verifyDiscovery(document, "https://host.example");
    expect(verified.head.serverId).toBe(host.serverId);
    await expect(verifyDiscovery(document, "https://elsewhere.example")).rejects.toThrow(
      /another origin/,
    );
    await expect(verifyDiscovery("{}", "https://host.example")).rejects.toThrow(/malformed/);
  });
});

describe("device requests", () => {
  it("builds and signs the vector request byte for byte", async () => {
    expect(await sha256Text(utf8(request.body))).toBe(request.bodySha256);
    expect(deviceRequestPayload(requestInput)).toBe(request.payload);
    const device = await keyFromSeed(vectors.device.seed);
    const signed = await signDeviceRequest(device.privateKey, requestInput);
    expect(signed).toEqual({ payload: request.payload, signature: request.signature });
    expect(deviceRequestHeaders(signed)).toEqual({
      "Rim-Device-Request": request.header,
      "Rim-Device-Signature": request.signature,
    });
  });

  it("signs the conformance cases the desktop signs, byte for byte", async () => {
    const device = await keyFromSeed(vectors.device.seed);
    for (const conformance of vectors.deviceRequestConformance) {
      expect(await sha256Text(utf8(conformance.body))).toBe(conformance.bodySha256);
      const input = {
        ...conformance.input,
        method: conformance.input.method as "GET" | "POST",
        principalId: vectors.device.principalId,
        deviceId: vectors.device.deviceId,
        bodySha256: conformance.bodySha256,
      };
      const signed = await signDeviceRequest(device.privateKey, input);
      expect(signed).toEqual({ payload: conformance.payload, signature: conformance.signature });
    }
  });

  it("refuses a seq outside the safe integers", () => {
    expect(() => deviceRequestPayload({ ...requestInput, seq: 2 ** 53 })).toThrow(/seq/);
  });

  it("writes issuedAt in whole seconds", () => {
    expect(issuedAtNow(Date.UTC(2026, 9, 9, 0, 0, 0, 731))).toBe("2026-10-09T00:00:00Z");
  });
});

describe("host responses", () => {
  const expectation = {
    host: host.serverId,
    requestPayload: request.payload,
    status: response.status,
    body: utf8(response.body),
  };

  it("verifies the vector response for the vector request", async () => {
    const read = readHostResponse(b64(utf8(response.payload)), response.signature);
    expect(read.keySeq).toBe(0);
    await expect(verifyHostResponse(read, host.serverKey, expectation)).resolves.toBeUndefined();
  });

  it("refuses an answer to another request, status or body", async () => {
    const read = readHostResponse(b64(utf8(response.payload)), response.signature);
    const cases: [Partial<typeof expectation>, RegExp][] = [
      [
        { requestPayload: request.payload.replace("1791504000000000", "1791504000000001") },
        /another request/,
      ],
      [{ status: 500 }, /another status/],
      [{ body: utf8('{"data":{"deleteMessage":false}}') }, /another body/],
      [{ host: vectors.relay.serverId }, /another host/],
    ];
    for (const [change, error] of cases) {
      await expect(
        verifyHostResponse(read, host.serverKey, { ...expectation, ...change }),
      ).rejects.toThrow(error);
    }
    await expect(verifyHostResponse(read, vectors.relay.serverKey, expectation)).rejects.toThrow(
      /signature/,
    );
  });

  it("refuses a malformed header", () => {
    expect(() => readHostResponse("!!", response.signature)).toThrow(/malformed/);
    expect(() =>
      readHostResponse(b64(utf8(response.payload.replace('"v":2', '"v":1'))), response.signature),
    ).toThrow(/malformed/);
  });
});

describe("host events", () => {
  it("reads and verifies the vector event", async () => {
    const event = readHostEvent(vectors.hostEvent);
    expect(event).toMatchObject({
      host: host.serverId,
      keySeq: 0,
      stream: "c:0199d1a0-0000-7000-8000-000000000003",
      seq: 42,
    });
    expect(event.event.type).toBe("MessageDeleted");
    expect(await verifyHostEventSignature(vectors.hostEvent, host.serverKey)).toBe(true);
    expect(await verifyHostEventSignature(vectors.hostEvent, vectors.relay.serverKey)).toBe(false);
    const altered = {
      ...vectors.hostEvent,
      payload: vectors.hostEvent.payload.replace("42", "43"),
    };
    expect(await verifyHostEventSignature(altered, host.serverKey)).toBe(false);
  });

  it("refuses unknown fields and a missing event", () => {
    const extra = vectors.hostEvent.payload.replace('{"v":2,', '{"v":2,"x":1,');
    expect(() => readHostEvent({ ...vectors.hostEvent, payload: extra })).toThrow(/malformed/);
    const noEvent = JSON.stringify({ ...JSON.parse(vectors.hostEvent.payload), event: null });
    expect(() => readHostEvent({ ...vectors.hostEvent, payload: noEvent })).toThrow(/malformed/);
  });

  it("reads an ephemeral event with a null seq", () => {
    const payload = JSON.stringify({
      ...JSON.parse(vectors.hostEvent.payload),
      stream: "e",
      seq: null,
      event: { type: "TypingStarted" },
    });
    expect(readHostEvent({ payload, signature: "" }).seq).toBeNull();
  });
});
