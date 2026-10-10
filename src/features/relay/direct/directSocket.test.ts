import { afterEach, describe, expect, it, vi } from "vitest";

import { DirectSocket } from "./directSocket";
import {
  browserDirectTransport,
  setDirectTransport,
  type SocketEvent,
  type SocketOpener,
} from "./directTransport";

afterEach(() => setDirectTransport(null));

function withOpener() {
  let emit: (event: SocketEvent) => void = () => undefined;
  let resolveId: (id: number) => void = () => undefined;
  const opener: SocketOpener = {
    open: vi.fn((_server, _protocol, onEvent) => {
      emit = onEvent;
      return new Promise<number>((resolve) => {
        resolveId = resolve;
      });
    }),
    send: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
  setDirectTransport({ ...browserDirectTransport, sessions: true, sockets: opener });
  return { opener, emit: (e: SocketEvent) => emit(e), resolve: (id: number) => resolveId(id) };
}

describe("DirectSocket", () => {
  it("opens through the Tauri side once both the open event and the id arrived", async () => {
    const { opener, emit, resolve } = withOpener();
    const socket = new DirectSocket("rim-direct://rims1_host", "graphql-transport-ws");
    const onopen = vi.fn();
    socket.onopen = onopen;
    expect(opener.open).toHaveBeenCalledWith(
      "rims1_host",
      "graphql-transport-ws",
      expect.any(Function),
    );
    socket.send("early");
    emit({ kind: "open", protocol: "graphql-transport-ws" });
    expect(onopen).not.toHaveBeenCalled();
    resolve(7);
    await vi.waitFor(() => expect(onopen).toHaveBeenCalled());
    expect(socket.readyState).toBe(DirectSocket.OPEN);
    expect(socket.protocol).toBe("graphql-transport-ws");
    expect(opener.send).toHaveBeenCalledWith(7, "early");
  });

  it("passes messages on and reports the close", async () => {
    const { emit, resolve } = withOpener();
    const socket = new DirectSocket("rim-direct://rims1_host", "p");
    const messages: string[] = [];
    const onclose = vi.fn();
    socket.onmessage = ({ data }) => messages.push(data);
    socket.onclose = onclose;
    emit({ kind: "open", protocol: "p" });
    resolve(1);
    await vi.waitFor(() => expect(socket.readyState).toBe(DirectSocket.OPEN));
    emit({ kind: "message", data: '{"type":"connection_ack"}' });
    emit({ kind: "close", code: 4400, reason: "bad" });
    expect(messages).toEqual(['{"type":"connection_ack"}']);
    expect(onclose).toHaveBeenCalledWith({ code: 4400, reason: "bad", wasClean: false });
    expect(socket.readyState).toBe(DirectSocket.CLOSED);
  });

  it("closes at once where the platform cannot open one", async () => {
    setDirectTransport({ ...browserDirectTransport, sockets: null });
    const socket = new DirectSocket("rim-direct://rims1_host", "p");
    const onclose = vi.fn();
    socket.onclose = onclose;
    await vi.waitFor(() => expect(onclose).toHaveBeenCalled());
  });
});
