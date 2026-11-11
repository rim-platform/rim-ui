import type { MainSurface } from "./useShellStore";

/**
 * The conversation shown to the person: the selected one while the conversation is the page,
 * otherwise `null`.
 *
 * @param state - The shell's page and selected conversation.
 * @returns The id of the conversation shown, or `null` while none is.
 */
export function shownConversationId(state: {
  mainSurface: MainSurface;
  selectedConversationId: string | null;
}): string | null {
  return state.mainSurface.kind === "conversation" ? state.selectedConversationId : null;
}
