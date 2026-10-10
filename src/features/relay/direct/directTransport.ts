/**
 * Talking to another server directly instead of through the relay: a host when the relay is
 * unreachable, a host that has not acknowledged a revocation, a new relay while switching.
 *
 * On the desktop the Tauri side carries the bytes and keeps each server's cookies in its own
 * jar (`relay_direct_*`), so a session there never reaches the webview. A browser cannot hold
 * cookies for another origin: the web app can fetch a discovery document and send calls that
 * need no session (`applyRemoteRevocation`), and nothing else.
 */

import { Channel, invoke, isTauri } from "@tauri-apps/api/core";

import { keyCommand } from "../../key-identity/api/keyBackend";

/** A server's answer to a direct request. */
export interface DirectResponse {
  status: number;
  body: string;
  contentType: string | null;
}

/** Where a server answers its own clients. */
export interface DirectEndpoints {
  graphql: string;
  websocket: string;
}

/** What a direct socket reports. */
export type SocketEvent =
  | { kind: "open"; protocol: string }
  | { kind: "message"; data: string }
  | { kind: "close"; code: number; reason: string }
  | { kind: "error"; message: string };

/** Opens sockets that carry a server's session cookie. */
export interface SocketOpener {
  open(serverId: string, protocol: string, onEvent: (event: SocketEvent) => void): Promise<number>;
  send(socketId: number, data: string): Promise<void>;
  close(socketId: number, code?: number, reason?: string): Promise<void>;
}

export interface DirectTransport {
  /** Whether a session (cookies, a socket) can be held with another server. */
  readonly sessions: boolean;
  /** `GET <origin>/.well-known/rim-server`, directly. */
  discovery(origin: string): Promise<string>;
  /** Start (or keep) a direct session with `serverId` at its verified endpoints. */
  open(serverId: string, endpoints: DirectEndpoints): Promise<void>;
  /** POST a GraphQL body to `serverId`. */
  graphql(serverId: string, body: string): Promise<DirectResponse>;
  /** End the direct session with `serverId`. */
  close(serverId: string): Promise<void>;
  /** `null` where sockets to another server cannot carry a session. */
  readonly sockets: SocketOpener | null;
}

/** The desktop: the Tauri side's own HTTP client and cookie jars. */
export const tauriDirectTransport: DirectTransport = {
  sessions: true,
  discovery: (origin) => keyCommand<string>("relay_direct_discovery", { origin }),
  open: async (serverId, endpoints) => {
    await keyCommand<null>("relay_direct_open", { serverId, ...endpoints });
  },
  graphql: (serverId, body) =>
    keyCommand<DirectResponse>("relay_direct_graphql", { serverId, body }),
  close: async (serverId) => {
    await keyCommand<null>("relay_direct_close", { serverId });
  },
  sockets: {
    open: (serverId, protocol, onEvent) => {
      const channel = new Channel<SocketEvent>();
      channel.onmessage = onEvent;
      return invoke<number>("relay_direct_socket_open", { serverId, protocol, onEvent: channel });
    },
    send: async (socketId, data) => {
      await invoke("relay_direct_socket_send", { socketId, data });
    },
    close: async (socketId, code, reason) => {
      await invoke("relay_direct_socket_close", {
        socketId,
        code: code ?? null,
        reason: reason ?? null,
      });
    },
  },
};

const DISCOVERY_PATH = "/.well-known/rim-server";
const DISCOVERY_MAX_BYTES = 64 * 1024;

const browserEndpoints = new Map<string, DirectEndpoints>();

/** The web app: plain `fetch` without credentials. */
export const browserDirectTransport: DirectTransport = {
  sessions: false,
  async discovery(origin) {
    const res = await fetch(`${origin.replace(/\/+$/, "")}${DISCOVERY_PATH}`, {
      credentials: "omit",
      redirect: "error",
    });
    if (!res.ok) throw new Error(`the discovery document answered ${res.status}`);
    const text = await res.text();
    if (new TextEncoder().encode(text).length > DISCOVERY_MAX_BYTES) {
      throw new Error("the discovery document is too large");
    }
    return text;
  },
  open: async (serverId, endpoints) => {
    browserEndpoints.set(serverId, endpoints);
  },
  async graphql(serverId, body) {
    const endpoints = browserEndpoints.get(serverId);
    if (!endpoints) throw new Error(`no direct session with ${serverId}`);
    const res = await fetch(endpoints.graphql, {
      method: "POST",
      body,
      credentials: "omit",
      redirect: "error",
      headers: { "Content-Type": "application/json" },
    });
    return {
      status: res.status,
      body: await res.text(),
      contentType: res.headers.get("Content-Type"),
    };
  },
  close: async (serverId) => {
    browserEndpoints.delete(serverId);
  },
  sockets: null,
};

let override: DirectTransport | null = null;

/** Use `transport` instead of the platform's (tests). */
export function setDirectTransport(transport: DirectTransport | null): void {
  override = transport;
}

/** The direct transport of this platform. */
export function directTransport(): DirectTransport {
  return override ?? (isTauri() ? tauriDirectTransport : browserDirectTransport);
}
