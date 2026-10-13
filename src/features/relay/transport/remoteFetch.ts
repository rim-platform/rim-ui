/**
 * Requests to a space hosted on another server. They go to this app's relay at
 * `/api/remote/<host server id>/<host-relative path>` with a device-signed request; the relay
 * forwards them unchanged and returns the host's answer, which must carry a host-signed
 * response for exactly this request (status and body included). Anything else counts as a
 * relay failure, never as an answer. A `409 replay` moves this device's counter above the
 * host's `highestSeq` and signs once more.
 */

import { GraphQLClient } from "graphql-request";

import { csrfHeader } from "../../../core/graphql/csrf";
import { getApiOrigin } from "../../../core/graphql/config";
import { utf8 } from "../../key-identity/browser/bytes";
import { relayCrypto } from "../crypto/relayCrypto";
import { deviceRequestHeaders, issuedAtNow, sha256Text } from "../crypto/serverStatements";
import { hostKeyAt } from "../state/serverPins";
import { useRelayStore } from "../state/useRelayStore";
import { recordRelayFailure, recordRelaySuccess } from "./relayHealth";
import { takeSeq } from "./requestSeq";

/** The relay or the host did not give a verifiable answer. */
export class RelayFailure extends Error {
  readonly host: string;
  readonly status: number | null;

  constructor(host: string, message: string, status: number | null = null) {
    super(message);
    this.name = "RelayFailure";
    this.host = host;
    this.status = status;
  }
}

/** A host's verified answer. */
export interface RemoteResponse {
  status: number;
  body: Uint8Array;
  contentType: string | null;
}

export interface RemoteRequest {
  method: "GET" | "POST";
  body?: Uint8Array;
  contentType?: string;
}

const EMPTY = new Uint8Array();

/** The `highestSeq` of a `409 replay` answer, or `null` for any other answer. */
export function replayHighestSeq(response: RemoteResponse): number | null {
  if (response.status !== 409) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(response.body)) as {
      error?: unknown;
      highestSeq?: unknown;
    };
    if (parsed.error !== "replay" || typeof parsed.highestSeq !== "string") return null;
    const highest = Number(parsed.highestSeq);
    return Number.isSafeInteger(highest) ? highest : null;
  } catch {
    return null;
  }
}

async function attempt(
  host: string,
  path: string,
  request: RemoteRequest,
  floor: number,
): Promise<RemoteResponse> {
  const account = useRelayStore.getState().account;
  if (!account?.deviceId) {
    throw new RelayFailure(host, "this device holds no key to sign requests for that space");
  }
  const crypto = relayCrypto();
  const body = request.body ?? EMPTY;
  const seq = await takeSeq(account.deviceId, host, floor);
  const signed = await crypto.signDeviceRequest(account.endpoint, account.principalId, {
    host,
    method: request.method,
    path,
    seq,
    bodySha256: await sha256Text(body),
    issuedAt: issuedAtNow(),
  });
  const headers: Record<string, string> = deviceRequestHeaders(signed);
  if (request.contentType) headers["Content-Type"] = request.contentType;
  if (request.method === "POST") Object.assign(headers, csrfHeader());

  let res: Response;
  try {
    res = await fetch(`${getApiOrigin()}/api/remote/${host}${path}`, {
      method: request.method,
      body: request.method === "POST" ? (body as BodyInit) : undefined,
      credentials: "include",
      headers,
    });
  } catch (err) {
    throw new RelayFailure(host, err instanceof Error ? err.message : "the relay is unreachable");
  }
  const received = new Uint8Array(await res.arrayBuffer());
  const encoded = res.headers.get("Rim-Host-Response");
  const signature = res.headers.get("Rim-Host-Signature");
  if (!encoded || !signature) {
    throw new RelayFailure(host, `the relay answered ${res.status} without the host`, res.status);
  }
  try {
    const keySeq = await crypto.responseKeySeq(encoded, signature);
    const hostKey = await hostKeyAt(host, keySeq);
    await crypto.verifyHostResponse(encoded, signature, hostKey, {
      host,
      requestPayload: signed.payload,
      status: res.status,
      body: received,
    });
  } catch (err) {
    throw new RelayFailure(
      host,
      `the host's answer did not verify: ${err instanceof Error ? err.message : String(err)}`,
      res.status,
    );
  }
  return { status: res.status, body: received, contentType: res.headers.get("Content-Type") };
}

/**
 * Send a request to `host` through the relay and return its verified answer. A failure counts
 * as a relay failure for that host.
 */
export async function remoteFetch(
  host: string,
  path: string,
  request: RemoteRequest,
): Promise<RemoteResponse> {
  try {
    let response = await attempt(host, path, request, 0);
    const highest = replayHighestSeq(response);
    if (highest !== null) response = await attempt(host, path, request, highest + 1);
    if (response.status >= 500) recordRelayFailure(host);
    else recordRelaySuccess(host);
    return response;
  } catch (err) {
    if (err instanceof RelayFailure && err.status !== 401) recordRelayFailure(host);
    throw err;
  }
}

/** A verified answer as a `Response`, for code that reads one. */
export function asResponse(response: RemoteResponse): Response {
  return new Response(response.body as BodyInit, {
    status: response.status,
    headers: { "Content-Type": response.contentType ?? "application/json" },
  });
}

/** POST a GraphQL body to `host`'s `/api` through the relay. */
export async function sendGraphql(host: string, body: string): Promise<Response> {
  return asResponse(
    await remoteFetch(host, "/api", {
      method: "POST",
      body: utf8(body),
      contentType: "application/json",
    }),
  );
}

const hostClients = new Map<string, GraphQLClient>();

/**
 * A GraphQL client for `host`: for calls that name no space (`myMlsWelcomes`,
 * `ackMlsWelcomes`) but belong to a host.
 */
export function hostClient(host: string): GraphQLClient {
  let client = hostClients.get(host);
  if (!client) {
    client = new GraphQLClient(`${getApiOrigin()}/api/remote/${host}/api`, {
      fetch: async (_url, init) => sendGraphql(host, String(init?.body ?? "")),
    });
    hostClients.set(host, client);
  }
  return client;
}
