import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { Bot } from "lucide-react";

import { cn } from "../../../../shared/ui/cn";
import { HoverTooltip } from "../../../../shared/ui/HoverTooltip";
import { closeOnEscape } from "../../../../shell/hooks/overlayEscape";
import { useOverlayFocus } from "../../../../shell/hooks/useOverlayFocus";
import { agentAvailable } from "../../../agent/agentAvailability";
import { useAgentProgramsStore } from "../../state/useAgentProgramsStore";
import { AgentSessionList } from "./AgentSessionList";
import { useAgentSessionRows, type AgentSessionRows } from "./useAgentSessionRows";

/**
 * The button's accessible name: how many sessions wait for the person, else how many work.
 *
 * @param sessions - The sessions' counts.
 */
function agentSessionsButtonLabel({
  waiting,
  working,
}: Pick<AgentSessionRows, "waiting" | "working">): string {
  if (waiting > 0) return `Agent sessions, ${waiting} ${waiting === 1 ? "needs" : "need"} you`;
  if (working > 0) return `Agent sessions, ${working} working`;
  return "Agent sessions";
}

/**
 * The top bar's Agent sessions button, in the desktop app once an agent program is added: the
 * number of sessions waiting for the person, or a dot while one works, and a menu of the
 * sessions under the bar. The bar must be positioned.
 */
export function AgentSessionsButton() {
  const hasPrograms = useAgentProgramsStore((s) => s.profiles.length > 0);
  if (!agentAvailable() || !hasPrograms) return null;
  return <SessionsButton />;
}

function SessionsButton() {
  const sessions = useAgentSessionRows();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const { waiting, working } = sessions;

  return (
    <>
      <HoverTooltip
        content={<span className="text-xs text-rim-text whitespace-nowrap">Agent sessions</span>}
      >
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setOpen((shown) => !shown)}
          aria-label={agentSessionsButtonLabel(sessions)}
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          className={cn(
            "relative flex h-8 w-8 items-center justify-center rounded-lg transition",
            open
              ? "bg-rim-accent/15 text-rim-accent"
              : "text-rim-text-muted hover:bg-white/5 hover:text-rim-text",
          )}
        >
          <Bot aria-hidden className="h-4 w-4" />
          {waiting > 0 ? (
            <span
              aria-hidden
              data-testid="agent-sessions-count"
              className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rim-warm px-1 text-[10px] font-bold leading-none text-rim-void"
            >
              {waiting > 99 ? "99+" : waiting}
            </span>
          ) : (
            working > 0 && (
              <span
                aria-hidden
                data-testid="agent-sessions-working"
                className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-rim-accent"
              />
            )
          )}
        </button>
      </HoverTooltip>
      {open && (
        <SessionsPopover
          id={panelId}
          sessions={sessions}
          buttonRef={buttonRef}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/**
 * The sessions under the top bar's right edge. Focus moves in when it opens and back when it
 * closes; Escape, a press outside it and any of its buttons close it.
 */
function SessionsPopover({
  id,
  sessions,
  buttonRef,
  onClose,
}: {
  id: string;
  sessions: AgentSessionRows;
  buttonRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useOverlayFocus(ref);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (ref.current?.contains(target) || buttonRef.current?.contains(target)) return;
      onCloseRef.current();
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [buttonRef]);

  return (
    <div
      ref={ref}
      id={id}
      role="region"
      aria-label="Agent sessions"
      tabIndex={-1}
      onKeyDown={(event) => closeOnEscape(event, onClose)}
      className="absolute right-2 top-full z-40 mt-1 max-h-[min(70vh,560px)] w-[min(22rem,calc(100vw-1rem))] overflow-y-auto rounded-xl border border-rim-line bg-rim-panel p-3 shadow-xl outline-none"
    >
      <p className="mb-2 text-[11px] font-medium text-rim-text-faint">Agent sessions</p>
      <AgentSessionList rows={sessions.rows} onDone={onClose} />
    </div>
  );
}
