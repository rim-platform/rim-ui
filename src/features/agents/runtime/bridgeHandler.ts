/** Answers what agents ask the desktop app through the bridge. */

import { logger } from "../../../core/logger";
import type { BridgeRequest } from "../api/agentBridge";
import type { ConnectedAgent } from "../state/useConnectedAgentsStore";
import { sha256Base64Url } from "./agentCrypto";
import type { PairAnswer, Pairing } from "./pairing";

/** What goes back to the bridge: an HTTP status and a JSON body. */
export interface BridgeAnswer {
  status: number;
  body: string;
}

/** What answering needs from the outside. */
export interface BridgeDeps {
  unlocked: () => boolean;
  pairing: Pairing;
  agents: () => ConnectedAgent[];
}

const TOKEN_HEADER = /^Bearer (rimagent_[A-Za-z0-9_-]{43})$/;

function failure(status: number, error: string): PairAnswer {
  return { status, body: { error } };
}

/** @returns The JSON object in `body`, or `null` when it is not one. */
function parseObject(body: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

async function answerMcp(authorization: string | null, deps: BridgeDeps): Promise<PairAnswer> {
  const token = TOKEN_HEADER.exec(authorization ?? "")?.[1];
  if (token === undefined) return failure(401, "not_paired");
  const hash = await sha256Base64Url(token);
  return deps.agents().some((agent) => agent.tokenHash === hash)
    ? failure(501, "not_implemented")
    : failure(401, "not_paired");
}

function route(request: BridgeRequest, deps: BridgeDeps): Promise<PairAnswer> | PairAnswer {
  if (!deps.unlocked()) return failure(423, "locked");
  if (request.path === "/mcp") return answerMcp(request.authorization, deps);
  if (request.path !== "/pair" && request.path !== "/pair/poll") {
    return failure(404, "not_found");
  }
  const body = parseObject(request.body);
  if (body === null) return failure(400, "bad_body");
  return request.path === "/pair" ? deps.pairing.request(body.name) : deps.pairing.poll(body);
}

/**
 * Answers one request. A failure answers 500 and says nothing about the request.
 *
 * @param request - What the bridge handed over.
 * @param deps - The vault's state, the pairing and the connected agents.
 * @returns The status and JSON body to answer with.
 */
export async function handleBridgeRequest(
  request: BridgeRequest,
  deps: BridgeDeps,
): Promise<BridgeAnswer> {
  try {
    const answer = await route(request, deps);
    return { status: answer.status, body: JSON.stringify(answer.body) };
  } catch (error) {
    logger.error(
      "[RIM:agents] answering a request failed:",
      error instanceof Error ? error.name : "unknown",
    );
    return { status: 500, body: JSON.stringify({ error: "internal" }) };
  }
}
