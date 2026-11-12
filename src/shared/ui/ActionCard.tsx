import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Clock, Loader2, ShieldAlert, ShieldX } from "lucide-react";
import { cn } from "./cn";

export type ActionCardState = "running" | "confirm" | "denied" | "failed" | "done" | "ended";

export interface ActionCardAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
  ariaLabel?: string;
}

interface StateLook {
  word: string;
  icon: typeof Loader2;
  iconClass: string;
  card: string;
  title: string;
  actionBorder: string;
}

const LOOKS: Record<ActionCardState, StateLook> = {
  running: {
    word: "In progress",
    icon: Loader2,
    iconClass: "text-rim-text motion-safe:animate-spin",
    card: "border-rim-card-running-line bg-rim-card-running",
    title: "text-rim-text",
    actionBorder: "border-rim-card-running-line",
  },
  confirm: {
    word: "Needs you",
    icon: ShieldAlert,
    iconClass: "text-rim-warm",
    card: "border-rim-card-confirm-line bg-rim-card-confirm",
    title: "text-rim-warm",
    actionBorder: "border-rim-card-confirm-line",
  },
  denied: {
    word: "Not done",
    icon: ShieldX,
    iconClass: "text-rim-danger",
    card: "border-rim-card-denied-line bg-rim-card-denied",
    title: "text-rim-danger",
    actionBorder: "border-rim-card-denied-line",
  },
  failed: {
    word: "Failed",
    icon: AlertTriangle,
    iconClass: "text-rim-warm",
    card: "border-rim-card-failed-line bg-rim-card-failed",
    title: "text-rim-warm",
    actionBorder: "border-rim-card-failed-line",
  },
  done: {
    word: "Done",
    icon: CheckCircle2,
    iconClass: "text-rim-success",
    card: "border-rim-card-done-line bg-rim-card-done",
    title: "text-rim-success",
    actionBorder: "border-rim-card-done-line",
  },
  ended: {
    word: "Ended",
    icon: Clock,
    iconClass: "text-rim-text-muted",
    card: "border-dashed border-rim-card-ended-line bg-rim-card-ended",
    title: "text-rim-text-muted",
    actionBorder: "border-rim-card-ended-line",
  },
};

/**
 * A card for the state of one action: its own icon, colour and words per state, so it reads
 * without colour. It has no role and no timers; the host decides those.
 */
export function ActionCard({
  state,
  title,
  detail,
  mono,
  actions,
  className,
}: {
  state: ActionCardState;
  title: ReactNode;
  detail?: ReactNode;
  /** The detail is a command or permission name, shown in the mono font. */
  mono?: boolean;
  actions?: readonly ActionCardAction[];
  className?: string;
}) {
  const look = LOOKS[state];
  const Icon = look.icon;
  return (
    <div
      data-state={state}
      className={cn("flex items-start gap-3 rounded-xl border p-3.5", look.card, className)}
    >
      <Icon aria-hidden="true" className={cn("h-5 w-5 shrink-0", look.iconClass)} />
      <div className="min-w-0 flex-1">
        <p className={cn("break-words text-sm font-medium", look.title)}>
          <span className="sr-only">{look.word}: </span>
          {title}
        </p>
        {detail !== undefined && detail !== null && detail !== false && (
          <p className={cn("mt-0.5 break-words text-xs text-rim-text-muted", mono && "font-mono")}>
            {detail}
          </p>
        )}
        {actions && actions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={action.onClick}
                aria-label={action.ariaLabel}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition",
                  action.primary && state === "confirm"
                    ? "bg-rim-signal text-rim-panel hover:bg-rim-signal/90"
                    : cn("border text-rim-text hover:bg-white/5", look.actionBorder),
                )}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
