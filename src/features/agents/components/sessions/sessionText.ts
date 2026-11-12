/** The sentences, labels and small helpers of the agent session screens. */

import { useShellStore } from "../../../../shell/state/useShellStore";
import type { ToolKind } from "../../acp/acpClient";
import type { JsonValue } from "../../acp/acpConnection";
import type { AgentSessionStatus } from "../../acp/agentSession";

/** What the sessions say about where they run. */
export function sandboxSentence(folder: string): string {
  return `RIM doesn't sandbox this agent. It runs as you in ${folder}, with its own tools and permission settings.`;
}

/** The label of each session status. */
export const STATUS_LABELS: Record<AgentSessionStatus, string> = {
  starting: "Starting",
  ready: "Ready",
  working: "Working",
  waiting: "Waiting for you",
  ended: "Ended",
  failed: "Failed",
};

/** The last part of a folder's path. */
export function folderName(path: string): string {
  const parts = path.split(/[\\/]+/u).filter((part) => part !== "");
  return parts[parts.length - 1] ?? path;
}

/** The title shown for a session without one yet. */
export const UNTITLED_SESSION = "New session";

/** What the list says with no agent programs added. */
export const ADD_PROGRAM_FIRST = "Add an agent program in Settings → Agents first";

/** Opens one session's page. */
export function openAgentSession(key: string): void {
  useShellStore.getState().setMainSurface({ kind: "agent-session", key });
}

/** Opens Settings > Agents. */
export function openAgentsSettings(): void {
  useShellStore.getState().setMainSurface({ kind: "settings", tab: "agents" });
}

/** What the banner says when agents may not connect to RIM. */
export function bridgeOffSentence(agentName: string): string {
  return `RIM's tools are off. Turn on Let agents on this computer connect in Settings → Agents to let ${agentName} read and post in RIM.`;
}

/** What the banner says when the agent can't reach RIM's tools. */
export function agentCannotSentence(agentName: string): string {
  return `${agentName} can't use RIM's tools.`;
}

/**
 * What the session chooser of "Ask agent…" says of a session without RIM's tools.
 *
 * @param state - Why RIM's tools are not in the session.
 */
export function cannotReadRimSentence(
  agentName: string,
  state: "bridge_off" | "agent_cannot",
): string {
  const reason =
    state === "bridge_off"
      ? "RIM's tools are off in Settings → Agents."
      : "it can't use RIM's tools.";
  return `${agentName} can't read RIM in this session: ${reason}`;
}

/** What the session says when the program for it was removed. */
export const PROFILE_GONE =
  "The agent program for this session was removed from Settings → Agents.";

/** The most diff lines shown before "Show all". */
export const DIFF_LINE_LIMIT = 400;

/** The most characters of a tool call's input shown. */
export const RAW_INPUT_LIMIT = 2000;

/** What each kind of tool call is called. */
export const KIND_LABELS: Record<ToolKind, string> = {
  read: "Read",
  edit: "Edit",
  delete: "Delete",
  move: "Move",
  search: "Search",
  execute: "Run",
  think: "Think",
  fetch: "Fetch",
  switch_mode: "Switch mode",
  other: "Other",
};

/** A tool call's input as compact JSON, cut at {@link RAW_INPUT_LIMIT} characters. */
export function rawInputPreview(value: JsonValue | undefined): string | null {
  if (value === undefined) return null;
  let text: string;
  try {
    text = JSON.stringify(value) ?? "";
  } catch {
    return null;
  }
  return text.length > RAW_INPUT_LIMIT ? `${text.slice(0, RAW_INPUT_LIMIT)}…` : text;
}

/** What the dialog says of a folder that is not a full path. */
export const FOLDER_NEEDED = "Write the folder's full path.";
