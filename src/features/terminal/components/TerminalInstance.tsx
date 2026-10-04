import { useRef } from "react";
import { useTerminalSession } from "../hooks/useTerminalSession";

interface TerminalInstanceProps {
  sessionId: string;
  isActive: boolean;
}

/**
 * Renders a single xterm.js terminal instance.
 * Hidden when not the active tab — keeps the PTY alive in the background.
 */
export function TerminalInstance({ sessionId, isActive }: TerminalInstanceProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { handleResize } = useTerminalSession({ sessionId, containerRef });

  // Trigger refit when becoming visible (container may have changed size)
  // useEffect not needed — ResizeObserver in the hook handles it

  return (
    <div
      ref={containerRef}
      className={isActive ? "absolute inset-0 overflow-hidden py-1 px-2" : "hidden"}
      onFocus={handleResize}
    />
  );
}
