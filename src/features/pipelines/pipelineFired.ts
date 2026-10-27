/** The words for each trigger event the server names when a pipeline fires. */
const TRIGGER_PHRASES: ReadonlyMap<string, string> = new Map([
  ["NewMessage", "after a new message"],
  ["MessageUpdated", "after an edited message"],
  ["MessageDeleted", "after a deleted message"],
  ["ReactionsUpdated", "after a reaction change"],
  ["MemberJoined", "after a member joined"],
  ["WorkspaceStateChanged", "after a workspace state change"],
]);

/**
 * What set a pipeline off, in plain words for the "Pipeline fired" toast.
 *
 * @param triggerEvent - The trigger event's name as the server sends it, such as `NewMessage`.
 * @returns A phrase such as "after a new message", or `null` for a trigger it does not know.
 */
export function pipelineTriggerPhrase(triggerEvent: string): string | null {
  return TRIGGER_PHRASES.get(triggerEvent) ?? null;
}
