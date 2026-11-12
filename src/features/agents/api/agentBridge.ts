/**
 * The agent bridge's commands (`src-tauri/src/agent_bridge`): whether agents on this computer may
 * connect, and answering what they ask. Every call throws its `SafeInvokeError` on failure, and
 * `ipc_unavailable` in the web app.
 */

import { safeInvoke } from "../../../core/tauri/safeInvoke";

/** The event that hands the page a request from an agent. */
export const AGENT_BRIDGE_REQUEST_EVENT = "agent-bridge://request";

/** The payload of {@link AGENT_BRIDGE_REQUEST_EVENT}. */
export interface BridgeRequest {
  id: number;
  path: string;
  /** The `Authorization` header as sent, or `null`. */
  authorization: string | null;
  body: string;
}

/** Whether the bridge should run, whether it does, and why it could not start. */
export interface AgentBridgeStatus {
  enabled: boolean;
  listening: boolean;
  error: string | null;
  port: number;
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const result = await safeInvoke<T>(command, args);
  if (!result.ok) throw result.error;
  return result.value;
}

/** @returns The bridge's current status. */
export function agentBridgeStatus(): Promise<AgentBridgeStatus> {
  return call("agent_bridge_status");
}

/**
 * Saves whether agents may connect, and starts or stops the bridge.
 *
 * @param enabled - The new setting.
 * @returns The bridge's status afterwards.
 */
export function agentBridgeSetEnabled(enabled: boolean): Promise<AgentBridgeStatus> {
  return call("agent_bridge_set_enabled", { enabled });
}

/**
 * Tells the bridge the page took a request, so it waits for the answer.
 *
 * @param id - The request's id.
 */
export function agentBridgeAck(id: number): Promise<null> {
  return call("agent_bridge_ack", { id });
}

/**
 * Answers a request.
 *
 * @param id - The request's id.
 * @param status - The HTTP status.
 * @param body - The JSON body.
 */
export function agentBridgeAnswer(id: number, status: number, body: string): Promise<null> {
  return call("agent_bridge_answer", { id, status, body });
}
