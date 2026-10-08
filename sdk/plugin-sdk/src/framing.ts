import { MAX_FRAME_BYTES } from "./generated/protocol.ts";

/** Byte length of the little-endian length prefix in front of every frame. */
const HEADER_BYTES = 4;

/**
 * A frame longer than {@link MAX_FRAME_BYTES}. The stream cannot be resynchronised
 * after one arrives, so the connection has to end.
 */
export class FrameTooLargeError extends Error {
  /** Length the frame claimed or would have had, in bytes. */
  readonly length: number;

  constructor(length: number) {
    super(`frame of ${length} bytes is over the ${MAX_FRAME_BYTES}-byte limit`);
    this.name = "FrameTooLargeError";
    this.length = length;
  }
}

/** One frame read off the stream: a parsed JSON value, or why its body could not be parsed. */
export type DecodedFrame = { ok: true; value: unknown } | { ok: false; error: string };

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

/**
 * Encode one JSON-RPC message as a frame: a 4-byte little-endian length, then
 * that many bytes of UTF-8 JSON.
 *
 * @throws FrameTooLargeError when the JSON is over {@link MAX_FRAME_BYTES}.
 */
export function encodeFrame(message: unknown): Uint8Array {
  const body = encoder.encode(JSON.stringify(message));
  if (body.length > MAX_FRAME_BYTES) throw new FrameTooLargeError(body.length);
  const frame = new Uint8Array(HEADER_BYTES + body.length);
  new DataView(frame.buffer).setUint32(0, body.length, true);
  frame.set(body, HEADER_BYTES);
  return frame;
}

/**
 * Splits a byte stream into frames. Chunks may end anywhere, including inside
 * the length prefix; a frame is returned once all of its bytes have arrived.
 */
export class FrameDecoder {
  private chunks: Uint8Array[] = [];
  private buffered = 0;

  /**
   * Add bytes from the stream and return every frame they complete, in order.
   * A frame whose body is not UTF-8 JSON comes back with `ok: false`; the
   * protocol says to log and drop it, and the stream stays usable.
   *
   * @throws FrameTooLargeError when a length prefix is over {@link MAX_FRAME_BYTES}.
   */
  push(chunk: Uint8Array): DecodedFrame[] {
    if (chunk.length > 0) {
      this.chunks.push(chunk);
      this.buffered += chunk.length;
    }
    const frames: DecodedFrame[] = [];
    while (this.buffered >= HEADER_BYTES) {
      const header = this.peek(HEADER_BYTES);
      const length = new DataView(header.buffer, header.byteOffset, HEADER_BYTES).getUint32(
        0,
        true,
      );
      if (length > MAX_FRAME_BYTES) throw new FrameTooLargeError(length);
      if (this.buffered < HEADER_BYTES + length) break;
      frames.push(parse(this.take(HEADER_BYTES + length).subarray(HEADER_BYTES)));
    }
    return frames;
  }

  /** Bytes received that do not make up a whole frame yet. */
  get pendingBytes(): number {
    return this.buffered;
  }

  private peek(count: number): Uint8Array {
    if (this.chunks[0].length < count) this.chunks = [concat(this.chunks, this.buffered)];
    return this.chunks[0].subarray(0, count);
  }

  private take(count: number): Uint8Array {
    const all = this.chunks.length === 1 ? this.chunks[0] : concat(this.chunks, this.buffered);
    this.chunks = all.length > count ? [all.subarray(count)] : [];
    this.buffered -= count;
    return all.subarray(0, count);
  }
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function parse(body: Uint8Array): DecodedFrame {
  try {
    return { ok: true, value: JSON.parse(decoder.decode(body)) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
