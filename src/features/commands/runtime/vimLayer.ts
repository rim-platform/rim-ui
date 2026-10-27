import { navigatePanel, panelIdForSurface } from "../../../shell/navigation/spatialNavigation";
import { useShellStore } from "../../../shell/state/useShellStore";
import {
  isTextEntry,
  stepFocus,
  tabbableWithin,
  type FocusStep,
} from "../../../shared/ui/focusNavigation";
import { useCommandStore } from "../state/useCommandStore";
import { vimModeEnabled } from "../state/useKeybindProfileStore";
import { useVimStore } from "../state/useVimStore";
import { runDesktopLocalCommand } from "./commandDispatcher";
import { isKeystrokeRecorder } from "./keybindEngine";

/** The key a list already answers for each motion; the Vim keys send these to it. */
const MOTION_KEYS: Readonly<Record<FocusStep, string>> = {
  next: "ArrowDown",
  previous: "ArrowUp",
  first: "Home",
  last: "End",
};

/** Overlays that take the keyboard for themselves: only motions reach them. */
const OVERLAY_SELECTOR = '[role="dialog"], [aria-modal="true"], [role="menu"]';

const INTERACTIVE_SELECTOR = [
  "a[href]",
  "button",
  "summary",
  '[role="button"]',
  '[role="link"]',
  '[role="option"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="listbox"]',
  '[role="treeitem"]',
].join(", ");

/** Longest count prefix a motion repeats by. */
const MAX_COUNT = 99;

/** How long a half-typed `g` waits for the second key. */
const PENDING_TIMEOUT_MS = 1000;

/** Keys this layer sends itself, which it must not handle again. */
const sentByLayer = new WeakSet<Event>();

function sendKey(target: EventTarget, key: string): boolean {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  sentByLayer.add(event);
  return target.dispatchEvent(event);
}

function focusedElement(): HTMLElement | null {
  const active = document.activeElement;
  return active instanceof HTMLElement && active !== document.body ? active : null;
}

function insideMessageList(element: Element | null): boolean {
  return Boolean(element?.closest("[data-message-list]"));
}

/** The region keys act in: the open overlay, the focused pane, or the pane the shell says. */
function currentScope(active: HTMLElement | null): HTMLElement | null {
  const own = active?.closest<HTMLElement>(`${OVERLAY_SELECTOR}, [data-panel]`);
  if (own) return own;
  const panel = panelIdForSurface(useShellStore.getState().focusedSurface) ?? "mainSurface";
  return (
    document.querySelector<HTMLElement>(`[data-panel="${panel}"]`) ??
    document.querySelector<HTMLElement>('[data-panel="mainSurface"]')
  );
}

/**
 * Move through the focused list, or through the focusable items of the current pane when no
 * list answers. Entering a pane lands on its list first, so `j` in the timeline selects a
 * message.
 */
function motion(step: FocusStep): boolean {
  const active = focusedElement();
  if (active && !sendKey(active, MOTION_KEYS[step])) return true;

  const scope = currentScope(active);
  if (!scope) return true;
  if (!active || active === scope) {
    const list = scope.querySelector<HTMLElement>('[role="listbox"]');
    if (list) {
      list.focus();
      if (step === "first" || step === "last") sendKey(list, MOTION_KEYS[step]);
      return true;
    }
  }
  const items = tabbableWithin(scope).filter((item) => !isTextEntry(item));
  stepFocus(items, active, step);
  return true;
}

/** Focus the composer, or the first text field of the current pane when there is none. */
function enterInsertMode(): boolean {
  const composer = document.querySelector<HTMLElement>("[data-composer-input]");
  if (composer) {
    composer.focus();
    return true;
  }
  const scope = currentScope(focusedElement());
  const field = scope ? tabbableWithin(scope).find((item) => isTextEntry(item)) : undefined;
  field?.focus();
  return true;
}

interface NormalCommand {
  /** The keys that run it, as typed: "j", "gg", "G". */
  keys: string;
  description: string;
  /** Whether a count prefix repeats it. */
  repeats: boolean;
  /** Whether it also works inside an open dialog or menu. */
  inOverlay: boolean;
  /** Runs the command; `false` leaves the key to whatever else handles it. */
  run: (target: Element | null) => boolean;
}

const NORMAL_COMMANDS: readonly NormalCommand[] = [
  {
    keys: "h",
    description: "Focus the pane to the left",
    repeats: true,
    inOverlay: false,
    run: () => {
      navigatePanel("left");
      return true;
    },
  },
  {
    keys: "l",
    description: "Focus the pane to the right",
    repeats: true,
    inOverlay: false,
    run: () => {
      navigatePanel("right");
      return true;
    },
  },
  {
    keys: "j",
    description: "Next item in the list or pane",
    repeats: true,
    inOverlay: true,
    run: () => motion("next"),
  },
  {
    keys: "k",
    description: "Previous item in the list or pane",
    repeats: true,
    inOverlay: true,
    run: () => motion("previous"),
  },
  {
    keys: "gg",
    description: "First item",
    repeats: false,
    inOverlay: true,
    run: () => motion("first"),
  },
  {
    keys: "G",
    description: "Last item",
    repeats: false,
    inOverlay: true,
    run: () => motion("last"),
  },
  {
    keys: "n",
    description: "Next unread conversation (in the timeline, its own keys apply)",
    repeats: true,
    inOverlay: false,
    run: (target) =>
      !insideMessageList(target) && runDesktopLocalCommand("workspace.next_unread_channel"),
  },
  {
    keys: "p",
    description: "Previous unread conversation (in the timeline, p pins)",
    repeats: true,
    inOverlay: false,
    run: (target) =>
      !insideMessageList(target) && runDesktopLocalCommand("workspace.previous_unread_channel"),
  },
  {
    keys: "/",
    description: "Search this conversation",
    repeats: false,
    inOverlay: false,
    run: (target) =>
      !insideMessageList(target) && runDesktopLocalCommand("workspace.search_in_channel"),
  },
  {
    keys: ":",
    description: "Open the command palette",
    repeats: false,
    inOverlay: false,
    run: () => {
      useCommandStore.getState().openCommandPalette();
      return true;
    },
  },
  {
    keys: "i",
    description: "Insert mode: focus the composer",
    repeats: false,
    inOverlay: false,
    run: (target) => !insideMessageList(target) && enterInsertMode(),
  },
  {
    keys: "Enter",
    description: "Insert mode, unless a button or list item is focused",
    repeats: false,
    inOverlay: false,
    run: (target) =>
      !(target instanceof Element && target.closest(INTERACTIVE_SELECTOR)) && enterInsertMode(),
  },
];

/** The keys of the Vim layer with what they do, for the shortcuts panel. */
export const VIM_KEYS: readonly { keys: string; description: string }[] = [
  ...NORMAL_COMMANDS.map(({ keys, description }) => ({ keys, description })),
  { keys: "3j", description: "A count repeats a motion" },
  { keys: "Esc", description: "Back to normal mode" },
  { keys: "Ctrl+[", description: "Same as Esc" },
];

let count = "";
let pending = "";
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

function showPending(): void {
  useVimStore.getState().setPending(count + pending);
}

function clearPending(): void {
  count = "";
  pending = "";
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = null;
  showPending();
}

function consume(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}

function repeatLater(command: NormalCommand, times: number): void {
  if (times <= 0) return;
  // One step per task, so each step sees the list as the last one left it.
  setTimeout(() => {
    command.run(focusedElement());
    repeatLater(command, times - 1);
  }, 0);
}

/**
 * The Vim layer's keydown handler, for the capture phase. Returns whether it took the key.
 * Keys typed into a text field, a select or a plugin's frame are never taken, except Ctrl+[,
 * which means Escape.
 */
export function handleVimKeyDown(event: KeyboardEvent): boolean {
  if (isKeystrokeRecorder(event.target)) return false;
  if (!vimModeEnabled() || sentByLayer.has(event) || event.isComposing) return false;
  const active = document.activeElement;
  const target = event.target instanceof Element ? event.target : null;
  // A plugin frame's keys are the plugin's.
  if (active instanceof HTMLIFrameElement || target instanceof HTMLIFrameElement) return false;

  if (event.key === "[" && event.ctrlKey && !event.altKey && !event.shiftKey) {
    consume(event);
    clearPending();
    sendKey(target ?? active ?? document.body, "Escape");
    return true;
  }
  if (isTextEntry(active) || isTextEntry(target)) return false;
  if (event.ctrlKey || event.metaKey || event.altKey) {
    clearPending();
    return false;
  }
  if (useCommandStore.getState().isCommandPaletteOpen) return false;

  const key = event.key;
  if (/^[1-9]$/.test(key) || (key === "0" && count)) {
    count = (count + key).slice(0, 2);
    consume(event);
    showPending();
    return true;
  }
  let keys = key;
  if (pending === "g") {
    keys = `g${key}`;
    pending = "";
  } else if (key === "g") {
    pending = "g";
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(clearPending, PENDING_TIMEOUT_MS);
    consume(event);
    showPending();
    return true;
  }

  const command = NORMAL_COMMANDS.find((candidate) => candidate.keys === keys);
  const times = Math.min(Math.max(Number.parseInt(count || "1", 10), 1), MAX_COUNT);
  clearPending();
  if (!command) return false;
  if (!command.inOverlay && active?.closest(OVERLAY_SELECTOR)) return false;
  if (!command.run(target ?? focusedElement())) return false;
  consume(event);
  if (command.repeats) repeatLater(command, times - 1);
  return true;
}

/**
 * Escape in a text field returns to normal mode: when nothing else used the key, the field
 * gives up focus to its pane. For the bubble phase, after the field's own handlers.
 */
export function handleVimEscape(event: KeyboardEvent): void {
  if (isKeystrokeRecorder(event.target)) return;
  if (!vimModeEnabled() || event.key !== "Escape" || event.defaultPrevented) return;
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !isTextEntry(active)) return;
  if (active.closest(OVERLAY_SELECTOR)) return;
  const pane = active.closest<HTMLElement>("[data-panel]");
  active.blur();
  pane?.focus();
}

/** Keep the mode in step with focus: insert while a text field or a plugin frame has it. */
export function syncVimMode(): void {
  const active = document.activeElement;
  const mode = isTextEntry(active) || active instanceof HTMLIFrameElement ? "insert" : "normal";
  if (useVimStore.getState().mode !== mode) useVimStore.getState().setMode(mode);
}

/** Install the Vim layer's listeners on this window; returns the function removing them. */
export function installVimLayer(): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    handleVimKeyDown(event);
  };
  // Focus has moved by the time a microtask runs after focusout.
  const onFocusChange = () => queueMicrotask(syncVimMode);
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keydown", handleVimEscape);
  document.addEventListener("focusin", onFocusChange);
  document.addEventListener("focusout", onFocusChange);
  syncVimMode();
  return () => {
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keydown", handleVimEscape);
    document.removeEventListener("focusin", onFocusChange);
    document.removeEventListener("focusout", onFocusChange);
    clearPending();
  };
}
