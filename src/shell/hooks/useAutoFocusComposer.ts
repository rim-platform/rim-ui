import { useEffect, useRef } from "react";
import { useShellStore } from "../state/useShellStore";

/**
 * Auto-focus composer when entering a conversation view (returning from
 * settings, plugin, marketplace, or on initial load).  This ensures every
 * conversation entry starts in COMPOSE mode with the composer focused.
 */
export function useAutoFocusComposer(mainSurfaceKind: string) {
  const prevSurfaceKindRef = useRef<string | null>(null);

  useEffect(() => {
    const prev = prevSurfaceKindRef.current;
    prevSurfaceKindRef.current = mainSurfaceKind;
    if (mainSurfaceKind !== "conversation") return;
    // Fire on initial mount (prev === null) or when transitioning from
    // a non-conversation surface back to conversation.
    if (prev === null || prev !== "conversation") {
      useShellStore.getState().setNavigationMode(false);
      requestAnimationFrame(() => {
        const composer = document.querySelector<HTMLTextAreaElement>("[data-composer-input]");
        if (composer) composer.focus();
      });
    }
  }, [mainSurfaceKind]);
}
