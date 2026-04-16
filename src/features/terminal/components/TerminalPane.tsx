import { useCallback, useRef, useEffect } from "react";

// xterm.js CSS — MUST be imported for proper rendering (character grid, cursor, scrollbar).
// This component is lazy-loaded, so the CSS only loads when the terminal is first opened.
import "@xterm/xterm/css/xterm.css";

import { useTerminalStore, MIN_HEIGHT, MAX_HEIGHT_RATIO } from "../state/useTerminalStore";
import { TerminalTabBar, createSession } from "./TerminalTabBar";
import { TerminalInstance } from "./TerminalInstance";
import { useShellStore } from "../../../shell/state/useShellStore";

/**
 * Bottom terminal pane with draggable resize handle, tab bar, and terminal instances.
 * Follows the VS Code / JetBrains bottom terminal pattern.
 */
export function TerminalPane() {
  const isOpen = useTerminalStore((s) => s.isOpen);
  const sessions = useTerminalStore((s) => s.sessions);
  const activeSessionId = useTerminalStore((s) => s.activeSessionId);
  const panelHeight = useTerminalStore((s) => s.panelHeight);
  const setPanelHeight = useTerminalStore((s) => s.setPanelHeight);

  const paneRef = useRef<HTMLDivElement | null>(null);
  const dragStartY = useRef<number>(0);
  const dragStartHeight = useRef<number>(0);
  const creatingSessionRef = useRef(false);

  // Auto-create first session when pane opens with no sessions
  useEffect(() => {
    if (isOpen && sessions.length === 0 && !creatingSessionRef.current) {
      creatingSessionRef.current = true;
      createSession().finally(() => {
        creatingSessionRef.current = false;
      });
    }
  }, [isOpen, sessions.length]);

  /** Compute clamped height live — always uses current window.innerHeight. */
  const getClampedHeight = useCallback(
    () => Math.min(panelHeight, Math.floor(window.innerHeight * MAX_HEIGHT_RATIO)),
    [panelHeight],
  );

  // Drag resize — reads window.innerHeight live inside mousemove, not via stale closure
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragStartY.current = e.clientY;
      dragStartHeight.current = getClampedHeight();

      const handleMouseMove = (ev: MouseEvent) => {
        const delta = dragStartY.current - ev.clientY;
        const maxHeight = Math.floor(window.innerHeight * MAX_HEIGHT_RATIO);
        const newHeight = Math.min(Math.max(MIN_HEIGHT, dragStartHeight.current + delta), maxHeight);
        setPanelHeight(newHeight);
      };

      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    },
    [getClampedHeight, setPanelHeight],
  );

  if (!isOpen) return null;

  return (
    <div
      ref={paneRef}
      data-panel="terminal"
      onFocus={() => useShellStore.getState().setFocusedSurface("terminal")}
      className="flex shrink-0 flex-col border-t border-rim-line bg-rim-void"
      style={{ height: getClampedHeight() }}
    >
      {/* Resize handle */}
      <div
        onMouseDown={handleMouseDown}
        className="h-1 w-full cursor-row-resize bg-rim-line transition-colors hover:bg-rim-accent/30"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize terminal"
      />

      <TerminalTabBar />

      {/* Terminal instances */}
      <div className="relative min-h-0 flex-1 bg-rim-void">
        {sessions.map((session) => (
          <TerminalInstance
            key={session.id}
            sessionId={session.id}
            isActive={session.id === activeSessionId}
          />
        ))}

        {sessions.length === 0 && (
          <div className="flex h-full items-center justify-center text-xs text-rim-text-faint">
            No terminal sessions
          </div>
        )}
      </div>
    </div>
  );
}
