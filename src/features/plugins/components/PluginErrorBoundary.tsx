import { useState, useEffect, useRef } from "react";
import { AlertTriangle, Loader2, RefreshCw, Power } from "lucide-react";

import { Button } from "../../../shared/ui/Button";
import { cn } from "../../../shared/ui/cn";
import type { PluginHealth } from "../types";

type ErrorState = "loading" | "slow" | "crashed" | "timeout";

function healthToState(health: PluginHealth): ErrorState | null {
  switch (health) {
    case "running":
      return null;
    case "stopped":
      return null;
    case "crashed":
      return "crashed";
    case "timeout":
      return "timeout";
  }
}

interface PluginErrorBoundaryProps {
  pluginId: string;
  pluginName: string;
  health: PluginHealth;
  onRestart: () => void;
  onDisable: () => void;
  children: React.ReactNode;
}

export function PluginErrorBoundary({
  pluginId: _pluginId,
  pluginName,
  health,
  onRestart,
  onDisable,
  children,
}: PluginErrorBoundaryProps) {
  const [timerState, setTimerState] = useState<"none" | "loading" | "slow">("none");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Timer logic: 2s -> loading, 15s -> slow
  useEffect(() => {
    if (health !== "running") {
      setTimerState("none");
      return;
    }

    setTimerState("none");

    const loadingTimer = setTimeout(() => {
      if (mountedRef.current) setTimerState("loading");
    }, 2000);

    const slowTimer = setTimeout(() => {
      if (mountedRef.current) setTimerState("slow");
    }, 15000);

    return () => {
      clearTimeout(loadingTimer);
      clearTimeout(slowTimer);
    };
  }, [health]);

  const errorState = healthToState(health);
  const displayState = errorState ?? (timerState !== "none" ? timerState : null);

  if (!displayState) {
    return <>{children}</>;
  }

  if (displayState === "loading") {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-rim-panel p-3">
        <Loader2 className="h-4 w-4 animate-spin text-rim-accent" />
        <span className="text-xs text-rim-text-muted">Loading {pluginName}...</span>
      </div>
    );
  }

  if (displayState === "slow") {
    return (
      <div className="rounded-lg border border-rim-warm/30 bg-rim-warm/5 p-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-rim-warm" />
          <span className="text-xs text-rim-warm">{pluginName} is taking longer than expected</span>
        </div>
        <div className="mt-2 flex gap-2">
          <Button variant="secondary" size="sm" onClick={onDisable}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  const isCrashed = displayState === "crashed";

  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        isCrashed ? "border-rim-danger/30 bg-rim-danger/5" : "border-rim-warm/30 bg-rim-warm/5",
      )}
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className={cn("h-4 w-4", isCrashed ? "text-rim-danger" : "text-rim-warm")} />
        <span className={cn("text-xs", isCrashed ? "text-rim-danger" : "text-rim-warm")}>
          {isCrashed ? `${pluginName} crashed` : `${pluginName} timed out`}
        </span>
      </div>
      <div className="mt-2 flex gap-2">
        <Button variant="secondary" size="sm" onClick={onRestart}>
          <RefreshCw className="mr-1 h-3 w-3" />
          Restart
        </Button>
        <Button variant="ghost" size="sm" onClick={onDisable}>
          <Power className="mr-1 h-3 w-3" />
          Disable
        </Button>
      </div>
    </div>
  );
}
