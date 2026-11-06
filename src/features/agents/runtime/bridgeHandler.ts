/** Answers what agents ask the desktop app through the bridge. */

import { logger } from "../../../core/logger";
import type { BridgeRequest } from "../api/agentBridge";
import type { ConnectedAgent } from "../state/useConnectedAgentsStore";
import { sha256Base64Url } from "./agentCrypto";
import { answerMcpMessage, type McpDeps } from "./mcpServer";
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
  mcp: McpDeps;
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

function encoded(answer: PairAnswer): BridgeAnswer {
  return { status: answer.status, body: JSON.stringify(answer.body) };
}

async function answerMcp(request: BridgeRequest, deps: BridgeDeps): Promise<BridgeAnswer> {
  const token = TOKEN_HEADER.exec(request.authorization ?? "")?.[1];
  if (token === undefined) return encoded(failure(401, "not_paired"));
  const hash = await sha256Base64Url(token);
  const agent = deps.agents().find((candidate) => candidate.tokenHash === hash);
  return agent
    ? answerMcpMessage(request.body, agent, deps.mcp)
    : encoded(failure(401, "not_paired"));
}

async function route(request: BridgeRequest, deps: BridgeDeps): Promise<BridgeAnswer> {
  if (!deps.unlocked()) return encoded(failure(423, "locked"));
  if (request.path === "/mcp") return answerMcp(request, deps);
  if (request.path !== "/pair" && request.path !== "/pair/poll") {
    return encoded(failure(404, "not_found"));
  }
  const body = parseObject(request.body);
  if (body === null) return encoded(failure(400, "bad_body"));
  return encoded(
    await (request.path === "/pair" ? deps.pairing.request(body.name) : deps.pairing.poll(body)),
  );
}

/**
 * Answers one request. A failure answers 500 and says nothing about the request.
 *
 * @param request - What the bridge handed over.
 * @param deps - The vault's state, the pairing, the connected agents and the tools.
 * @returns The status and JSON body to answer with.
 */
export async function handleBridgeRequest(
  request: BridgeRequest,
  deps: BridgeDeps,
): Promise<BridgeAnswer> {
  try {
    return await route(request, deps);
  } catch (error) {
    logger.error(
      "[RIM:agents] answering a request failed:",
      error instanceof Error ? error.name : "unknown",
    );
    return { status: 500, body: JSON.stringify({ error: "internal" }) };
  }
}
