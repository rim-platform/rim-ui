import type { KeybindContext, ResolvedKeybind } from "../types";

/**
 * Convert a KeyboardEvent into a normalized keystroke string.
 * Format: "Ctrl+Shift+Alt+Key" (modifiers always in this order)
 */
export function parseKeystroke(event: KeyboardEvent): string {
  const parts: string[] = [];

  if (event.ctrlKey || event.metaKey) parts.push("Ctrl");
  if (event.shiftKey) parts.push("Shift");
  if (event.altKey) parts.push("Alt");

  // Normalize the key
  let key = event.key;

  // Skip if key is just a modifier
  if (["Control", "Meta", "Shift", "Alt"].includes(key)) return "";

  // Normalize common keys
  if (key === " ") key = "Space";
  if (key.length === 1) key = key.toUpperCase();

  parts.push(key);

  return parts.join("+");
}

/**
 * Find a matching keybind for the given keystroke and context.
 * Returns the first enabled match, or null.
 */
export function matchKeybind(
  keystroke: string,
  context: KeybindContext,
  keybinds: ResolvedKeybind[]
): ResolvedKeybind | null {
  if (!keystroke) return null;

  const contextUpper = context.toUpperCase();

  return (
    keybinds.find(
      (kb) =>
        kb.isEnabled &&
        kb.keystroke === keystroke &&
        (kb.context.toUpperCase() === contextUpper || kb.context.toUpperCase() === "GLOBAL")
    ) ?? null
  );
}

/**
 * Map a shell focused surface to a KeybindContext.
 */
export function surfaceToContext(
  focusedSurface: string | null
): KeybindContext {
  switch (focusedSurface) {
    case "composer":
      return "Composer";
    case "messageList":
      return "MessageList";
    case "threadView":
      return "ThreadView";
    case "conversationView":
      return "ConversationView";
    case "panel":
      return "Panel";
    case "commandPalette":
      return "CommandPalette";
    default:
      return "Global";
  }
}
