import { useState, useCallback } from "react";

import { Dialog } from "../../../shared/ui/Dialog";
import { useIncidentStore } from "../state/useIncidentStore";
import { useStartIncident } from "../api/useIncident";
import { toast } from "../../../shared/toast";
import { cn } from "../../../shared/ui/cn";
import type { IncidentSeverity } from "../api/useIncident";
import { IncidentSeverityGql } from "../../../core/graphql/generated/schema-types";

const SEVERITY_OPTIONS: { value: IncidentSeverity; label: string; color: string }[] = [
  { value: IncidentSeverityGql.SEV_1, label: "SEV1 - Critical", color: "bg-rim-danger" },
  { value: IncidentSeverityGql.SEV_2, label: "SEV2 - Major", color: "bg-rim-warm" },
  { value: IncidentSeverityGql.SEV_3, label: "SEV3 - Minor", color: "bg-[#eab308]" },
  { value: IncidentSeverityGql.SEV_4, label: "SEV4 - Low", color: "bg-rim-accent" },
];

interface StartIncidentDialogProps {
  serverId: string;
  conversationId: string;
}

export function StartIncidentDialog({ serverId, conversationId }: StartIncidentDialogProps) {
  const open = useIncidentStore((s) => s.showStartDialog);
  const setOpen = useIncidentStore((s) => s.setShowStartDialog);
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState<IncidentSeverity>(IncidentSeverityGql.SEV_2);
  const startIncident = useStartIncident();

  const handleClose = useCallback(() => {
    setOpen(false);
    setTitle("");
    setSeverity(IncidentSeverityGql.SEV_2);
  }, [setOpen]);

  const handleStart = useCallback(() => {
    if (!title.trim()) return;
    startIncident.mutate(
      { serverId, conversationId, title: title.trim(), severity },
      {
        onSuccess: () => {
          toast.success("Incident started");
          handleClose();
        },
        onError: () => {
          toast.error("Failed to start incident");
        },
      },
    );
  }, [title, severity, serverId, conversationId, startIncident, handleClose]);

  return (
    <Dialog open={open} onClose={handleClose} title="Start Incident">
      <div className="space-y-4">
        <div>
          <label htmlFor="incident-title" className="mb-1 block text-xs text-rim-text-muted">
            Title
          </label>
          <input
            id="incident-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleStart();
            }}
            placeholder="Brief description of the incident..."
            className="w-full rounded-lg border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none placeholder:text-rim-text-faint focus:border-rim-accent"
            autoFocus
          />
        </div>

        <div>
          <label className="mb-1 block text-xs text-rim-text-muted">Severity</label>
          <div className="flex gap-2">
            {SEVERITY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setSeverity(opt.value)}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition",
                  severity === opt.value
                    ? "border-rim-accent bg-rim-accent/10 text-rim-text"
                    : "border-rim-line bg-rim-void text-rim-text-muted hover:border-rim-text-faint",
                )}
              >
                <span className={cn("h-2 w-2 rounded-full", opt.color)} />
                {opt.value}
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={handleClose}
            className="rounded px-3 py-1.5 text-sm text-rim-text-muted transition hover:text-rim-text"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleStart}
            disabled={!title.trim() || startIncident.isPending}
            className={cn(
              "rounded bg-rim-danger px-3 py-1.5 text-sm text-white transition",
              !title.trim() || startIncident.isPending
                ? "opacity-50 cursor-not-allowed"
                : "hover:brightness-110",
            )}
          >
            {startIncident.isPending ? "Starting..." : "Start Incident"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
