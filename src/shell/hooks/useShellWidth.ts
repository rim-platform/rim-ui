import { useLayoutEffect, type RefObject } from "react";

import { useShellStore } from "../state/useShellStore";

/** How much room the shell has: all panels beside the conversation, overlays, or a drawer. */
export type ShellWidth = "wide" | "medium" | "narrow";

/** The shell width, in pixels, from which every panel sits beside the conversation. */
export const WIDE_MIN_PX = 1100;

/** The shell width, in pixels, from which the side panel stays and other panels overlay. */
export const MEDIUM_MIN_PX = 760;

/**
 * Sorts a shell width into its class. A width that is not positive means the shell has not been
 * laid out, and counts as wide.
 *
 * @param px - The shell's width in CSS pixels.
 */
export function classifyShellWidth(px: number): ShellWidth {
  if (!(px > 0) || px >= WIDE_MIN_PX) return "wide";
  return px >= MEDIUM_MIN_PX ? "medium" : "narrow";
}

/** The shell's current width class: `wide` until the shell has been measured. */
export function useShellWidth(): ShellWidth {
  return useShellStore((s) => s.shellWidth);
}

/**
 * Keeps the shell store's width class in step with the width of the element `ref` points at,
 * measured on mount and on every resize. The class returns to `wide` when the element goes away.
 *
 * @param ref - The element that spans the whole shell.
 */
export function useObserveShellWidth(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const { setShellWidth } = useShellStore.getState();
    setShellWidth(classifyShellWidth(element.getBoundingClientRect().width));
    if (typeof ResizeObserver === "undefined") {
      return () => setShellWidth("wide");
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) setShellWidth(classifyShellWidth(entry.contentRect.width));
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      setShellWidth("wide");
    };
  }, [ref]);
}
