/**
 * The direct connection: when the relay fails, the desktop app talks to a host itself.
 *
 * - **When.** After 60 seconds of failed relay requests for a host (or the relay's WebSocket
 *   down that long), or when "messages may be missing" stays after reconciling. The app asks
 *   once per host ("Connect directly to <host>? It will see your IP address") and remembers
 *   the answer.
 * - **How.** It fetches the host's discovery document directly and checks it against the pin,
 *   signs in there with this device's key (the proof's audience is the host's server id), and
 *   uses the host's `/api` and `/api/ws` as a local client would, under a banner. The host's
 *   items on the relay stream wait meanwhile.
 * - **Back.** It probes the relay every 60 seconds; after two successes it renews the
 *   delegations, takes the host's stream heads as the baseline, runs the waiting relay items
 *   (whatever the direct connection applied is dropped by `(host, stream, seq)`) and closes
 *   the direct connection.
 */

import { create } from "zustand";

import { logger } from "../../../core/logger";
import type { WorkspaceEvent } from "../../../core/events/types";
import type { Statement } from "../../key-identity/browser/statements";
import {
  KEY_LOGIN_CHALLENGE_MUTATION,
  LOGIN_WITH_KEY_MUTATION,
  STREAM_HEADS_QUERY,
} from "../api/documents";
import type { ServerPin } from "../state/relayDb";
import type { RelayStreamProcessor } from "../stream/relayStream";
import { directRequest } from "./directGraphql";
import type { DirectTransport } from "./directTransport";

/** How long relay failures last before the app offers a direct connection. */
export const RELAY_FAILURE_MS = 60_000;
/** How often the relay is probed while connected directly. */
export const PROBE_MS = 60_000;
/** Probes in a row that must succeed before switching back. */
export const PROBES_TO_RETURN = 2;

export type DirectConsent = "yes" | "no";

interface DirectState {
  /** The host the app is asking about, if any. */
  offer: string | null;
  consent: Record<string, DirectConsent>;
  /** Hosts connected directly, and since when. */
  connected: Record<string, number>;
  connecting: string[];
  errors: Record<string, string>;
  setOffer: (host: string | null) => void;
  setConsent: (host: string, answer: DirectConsent) => void;
  setConnected: (host: string, since: number | null) => void;
  setConnecting: (host: string, on: boolean) => void;
  setError: (host: string, error: string | null) => void;
  reset: () => void;
}

export const useDirectStore = create<DirectState>((set) => ({
  offer: null,
  consent: {},
  connected: {},
  connecting: [],
  errors: {},
  setOffer: (offer) => set({ offer }),
  setConsent: (host, answer) => set((s) => ({ consent: { ...s.consent, [host]: answer } })),
  setConnected: (host, since) =>
    set((s) => {
      const connected = { ...s.connected };
      if (since === null) delete connected[host];
      else connected[host] = since;
      return { connected };
    }),
  setConnecting: (host, on) =>
    set((s) => ({
      connecting: on
        ? [...s.connecting.filter((h) => h !== host), host]
        : s.connecting.filter((h) => h !== host),
    })),
  setError: (host, error) =>
    set((s) => {
      const errors = { ...s.errors };
      if (error === null) delete errors[host];
      else errors[host] = error;
      return { errors };
    }),
  reset: () => set({ offer: null, consent: {}, connected: {}, connecting: [], errors: {} }),
}));

/** Whether the app is connected to `host` directly. */
export function isDirect(host: string): boolean {
  return host in useDirectStore.getState().connected;
}

/** What decides whether to offer a direct connection. */
export interface TriggerInput {
  hosts: string[];
  failingFor(host: string): number;
  /** How long the relay's WebSocket has been down, in ms; 0 while it is up. */
  relayDownFor: number;
  /** Hosts with a space whose messages may be missing after reconciling. */
  missing: string[];
  connected: string[];
  consent: Record<string, DirectConsent>;
  /** Hosts already asked about in this run. */
  asked: string[];
}

/** What to do about each host: connect (consent given), ask, or nothing. Pure. */
export function directDecisions(input: TriggerInput): { connect: string[]; ask: string[] } {
  const connect: string[] = [];
  const ask: string[] = [];
  for (const host of input.hosts) {
    if (input.connected.includes(host)) continue;
    const failing =
      input.failingFor(host) >= RELAY_FAILURE_MS ||
      input.relayDownFor >= RELAY_FAILURE_MS ||
      input.missing.includes(host);
    if (!failing) continue;
    const consent = input.consent[host];
    if (consent === "yes") connect.push(host);
    else if (consent === undefined && !input.asked.includes(host)) ask.push(host);
  }
  return { connect, ask };
}

/** What a direct connection needs from the rest of the app; injected so it can be tested. */
export interface DirectDeps {
  transport: DirectTransport;
  principalId: string;
  loadPin(host: string): Promise<ServerPin | null>;
  /** Check a directly fetched discovery document against the pin (and update it). */
  pinDiscovery(document: string, origin: string, host: string): Promise<ServerPin>;
  signLogin(host: string, challenge: { challengeId: string; nonce: string }): Promise<Statement>;
  /** The spaces this account uses on `host`. */
  spacesOf(host: string): string[];
  processor(): RelayStreamProcessor | null;
  /** Open the host's event stream for `spaceIds`; returns a function that closes it. */
  openEvents(
    host: string,
    spaceIds: string[],
    onEvent: (event: WorkspaceEvent, spaceId: string) => void,
  ): () => void;
  apply(event: WorkspaceEvent, spaceId: string): void;
  /** Throws while the relay is unreachable. */
  probeRelay(): Promise<void>;
  /** Renew the delegations of the spaces on `host` through the relay. */
  renew(host: string): Promise<void>;
  saveConsent(host: string, answer: DirectConsent): Promise<void>;
  now(): number;
}

interface Connection {
  closeEvents: () => void;
  successes: number;
}

/** The direct connections of the signed-in account. */
export class DirectConnections {
  private readonly deps: DirectDeps;
  private readonly connections = new Map<string, Connection>();
  private readonly asked = new Set<string>();

  constructor(deps: DirectDeps) {
    this.deps = deps;
  }

  /** Act on the trigger rules: connect where the person agreed, ask once where not asked. */
  async check(input: Omit<TriggerInput, "connected" | "consent" | "asked">): Promise<void> {
    const store = useDirectStore.getState();
    const { connect, ask } = directDecisions({
      ...input,
      connected: [...this.connections.keys(), ...store.connecting],
      consent: store.consent,
      asked: [...this.asked],
    });
    for (const host of connect) await this.connect(host).catch(() => undefined);
    const first = ask[0];
    if (first && !store.offer) this.ask(first);
  }

  /** Ask the person about `host` (also from the "Connect directly" button). */
  ask(host: string): void {
    this.asked.add(host);
    useDirectStore.getState().setOffer(host);
  }

  /** The person answered the question about `host`. */
  async answer(host: string, answer: DirectConsent): Promise<void> {
    const store = useDirectStore.getState();
    store.setOffer(null);
    store.setConsent(host, answer);
    await this.deps.saveConsent(host, answer).catch(() => undefined);
    if (answer === "yes") await this.connect(host).catch(() => undefined);
  }

  /** Sign in to `host` directly and take its events from its own WebSocket. */
  async connect(host: string): Promise<void> {
    const store = useDirectStore.getState();
    if (this.connections.has(host) || store.connecting.includes(host)) return;
    const { transport } = this.deps;
    if (!transport.sessions || !transport.sockets) {
      throw new Error("Connecting directly needs the desktop app.");
    }
    store.setConnecting(host, true);
    store.setError(host, null);
    try {
      const pinned = await this.deps.loadPin(host);
      if (!pinned) throw new Error(`${host} is not pinned`);
      const document = await transport.discovery(pinned.origin);
      const pin = await this.deps.pinDiscovery(document, pinned.origin, host);
      const graphql = pin.endpoints?.graphql ?? `${pin.origin}/api`;
      const websocket = pin.endpoints?.websocket ?? `${pin.origin.replace(/^http/, "ws")}/api/ws`;
      await transport.open(host, { graphql, websocket });
      const challenge = await directRequest<{
        keyLoginChallenge: { challengeId: string; nonce: string };
      }>(host, KEY_LOGIN_CHALLENGE_MUTATION, {}, transport);
      const proof = await this.deps.signLogin(host, challenge.keyLoginChallenge);
      await directRequest(host, LOGIN_WITH_KEY_MUTATION, { proof }, transport);
      const closeEvents = this.deps.openEvents(host, this.deps.spacesOf(host), (event, spaceId) =>
        this.deps.apply(event, spaceId),
      );
      this.connections.set(host, { closeEvents, successes: 0 });
      this.deps.processor()?.holdHost(host);
      useDirectStore.getState().setConnected(host, this.deps.now());
    } catch (err) {
      await transport.close(host).catch(() => undefined);
      const message = err instanceof Error ? err.message : String(err);
      useDirectStore.getState().setError(host, message);
      logger.warn(`[RIM:relay] connecting to ${host} directly failed:`, err);
      throw err;
    } finally {
      useDirectStore.getState().setConnecting(host, false);
    }
  }

  /** Probe the relay once for every direct connection; two successes in a row switch back. */
  async probe(): Promise<void> {
    if (this.connections.size === 0) return;
    let up = true;
    try {
      await this.deps.probeRelay();
    } catch {
      up = false;
    }
    for (const [host, connection] of this.connections) {
      connection.successes = up ? connection.successes + 1 : 0;
      if (connection.successes >= PROBES_TO_RETURN) {
        await this.switchBack(host).catch((err: unknown) => {
          connection.successes = 0;
          logger.warn(`[RIM:relay] switching ${host} back to the relay failed:`, err);
        });
      }
    }
  }

  /**
   * Back to the relay: renew the delegations, take the host's stream heads (asked directly,
   * before the connection closes) as the baseline, run the relay items that waited, close.
   */
  async switchBack(host: string): Promise<void> {
    const connection = this.connections.get(host);
    if (!connection) return;
    await this.deps.renew(host);
    const processor = this.deps.processor();
    const streams = processor?.streamsOf(host) ?? new Map<string, string[]>();
    for (const spaceId of this.deps.spacesOf(host)) {
      const known = streams.get(spaceId) ?? [];
      const wanted = new Set([...known, "w", `u:${this.deps.principalId}`]);
      streams.set(spaceId, [...wanted]);
    }
    const heads = new Map<string, Map<string, number>>();
    for (const [spaceId, names] of streams) {
      const answer = await directRequest<{ streamHeads: { stream: string; seq: string }[] }>(
        host,
        STREAM_HEADS_QUERY,
        { serverId: spaceId, streams: names },
        this.deps.transport,
      );
      heads.set(spaceId, new Map(answer.streamHeads.map((h) => [h.stream, Number(h.seq)])));
    }
    this.connections.delete(host);
    useDirectStore.getState().setConnected(host, null);
    const resumed = processor?.resumeHost(host, heads);
    connection.closeEvents();
    await this.deps.transport.close(host).catch(() => undefined);
    await resumed;
  }

  /** Close every direct connection (sign-out). */
  closeAll(): void {
    for (const [host, connection] of this.connections) {
      connection.closeEvents();
      void this.deps.transport.close(host).catch(() => undefined);
      void this.deps.processor()?.resumeHost(host, new Map());
      useDirectStore.getState().setConnected(host, null);
    }
    this.connections.clear();
  }

  /** Send a GraphQL body to `host` over the direct connection, or `null` when there is none. */
  send(host: string, body: string): Promise<Response> | null {
    if (!this.connections.has(host)) return null;
    return this.deps.transport.graphql(host, body).then(
      (res) =>
        new Response(res.body, {
          status: res.status,
          headers: { "Content-Type": res.contentType ?? "application/json" },
        }),
    );
  }
}

let active: DirectConnections | null = null;

export function setActiveDirect(connections: DirectConnections | null): void {
  active = connections;
}

/** The direct connections of the signed-in account, while the relay runs. */
export function activeDirect(): DirectConnections | null {
  return active;
}
