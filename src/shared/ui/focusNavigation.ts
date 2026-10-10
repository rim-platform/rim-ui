import type { KeyboardEvent as ReactKeyboardEvent } from "react";

const TABBABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/** Whether keys pressed in `element` type into it: a text field, a select or editable content. */
export function isTextEntry(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    return true;
  }
  if (element instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(element.type);
  return false;
}

function isHidden(element: HTMLElement, root: Element): boolean {
  for (let node: HTMLElement | null = element; node && node !== root; node = node.parentElement) {
    if (node.hidden || node.inert || node.getAttribute("aria-hidden") === "true") return true;
  }
  return false;
}

/** The elements Tab reaches inside `container`, in document order. */
export function tabbableWithin(container: Element): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)).filter(
    (element) => !isHidden(element, container),
  );
}

export type FocusStep = "next" | "previous" | "first" | "last";

/**
 * Move focus among `items` from the one holding `from`: one step, or to either end. Returns the
 * element focused, or `null` when there was nowhere to go.
 */
export function stepFocus(
  items: readonly HTMLElement[],
  from: Element | null,
  step: FocusStep,
): HTMLElement | null {
  if (items.length === 0) return null;
  const current = from ? items.findIndex((item) => item === from || item.contains(from)) : -1;
  let index: number;
  switch (step) {
    case "first":
      index = 0;
      break;
    case "last":
      index = items.length - 1;
      break;
    case "next":
      index = current < 0 ? 0 : Math.min(current + 1, items.length - 1);
      break;
    case "previous":
      index = current < 0 ? items.length - 1 : Math.max(current - 1, 0);
      break;
  }
  const target = items[index];
  if (!target || target === from) return null;
  target.focus();
  return target;
}

const OVERLAY_SELECTOR = '[role="dialog"], [aria-modal="true"], [role="menu"]';

const ROVING_STEPS: Readonly<Record<string, FocusStep>> = {
  ArrowDown: "next",
  ArrowUp: "previous",
  Home: "first",
  End: "last",
};

/**
 * Up and Down arrows, Home and End move focus among the buttons of a vertical strip such as a
 * rail. Meant for the strip's `onKeyDown`; keys pressed in a text field are left alone.
 */
export function handleVerticalStripKeys(event: ReactKeyboardEvent<HTMLElement>): void {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return;
  }
  const step = ROVING_STEPS[event.key];
  const target = event.target as Element;
  if (!step || isTextEntry(target)) return;
  // Keys from a menu or dialog the strip opened (portals included) belong to it.
  if (!event.currentTarget.contains(target) || target.closest(OVERLAY_SELECTOR)) return;
  const items = tabbableWithin(event.currentTarget).filter(
    (item) => !isTextEntry(item) && !item.closest(OVERLAY_SELECTOR),
  );
  if (stepFocus(items, document.activeElement, step) || items.length > 0) {
    event.preventDefault();
  }
}
