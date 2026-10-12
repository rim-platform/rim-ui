/**
 * Refusals the server's edge answers before a route runs (a blocked address, the per-address
 * request limit, the WebSocket connection limit), read off HTTP answers and kept as app state.
 */

import { create } from "zustand";

import { AddressBlockedError, RATE_LIMITED } from "./errors";

/** What the edge said about this client, for the banners that explain it. */
interface EdgeState {
  /** The last answer from the server was 403 `blocked`. */
  blocked: boolean;
  /** The last WebSocket upgrade was refused with 429 `too_many_connections`. */
  tooManyConnections: boolean;
  setBlocked: (blocked: boolean) => void;
  setTooManyConnections: (tooMany: boolean) => void;
}

export const useEdgeStore = create<EdgeState>((set) => ({
  blocked: false,
  tooManyConnections: false,
  setBlocked: (blocked) => set((s) => (s.blocked === blocked ? s : { blocked })),
  setTooManyConnections: (tooManyConnections) =>
    set((s) => (s.tooManyConnections === tooManyConnections ? s : { tooManyConnections })),
}));

/** One refusal from the edge, or `null` for an answer that is not one. */
export type EdgeRefusal =
  | { kind: "blocked" }
  | { kind: "rateLimited"; retryAfterSeconds: number | undefined }
  | { kind: "tooManyConnections" }
  | null;

/** The JSON body of an edge refusal. */
interface RefusalBody {
  error?: unknown;
  retryAfterSeconds?: unknown;
}

/** A non-negative finite number, else `undefined`. */
function seconds(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * The edge refusal `response` carries: 403 `blocked`, 429 `rate_limited` (with the body's
 * `retryAfterSeconds`, else the `Retry-After` header) or 429 `too_many_connections`. Reads a
 * clone, so the body stays readable. Records whether the address is blocked.
 */
export async function readEdgeRefusal(response: Response): Promise<EdgeRefusal> {
  let refusal: EdgeRefusal = null;
  if (response.status === 403 || response.status === 429) {
    let body: RefusalBody | null;
    try {
      body = (await response.clone().json()) as RefusalBody | null;
    } catch {
      body = null;
    }
    const error = body?.error;
    if (response.status === 403 && error === "blocked") {
      refusal = { kind: "blocked" };
    } else if (response.status === 429 && error === "too_many_connections") {
      refusal = { kind: "tooManyConnections" };
    } else if (response.status === 429 && error === "rate_limited") {
      refusal = {
        kind: "rateLimited",
        retryAfterSeconds:
          seconds(body?.retryAfterSeconds) ?? seconds(response.headers.get("Retry-After")),
      };
    }
  }
  useEdgeStore.getState().setBlocked(refusal?.kind === "blocked");
  return refusal;
}

/**
 * `response` as the GraphQL client should see it: a 403 `blocked` throws `AddressBlockedError`,
 * and a 429 `rate_limited` becomes a GraphQL `RATE_LIMITED` error with its `retryAfterSeconds`,
 * as a mutation over its limit is answered. Any other answer passes unchanged.
 */
export async function asGraphqlResponse(response: Response): Promise<Response> {
  const refusal = await readEdgeRefusal(response);
  if (refusal?.kind === "blocked") throw new AddressBlockedError();
  if (refusal?.kind !== "rateLimited") return response;
  const extensions: Record<string, unknown> = { code: RATE_LIMITED };
  if (refusal.retryAfterSeconds !== undefined) {
    extensions.retryAfterSeconds = refusal.retryAfterSeconds;
  }
  const headers = new Headers(response.headers);
  headers.set("Content-Type", "application/json");
  return new Response(
    JSON.stringify({ errors: [{ message: "Too many requests from this address", extensions }] }),
    { status: response.status, statusText: response.statusText, headers },
  );
}
