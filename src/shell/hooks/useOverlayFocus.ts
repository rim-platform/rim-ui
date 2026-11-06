import { useEffect, useRef, type RefObject } from "react";

/**
 * Moves focus into the overlay `ref` points at when it mounts, unless something inside already
 * took it, and returns focus to the element that had it before the overlay opened when the
 * overlay unmounts. Focus the person moved elsewhere meanwhile stays where it is.
 *
 * @param ref - The overlay's root element, which must be focusable.
 */
export function useOverlayFocus(ref: RefObject<HTMLElement | null>): void {
  // Saved while rendering, because a child's own focus effect runs before this one.
  const openerRef = useRef<Element | null | undefined>(undefined);
  if (openerRef.current === undefined) openerRef.current = document.activeElement;

  useEffect(() => {
    const overlay = ref.current;
    if (overlay && !overlay.contains(document.activeElement)) {
      overlay.focus({ preventScroll: true });
    }
    return () => {
      const opener = openerRef.current;
      const active = document.activeElement;
      const abandoned = !active || active === document.body || overlay?.contains(active);
      if (abandoned && opener instanceof HTMLElement && opener.isConnected) {
        opener.focus({ preventScroll: true });
      }
    };
  }, [ref]);
}
