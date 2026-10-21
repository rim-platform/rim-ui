/**
 * This app's own server as other servers and people know it: its **identity origin**, apart from
 * the **transport origin** the app sends its requests to (`getApiOrigin`).
 *
 * On the desktop the two are the same: the configured endpoint is the server's own address. The
 * web app talks to the server the page came from, and a deployment may serve the web app on a
 * domain of its own while the server keeps its name (the web app at `chat.example`, the server at
 * `relay.example`). The server's name is then the origin of the server-to-server endpoint its
 * signed descriptor declares. The web app fetches the discovery document from the transport
 * origin, without following redirects, and verifies it against the origin it declares; a server
 * with server-to-server traffic off declares none and is known by the transport origin.
 */

import { useEffect, useSyncExternalStore } from "react";
import { isTauri } from "@tauri-apps/api/core";

import { endpointHost, getApiOrigin, getGraphqlEndpoint } from "../../../core/graphql/config";
import { relayCrypto, type DiscoveryResult } from "../crypto/relayCrypto";
import { directTransport } from "../direct/directTransport";

/** The server-to-server endpoint's path under the server's base URL. */
const S2S_PATH = "/s2s/v1";

/** This app's server's discovery document, verified against the origin the server is known by. */
export interface OwnDiscovery {
  /** The identity origin, e.g. `https://relay.example`, without a trailing `/`. */
  origin: string;
  /** The document as fetched, to pin it with. */
  document: string;
  verified: DiscoveryResult;
}

/** What `useServerOrigin` answers: the origin once read, and whether reading it failed. */
export interface ServerOriginView {
  origin: string | null;
  failed: boolean;
}

const EMPTY: ServerOriginView = { origin: null, failed: false };

let view: ServerOriginView = EMPTY;
let pending: Promise<string> | null = null;
let desktopView: ServerOriginView = EMPTY;
const listeners = new Set<() => void>();

function publish(next: ServerOriginView): void {
  if (next.origin === view.origin && next.failed === view.failed) return;
  view = next;
  for (const listener of listeners) listener();
}

function fields(text: unknown): Record<string, unknown> | null {
  if (typeof text !== "string") return null;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * The base URL a discovery document's descriptor declares, read before it is verified: its
 * `endpoints.s2s` with `/s2s/v1` taken off.
 *
 * @param document - A discovery document as fetched.
 * @returns The base URL without a trailing `/`, or `null` when the descriptor names no
 *   server-to-server endpoint or one of another shape.
 */
export function declaredOrigin(document: string): string | null {
  const descriptor = fields(document)?.descriptor;
  const payload =
    descriptor && typeof descriptor === "object"
      ? fields((descriptor as Record<string, unknown>).payload)
      : null;
  const endpoints = payload?.endpoints;
  const s2s =
    endpoints && typeof endpoints === "object"
      ? (endpoints as Record<string, unknown>).s2s
      : undefined;
  if (typeof s2s !== "string" || !s2s.endsWith(S2S_PATH)) return null;
  const base = s2s.slice(0, -S2S_PATH.length);
  try {
    const url = new URL(base);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.search || url.hash || url.username || url.password) return null;
  } catch {
    return null;
  }
  return base;
}

/**
 * Whether a discovery document says its server is full: its unsigned, advisory
 * `registration.full`.
 *
 * @param document - A discovery document as fetched.
 * @returns `true` only when the document says so; a missing or malformed field reads as not full.
 */
export function discoveryRegistrationFull(document: string): boolean {
  const registration = fields(document)?.registration;
  return (
    !!registration &&
    typeof registration === "object" &&
    (registration as Record<string, unknown>).full === true
  );
}

/**
 * Fetch this app's server's discovery document from the transport origin and verify it: on the
 * desktop against that origin, in the web app against the origin the document declares (the
 * transport origin when it declares none). Remembers the identity origin it read.
 *
 * @returns The identity origin, the document and what it verifies to.
 * @throws When the document cannot be fetched or does not verify.
 */
export async function readOwnDiscovery(): Promise<OwnDiscovery> {
  const transport = getApiOrigin();
  const document = await directTransport().discovery(transport);
  const origin = (!isTauri() && declaredOrigin(document)) || transport;
  const verified = await relayCrypto().verifyDiscovery(document, origin);
  if (!isTauri()) publish({ origin, failed: false });
  return { origin, document, verified };
}

/**
 * The origin this app's server is known by, e.g. for the relays a profile card lists. The
 * desktop answers its configured server; the web app reads the discovery document once per page
 * and keeps the answer.
 *
 * @throws When the web app cannot read or verify its server's discovery document.
 */
export function serverOrigin(): Promise<string> {
  if (isTauri()) return Promise.resolve(getApiOrigin());
  if (view.origin !== null) return Promise.resolve(view.origin);
  pending ??= readOwnDiscovery()
    .then((own) => own.origin)
    .catch((err: unknown) => {
      publish({ origin: null, failed: true });
      throw err;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

/**
 * The GraphQL endpoint this app's server is known by, as a device-link code names it: the
 * configured endpoint when the identity origin is the transport origin (always on the desktop),
 * else the identity origin's `/api`.
 *
 * @throws When the web app cannot read its server's identity origin.
 */
export async function serverEndpoint(): Promise<string> {
  const origin = await serverOrigin();
  return origin === getApiOrigin() ? getGraphqlEndpoint() : `${origin}/api`;
}

/** Forget the identity origin read in this page (tests). */
export function resetServerOrigin(): void {
  pending = null;
  publish(EMPTY);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): ServerOriginView {
  if (!isTauri()) return view;
  const origin = getApiOrigin();
  if (desktopView.origin !== origin) desktopView = { origin, failed: false };
  return desktopView;
}

/**
 * The identity origin for a component, read on first use: `origin` is `null` while it is read
 * and when reading it failed (`failed`).
 */
export function useServerOrigin(): ServerOriginView {
  const current = useSyncExternalStore(subscribe, snapshot);
  useEffect(() => {
    if (current.origin === null && !current.failed) void serverOrigin().catch(() => undefined);
  }, [current]);
  return current;
}

/**
 * The host of this app's server as people read it: the identity origin's host, or the transport
 * origin's until the identity origin is known.
 */
export function useServerHost(): string {
  const { origin } = useServerOrigin();
  return endpointHost(origin ?? getApiOrigin());
}
