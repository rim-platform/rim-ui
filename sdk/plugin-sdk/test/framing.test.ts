import { describe, expect, it } from "vitest";

import { encodeFrame, FrameDecoder, FrameTooLargeError } from "../src/framing.ts";
import { MAX_FRAME_BYTES } from "../src/generated/protocol.ts";

function header(length: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, length, true);
  return bytes;
}

describe("framing", () => {
  it("prefixes UTF-8 JSON with its little-endian byte length", () => {
    const message = { jsonrpc: "2.0", method: "rim.log", params: { message: "Dvořák ✓" } };
    const frame = encodeFrame(message);
    const body = new TextEncoder().encode(JSON.stringify(message));
    expect(Array.from(frame.subarray(0, 4))).toEqual(Array.from(header(body.length)));
    expect(frame.subarray(4)).toEqual(body);
  });

  it("decodes frames however the stream is chunked", () => {
    const messages = [{ id: 1 }, { id: -1, method: "rim.heartbeat" }, { text: "ž".repeat(300) }];
    const bytes = new Uint8Array(messages.flatMap((m) => Array.from(encodeFrame(m))));
    for (const size of [1, 3, 7, bytes.length]) {
      const decoder = new FrameDecoder();
      const decoded = [];
      for (let i = 0; i < bytes.length; i += size) {
        decoded.push(...decoder.push(bytes.subarray(i, i + size)));
      }
      expect(decoded).toEqual(messages.map((value) => ({ ok: true, value })));
      expect(decoder.pendingBytes).toBe(0);
    }
  });

  it("reports a body that is not JSON and keeps reading", () => {
    const junk = new TextEncoder().encode("{not json");
    const decoder = new FrameDecoder();
    const frames = decoder.push(
      new Uint8Array([...header(junk.length), ...junk, ...encodeFrame({ id: 2 })]),
    );
    expect(frames[0].ok).toBe(false);
    expect(frames[1]).toEqual({ ok: true, value: { id: 2 } });
  });

  it("rejects a length prefix over the frame limit", () => {
    expect(() => new FrameDecoder().push(header(MAX_FRAME_BYTES + 1))).toThrow(FrameTooLargeError);
  });

  it("refuses to encode a message over the frame limit", () => {
    expect(() => encodeFrame({ data: "x".repeat(MAX_FRAME_BYTES) })).toThrow(FrameTooLargeError);
  });
});
