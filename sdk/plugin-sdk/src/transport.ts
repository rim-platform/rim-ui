import { FrameDecoder, FrameTooLargeError, encodeText } from "./framing.ts";
import { MAX_FRAME_BYTES } from "./generated/protocol.ts";

/**
 * How a plugin exchanges protocol messages with the host: each message is the
 * JSON text of one JSON-RPC 2.0 message, whatever carries it.
 */
export interface Transport {
  /** Messages from the host, in order. Ends when the host closes the connection. */
  readonly messages: AsyncIterable<string>;
  /** Send one message to the host. */
  send(text: string): void;
  /** Close the connection from the plugin's side. */
  close(): void;
}

/** A writable byte stream, such as `process.stdout`. */
export interface FrameSink {
  write(chunk: Uint8Array, callback?: (error?: Error | null) => void): boolean;
}

/** A `MessagePort` as a plugin frame gets it in `globalThis.rimPluginPort`. */
export interface PortLike {
  postMessage(message: string): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  close(): void;
}

const encoder = new TextEncoder();

/**
 * Protocol messages over a byte stream pair, each in a frame: a 4-byte
 * little-endian length, then that many bytes of UTF-8 JSON. A frame whose body
 * is not UTF-8 arrives as an empty message, which is not JSON, so the plugin
 * drops it and the stream stays usable. A frame over the size limit ends the
 * stream with a {@link FrameTooLargeError}.
 */
export function streamTransport(
  input: AsyncIterable<Uint8Array | string>,
  output: FrameSink,
): Transport & { flush(): Promise<void> } {
  return {
    messages: (async function* () {
      const decoder = new FrameDecoder();
      for await (const chunk of input) {
        for (const frame of decoder.pushText(
          typeof chunk === "string" ? encoder.encode(chunk) : chunk,
        )) {
          yield frame ?? "";
        }
      }
    })(),
    send(text) {
      output.write(encodeText(text));
    },
    /** Resolves once everything written before it has been handed to the stream. */
    flush() {
      return new Promise<void>((done) => output.write(new Uint8Array(0), () => done()));
    },
    close() {
      // The stream belongs to the process; it closes when the plugin exits.
    },
  };
}

/**
 * Protocol messages over a `MessagePort`, one JSON text per `postMessage`, as a
 * WebSandboxed plugin's frame speaks them. Messages that arrive before the
 * plugin starts listening wait in the port's queue. Something other than a
 * string arrives as an empty message, which the plugin drops; a message over
 * the size limit ends the connection.
 */
export function portTransport(port: PortLike): Transport {
  const queue: string[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  let failure: Error | null = null;

  port.onmessage = (event) => {
    if (closed) return;
    const data = typeof event.data === "string" ? event.data : "";
    const bytes = data.length > MAX_FRAME_BYTES ? data.length : encoder.encode(data).length;
    if (bytes > MAX_FRAME_BYTES) {
      failure = new FrameTooLargeError(bytes);
      closed = true;
    } else {
      queue.push(data);
    }
    wake?.();
  };

  // Where the platform reports it, the other end closing ends the connection.
  const events = port as Partial<Pick<EventTarget, "addEventListener">>;
  events.addEventListener?.("close", () => {
    closed = true;
    wake?.();
  });

  return {
    messages: (async function* () {
      for (;;) {
        while (queue.length > 0) yield queue.shift() as string;
        if (failure) throw failure;
        if (closed) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = null;
      }
    })(),
    send(text) {
      const bytes = encoder.encode(text).length;
      if (bytes > MAX_FRAME_BYTES) throw new FrameTooLargeError(bytes);
      port.postMessage(text);
    },
    close() {
      closed = true;
      port.onmessage = null;
      port.close();
      wake?.();
    },
  };
}
