import { useEffect, type RefObject } from "react";

/**
 * Moves focus into the overlay `ref` points at when it mounts, unless something inside already
 * took it, and returns focus to the element that had it when the overlay unmounts.
 *
 * @param ref - The overlay's root element, which must be focusable.
 */
export function useOverlayFocus(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const overlay = ref.current;
    const opener = document.activeElement;
    if (overlay && !overlay.contains(document.activeElement)) {
      overlay.focus({ preventScroll: true });
    }
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) {
        opener.focus({ preventScroll: true });
      }
    };
  }, [ref]);
}
