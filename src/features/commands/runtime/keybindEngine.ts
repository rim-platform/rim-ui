import type { KeybindContext, ResolvedKeybind } from "../types";

/** Attribute marking an element that records a keystroke: keys pressed there reach only it. */
export const KEYSTROKE_RECORDER_ATTRIBUTE = "data-keystroke-recorder";

/** Whether a key event's target is recording a keystroke, so no keybind acts on the key. */
export function isKeystrokeRecorder(target: EventTarget | null): boolean {
  return target instanceof Element && target.hasAttribute(KEYSTROKE_RECORDER_ATTRIBUTE);
}

const MODIFIER_KEYS = ["Control", "Meta", "Shift", "Alt"];

/**
 * Whether Shift is part of typing `key` itself: a single character that is not a letter, such
 * as `?` or `:`, already says which shifted key was pressed, and keyboard layouts disagree on
 * whether Shift is needed for it.
 */
function shiftIsImplied(key: string): boolean {
  return key.length === 1 && key.toLowerCase() === key.toUpperCase() && key !== " ";
}

/**
 * Convert a KeyboardEvent into a normalized keystroke string.
 * Format: "Ctrl+Shift+Alt+Key" (modifiers always in this order). Shift is left out for a
 * character that already implies it, so `?` is "?" on every layout.
 */
export function parseKeystroke(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">,
): string {
  let key = event.key;
  if (!key || MODIFIER_KEYS.includes(key)) return "";

  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push("Ctrl");
  if (event.shiftKey && !shiftIsImplied(key)) parts.push("Shift");
  if (event.altKey) parts.push("Alt");

  if (key === " ") key = "Space";
  if (key.length === 1) key = key.toUpperCase();

  parts.push(key);
  return parts.join("+");
}

const MODIFIER_ORDER = ["Ctrl", "Shift", "Alt"];

/**
 * A stored keystroke in the form `parseKeystroke` produces: modifiers in Ctrl, Shift, Alt
 * order, Meta as Ctrl, and no Shift before a character that implies it. So "Shift+?" matches
 * "?" and "Alt+Shift+ArrowDown" matches the key as pressed.
 */
export function normalizeKeystroke(keystroke: string): string {
  const cut = keystroke.endsWith("++") ? keystroke.length - 1 : keystroke.lastIndexOf("+") + 1;
  const key = keystroke.slice(cut);
  if (!key) return keystroke;
  const modifiers = new Set(
    keystroke
      .slice(0, cut)
      .split("+")
      .filter((part) => part !== "")
      .map((part) => (part === "Meta" ? "Ctrl" : part)),
  );
  if (shiftIsImplied(key)) modifiers.delete("Shift");
  const known = MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier));
  const other = [...modifiers].filter((modifier) => !MODIFIER_ORDER.includes(modifier));
  return [...known, ...other, key].join("+");
}

/**
 * Find a matching keybind for the given keystroke and context.
 * Returns the first enabled match, or null.
 */
export function matchKeybind(
  keystroke: string,
  context: KeybindContext,
  keybinds: ResolvedKeybind[],
): ResolvedKeybind | null {
  if (!keystroke) return null;

  return (
    keybinds.find(
      (kb) =>
        kb.isEnabled &&
        normalizeKeystroke(kb.keystroke) === keystroke &&
        (kb.context === context || kb.context === "GLOBAL"),
    ) ?? null
  );
}

/**
 * Map a shell focused surface to a KeybindContext.
 */
export function surfaceToContext(focusedSurface: string | null): KeybindContext {
  switch (focusedSurface) {
    case "composer":
      return "COMPOSER";
    case "mainSurface":
    case "messageList":
      return "MESSAGE_LIST";
    case "threadPane":
    case "threadView":
      return "THREAD_VIEW";
    case "conversationView":
      return "CONVERSATION_VIEW";
    case "sideRail":
    case "toolPanel":
    case "workspaceRail":
    case "panel":
      return "PANEL";
    case "commandPalette":
      return "COMMAND_PALETTE";
    default:
      return "GLOBAL";
  }
}
