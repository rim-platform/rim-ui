/**
 * A `WebSocket` for `graphql-ws` whose bytes travel through the Tauri side, which opens the
 * socket with the server's session cookie. The URL names the server: `rim-direct://<server id>`.
 */

import { directTransport, type SocketEvent } from "./directTransport";

interface MessageLike {
  data: string;
}

interface CloseLike {
  code: number;
  reason: string;
  wasClean: boolean;
}

export class DirectSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly url: string;
  readyState: number = DirectSocket.CONNECTING;
  protocol = "";
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: MessageLike) => void) | null = null;
  onclose: ((event: CloseLike) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  private id: number | null = null;
  private opened = false;
  private queue: string[] = [];

  constructor(url: string, protocol?: string | string[]) {
    this.url = url;
    const serverId = url.replace(/^rim-direct:\/\//, "").split("/")[0];
    const opener = directTransport().sockets;
    const wanted = Array.isArray(protocol) ? protocol[0] : (protocol ?? "");
    if (!opener) {
      queueMicrotask(() => this.closed(1006, "this app cannot connect directly"));
      return;
    }
    opener
      .open(serverId, wanted, (event) => this.handle(event))
      .then((id) => {
        this.id = id;
        if (this.readyState === DirectSocket.CLOSING || this.readyState === DirectSocket.CLOSED) {
          void opener.close(id);
          return;
        }
        if (this.opened) this.fireOpen();
      })
      .catch((err: unknown) => {
        this.onerror?.(err);
        this.closed(1006, err instanceof Error ? err.message : String(err));
      });
  }

  private handle(event: SocketEvent): void {
    switch (event.kind) {
      case "open":
        this.protocol = event.protocol;
        this.opened = true;
        if (this.id !== null) this.fireOpen();
        return;
      case "message":
        if (this.readyState === DirectSocket.OPEN) this.onmessage?.({ data: event.data });
        return;
      case "error":
        this.onerror?.(new Error(event.message));
        return;
      case "close":
        this.closed(event.code, event.reason);
        return;
    }
  }

  private fireOpen(): void {
    if (this.readyState !== DirectSocket.CONNECTING) return;
    this.readyState = DirectSocket.OPEN;
    this.onopen?.({});
    for (const data of this.queue.splice(0)) this.send(data);
  }

  private closed(code: number, reason: string): void {
    if (this.readyState === DirectSocket.CLOSED) return;
    this.readyState = DirectSocket.CLOSED;
    this.onclose?.({ code, reason, wasClean: code === 1000 });
  }

  send(data: string): void {
    if (this.readyState !== DirectSocket.OPEN || this.id === null) {
      this.queue.push(data);
      return;
    }
    void directTransport()
      .sockets?.send(this.id, data)
      .catch((err: unknown) => this.onerror?.(err));
  }

  close(code?: number, reason?: string): void {
    if (this.readyState === DirectSocket.CLOSED) return;
    this.readyState = DirectSocket.CLOSING;
    if (this.id !== null) void directTransport().sockets?.close(this.id, code, reason);
    this.closed(code ?? 1000, reason ?? "");
  }
}
