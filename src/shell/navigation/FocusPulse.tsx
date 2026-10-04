import { useEffect, useState } from "react";

import { useShellStore } from "../state/useShellStore";

interface PulseRect {
  top: number;
  left: number;
  height: number;
}

export function FocusPulse() {
  const focusedSurface = useShellStore((s) => s.focusedSurface);
  const [pulse, setPulse] = useState<{ rect: PulseRect; key: string } | null>(null);

  useEffect(() => {
    if (!focusedSurface) {
      setPulse(null);
      return;
    }

    // Use rAF to ensure layout is complete before measuring
    const rafId = requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-panel="${focusedSurface}"]`);
      if (!el) {
        setPulse(null);
        return;
      }

      const rect = el.getBoundingClientRect();
      setPulse({
        rect: {
          top: rect.top,
          left: rect.left,
          height: rect.height,
        },
        key: `${focusedSurface}-${Date.now()}`,
      });
    });

    return () => cancelAnimationFrame(rafId);
  }, [focusedSurface]);

  if (!pulse) return null;

  return (
    <div
      key={pulse.key}
      style={{
        position: "fixed",
        top: pulse.rect.top,
        left: pulse.rect.left,
        width: 2,
        height: pulse.rect.height,
        backgroundColor: "var(--color-rim-accent)",
        pointerEvents: "none",
        zIndex: 9999,
        animation: "focus-pulse 300ms ease-out forwards",
      }}
    />
  );
}
