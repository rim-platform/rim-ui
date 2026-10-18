import { useCallback } from "react";

import { CONTEXT_ARGUMENTS } from "../../../../sdk/plugin-sdk/src/manifestRules";
import { useShellStore } from "../../../shell/state/useShellStore";
import { openThreadId } from "../../threads/api/openThreadId";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";

/** What a plugin command runs against: the workspace, conversation, thread and selected message. */
export interface PluginInvocationContext {
  workspaceId?: string;
  conversationId?: string;
  /** The thread's own id, as `rim.chat.post_message` takes it, not its root message's. */
  threadId?: string;
  selectedMessageId?: string;
}

/** A surface's command context; only its string fields are read. */
type ContextSource = Readonly<Record<string, unknown>>;

/** The context field each added argument is read from. */
const ARGUMENT_SOURCES: Readonly<Record<string, keyof PluginInvocationContext>> = {
  workspace_id: "workspaceId",
  conversation_id: "conversationId",
  thread_id: "threadId",
  message_id: "selectedMessageId",
};

/** Added when known; a command in a conversation runs without a thread too. */
const OPTIONAL_ARGUMENTS = new Set(["thread_id"]);

const MISSING_CONTEXT: Readonly<Record<string, string>> = {
  workspace: "Open a workspace first",
  conversation: "Open a conversation first",
  message: "Select a message first",
};

function pick(source: ContextSource | undefined, key: string): string | undefined {
  const value = source?.[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

function compact(context: PluginInvocationContext): PluginInvocationContext {
  return Object.fromEntries(
    Object.entries(context).filter(([, value]) => value !== undefined),
  ) as PluginInvocationContext;
}

/** The context the user is in: the workspace, the open conversation and the thread open beside it. */
export function currentPluginContext(): PluginInvocationContext {
  const workspaceId = useWorkspaceStore.getState().workspaceId ?? undefined;
  const conversationId = useShellStore.getState().selectedConversationId ?? undefined;
  return compact({
    workspaceId,
    conversationId,
    threadId: conversationId ? openThreadId(workspaceId, conversationId) : undefined,
  });
}

/**
 * The context a plugin command runs in. A surface that names a conversation or a message, as a
 * context menu does, gives the whole target, thread included. Any other surface runs the command
 * in the current context.
 */
export function invocationContext(source?: ContextSource): PluginInvocationContext {
  const current = currentPluginContext();
  const named = {
    workspaceId: pick(source, "workspaceId") ?? current.workspaceId,
    conversationId: pick(source, "conversationId"),
    threadId: pick(source, "threadId"),
    selectedMessageId: pick(source, "selectedMessageId"),
  };
  if (named.conversationId || named.selectedMessageId) return compact(named);
  return compact({ ...current, workspaceId: named.workspaceId });
}

export type ContextArguments =
  { ok: true; args: Record<string, string> } | { ok: false; message: string };

/**
 * The arguments the host adds for a command that requires `requiredContext`, read from
 * `context`, or why the command cannot run there. Kinds other than the known ones add nothing.
 */
export function contextArguments(
  requiredContext: readonly string[],
  context: PluginInvocationContext,
): ContextArguments {
  const args: Record<string, string> = {};
  for (const [kind, names] of Object.entries(CONTEXT_ARGUMENTS)) {
    if (!requiredContext.includes(kind)) continue;
    for (const name of names) {
      const value = context[ARGUMENT_SOURCES[name]];
      if (value !== undefined) args[name] = value;
      else if (!OPTIONAL_ARGUMENTS.has(name)) {
        return { ok: false, message: MISSING_CONTEXT[kind] ?? `This command needs a ${kind}` };
      }
    }
  }
  return { ok: true, args };
}

/** Whether `requiredContext` names a kind the host adds arguments for. */
function needsContext(requiredContext: readonly string[]): boolean {
  return requiredContext.some((kind) =>
    Object.prototype.hasOwnProperty.call(CONTEXT_ARGUMENTS, kind),
  );
}

export type PreparedArguments =
  { ok: true; args: Record<string, unknown> } | { ok: false; message: string };

/**
 * A plugin command's arguments with its context arguments added, from the context the surface
 * names or else the current one, or why it cannot run. An added argument replaces one of the same
 * name. A command that requires no context gets `args` as they are.
 */
export function withContextArguments(
  requiredContext: readonly string[],
  args: Record<string, unknown> | undefined,
  source?: ContextSource,
): PreparedArguments {
  if (!needsContext(requiredContext)) return { ok: true, args: args ?? {} };
  const added = contextArguments(requiredContext, invocationContext(source));
  if (!added.ok) return added;
  return { ok: true, args: { ...args, ...added.args } };
}

/**
 * Whether a command requiring `requiredContext` can run where the user is now; the caller
 * re-renders when the workspace or conversation changes. A selected message only comes from a
 * context menu, so a command requiring one cannot run from here.
 */
export function useRunnableHere(): (requiredContext: readonly string[]) => boolean {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId) ?? undefined;
  const conversationId = useShellStore((s) => s.selectedConversationId) ?? undefined;
  return useCallback(
    (requiredContext) => contextArguments(requiredContext, { workspaceId, conversationId }).ok,
    [workspaceId, conversationId],
  );
}
