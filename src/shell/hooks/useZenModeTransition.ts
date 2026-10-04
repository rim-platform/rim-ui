import { useState, useEffect, useCallback } from "react";

/**
 * Two-phase zen mode: fade out via CSS, then unmount content to stop
 * subscriptions and rendering in hidden panels.
 */
export function useZenModeTransition(zenMode: boolean) {
  const [zenContentHidden, setZenContentHidden] = useState(zenMode);

  useEffect(() => {
    if (!zenMode) {
      // Exiting zen: immediately mount content so it fades in
      setZenContentHidden(false);
    }
  }, [zenMode]);

  const handleZenTransitionEnd = useCallback(
    (e: React.TransitionEvent) => {
      // Only react to opacity transitions on zen-hidden wrappers
      if (e.propertyName !== "opacity") return;
      if (zenMode) {
        setZenContentHidden(true);
      }
    },
    [zenMode],
  );

  return { zenContentHidden, handleZenTransitionEnd };
}
