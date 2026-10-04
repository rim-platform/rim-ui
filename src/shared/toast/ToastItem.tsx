import { useEffect, useRef, useState, useCallback } from "react";
import { Check, AlertCircle, AlertTriangle, Info, X } from "lucide-react";
import { cn } from "../ui/cn";
import { type Toast, type ToastVariant, useToastStore } from "./useToastStore";

const ICON_MAP: Record<ToastVariant, typeof Check> = {
  success: Check,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const VARIANT_STYLES: Record<ToastVariant, { icon: string; border: string; action: string }> = {
  success: {
    icon: "text-rim-success",
    border: "border-l-2 border-l-rim-success",
    action: "text-rim-success hover:text-rim-success",
  },
  error: {
    icon: "text-rim-danger",
    border: "border-l-2 border-l-rim-danger",
    action: "text-rim-danger hover:text-rim-danger",
  },
  warning: {
    icon: "text-rim-warm",
    border: "border-l-2 border-l-rim-warm",
    action: "text-rim-warm hover:text-rim-warm",
  },
  info: {
    icon: "text-rim-accent",
    border: "border-l-2 border-l-rim-accent",
    action: "text-rim-accent hover:text-rim-accent-strong",
  },
};

const EXIT_DURATION = 150;

interface ToastItemProps {
  toast: Toast;
}

export function ToastItem({ toast: t }: ToastItemProps) {
  const dismiss = useToastStore((s) => s.dismiss);
  const remove = useToastStore((s) => s.remove);

  const [exiting, setExiting] = useState(false);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remainingRef = useRef(t.duration ?? 0);
  const startRef = useRef(Date.now());

  const style = VARIANT_STYLES[t.variant];
  const Icon = ICON_MAP[t.variant];

  // Handle exit animation → remove
  const startExit = useCallback(() => {
    setExiting(true);
    setTimeout(() => remove(t.id), EXIT_DURATION);
  }, [remove, t.id]);

  // When store marks toast as dismissing, trigger exit
  useEffect(() => {
    if (t.dismissing) {
      startExit();
    }
  }, [t.dismissing, startExit]);

  // Auto-dismiss timer
  useEffect(() => {
    if (t.persistent || !t.duration || paused || t.dismissing) {
      return;
    }

    startRef.current = Date.now();
    timerRef.current = setTimeout(() => {
      dismiss(t.id);
    }, remainingRef.current);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        // Save remaining time
        const elapsed = Date.now() - startRef.current;
        remainingRef.current = Math.max(0, remainingRef.current - elapsed);
      }
    };
  }, [t.persistent, t.duration, t.dismissing, t.id, paused, dismiss]);

  // Initialize remaining time on mount
  useEffect(() => {
    if (t.duration) {
      remainingRef.current = t.duration;
    }
  }, [t.duration]);

  const handleAction = () => {
    t.action?.onClick();
    dismiss(t.id);
  };

  return (
    <div
      role={t.variant === "error" ? "alert" : "status"}
      aria-live={t.variant === "error" ? "assertive" : "polite"}
      className={cn(
        "relative w-80 overflow-hidden rounded-lg border border-rim-line bg-rim-panel p-3 shadow-lg shadow-black/30",
        style.border,
        exiting
          ? "animate-[toast-out_150ms_ease-in_forwards]"
          : "animate-[toast-in_200ms_ease-out]",
      )}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", style.icon)} />

        {/* Text area */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-rim-text">{t.title}</p>
          {t.description && (
            <p className="mt-0.5 line-clamp-2 text-xs text-rim-text-muted">{t.description}</p>
          )}
          {t.action && (
            <button
              type="button"
              className={cn("mt-1.5 text-xs font-medium transition hover:underline", style.action)}
              onClick={handleAction}
              aria-label={t.action.ariaLabel ?? t.action.label}
            >
              {t.action.label}
            </button>
          )}
        </div>

        {/* Close button */}
        <button
          type="button"
          className="shrink-0 rounded p-0.5 text-rim-text-faint transition hover:text-rim-text"
          onClick={() => dismiss(t.id)}
          aria-label="Dismiss notification"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Progress bar */}
      {!t.persistent && t.duration && (
        <div
          className="absolute bottom-0 left-0 h-0.5 rounded-b-lg bg-rim-text-faint/30"
          style={{
            animation: paused ? "none" : `toast-progress ${t.duration}ms linear forwards`,
            animationPlayState: paused ? "paused" : "running",
          }}
        />
      )}
    </div>
  );
}
