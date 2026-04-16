import { useEffect, useCallback } from "react";
import { Plus, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

import { useTerminalStore, type TerminalSession } from "../state/useTerminalStore";
import { cn } from "../../../shared/ui/cn";
import { toast } from "../../../shared/toast";

const MAX_SESSIONS = 10;

/** Create a new terminal session via Tauri and add it to the store. */
async function createSession(): Promise<void> {
  const { sessions, addSession, preferredShell } = useTerminalStore.getState();

  if (sessions.length >= MAX_SESSIONS) {
    toast.warning(`Maximum ${MAX_SESSIONS} terminal sessions reached`);
    return;
  }

  try {
    // Pass user-configured shell if set, otherwise let backend auto-detect
    const shell = preferredShell.trim() || null;
    const sessionId = await invoke<string>("terminal_create", { shell });
    // Show shell name on tab (extract basename from path)
    const shellLabel = shell ? shell.split(/[/\\]/).pop() ?? "Terminal" : "Terminal";
    const session: TerminalSession = { id: sessionId, shell: shellLabel };
    addSession(session);
  } catch (err) {
    toast.error(`Failed to create terminal: ${err}`);
  }
}

/** Close a terminal session via Tauri and remove from store. */
async function closeSession(sessionId: string): Promise<void> {
  try {
    await invoke("terminal_close", { sessionId });
  } catch (err) {
    // Session not found = PTY already dead, that's expected.
    // Any other error is logged but we still remove from store to keep UI clean.
    const msg = String(err);
    if (!msg.includes("not found")) {
      console.warn(`terminal_close failed for ${sessionId}:`, err);
    }
  }
  useTerminalStore.getState().removeSession(sessionId);
}

export function TerminalTabBar() {
  const sessions = useTerminalStore((s) => s.sessions);
  const activeSessionId = useTerminalStore((s) => s.activeSessionId);
  const setActiveSession = useTerminalStore((s) => s.setActiveSession);
  const setOpen = useTerminalStore((s) => s.setOpen);

  // Tab switching shortcuts: Ctrl+Shift+] / Ctrl+Shift+[
  const handleTabSwitch = useCallback(
    (e: KeyboardEvent) => {
      if (!e.ctrlKey || !e.shiftKey) return;
      if (e.key !== "]" && e.key !== "[") return;

      e.preventDefault();
      e.stopPropagation();

      const { sessions: currentSessions, activeSessionId: currentId } =
        useTerminalStore.getState();
      if (currentSessions.length < 2 || !currentId) return;

      const idx = currentSessions.findIndex((s) => s.id === currentId);
      if (idx === -1) return;

      const next =
        e.key === "]"
          ? currentSessions[(idx + 1) % currentSessions.length]
          : currentSessions[(idx - 1 + currentSessions.length) % currentSessions.length];

      setActiveSession(next.id);
    },
    [setActiveSession],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleTabSwitch, true);
    return () => document.removeEventListener("keydown", handleTabSwitch, true);
  }, [handleTabSwitch]);

  return (
    <div className="flex h-8 shrink-0 items-center gap-px border-b border-rim-line bg-rim-void px-1" role="tablist">
      {sessions.map((session) => (
        <div
          key={session.id}
          className={cn(
            "group flex h-6 items-center gap-1 rounded px-2 text-[11px] transition-colors cursor-pointer select-none",
            session.id === activeSessionId
              ? "bg-rim-panel text-rim-text"
              : "text-rim-text-muted hover:bg-rim-panel-soft hover:text-rim-text",
          )}
          onClick={() => setActiveSession(session.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") setActiveSession(session.id);
          }}
          role="tab"
          tabIndex={0}
          aria-selected={session.id === activeSessionId}
        >
          <span className="truncate max-w-[100px]">
            {session.shell || "Terminal"}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              closeSession(session.id);
            }}
            className="ml-0.5 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-rim-danger/20 hover:text-rim-danger"
            aria-label={`Close ${session.shell}`}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={createSession}
        className="flex h-6 w-6 items-center justify-center rounded text-rim-text-faint transition-colors hover:bg-rim-panel-soft hover:text-rim-text"
        aria-label="New terminal"
        title="New terminal"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Close terminal pane */}
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="flex h-6 w-6 items-center justify-center rounded text-rim-text-faint transition-colors hover:bg-rim-panel-soft hover:text-rim-text"
        aria-label="Hide terminal"
        title="Hide terminal"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export { createSession };
