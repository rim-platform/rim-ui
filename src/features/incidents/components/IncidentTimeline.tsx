import { useCallback } from "react";
import { Clock, X } from "lucide-react";

import { cn } from "../../../shared/ui/cn";
import { useIncidentTimeline } from "../api/useIncident";
import { useIncidentStore } from "../state/useIncidentStore";
import type {
  IncidentPhaseName,
  MessageTagType,
  IncidentPhase,
  IncidentMessageTag,
} from "../api/useIncident";
import {
  IncidentPhaseNameGql,
  MessageTagTypeGql,
} from "../../../core/graphql/generated/schema-types";

const PHASE_LABELS: Record<IncidentPhaseName, string> = {
  [IncidentPhaseNameGql.DETECTION]: "Detection",
  [IncidentPhaseNameGql.TRIAGE]: "Triage",
  [IncidentPhaseNameGql.MITIGATION]: "Mitigation",
  [IncidentPhaseNameGql.RESOLUTION]: "Resolution",
  [IncidentPhaseNameGql.POSTMORTEM]: "Postmortem",
};

const TAG_TYPE_STYLES: Record<MessageTagType, { dot: string; badge: string; label: string }> = {
  [MessageTagTypeGql.DECISION]: {
    dot: "bg-[#a855f7]",
    badge: "bg-[#a855f7]/15 text-[#a855f7]",
    label: "Decision",
  },
  [MessageTagTypeGql.ACTION_ITEM]: {
    dot: "bg-rim-accent",
    badge: "bg-rim-accent/15 text-rim-accent",
    label: "Action Item",
  },
  [MessageTagTypeGql.ROOT_CAUSE]: {
    dot: "bg-rim-danger",
    badge: "bg-rim-danger/15 text-rim-danger",
    label: "Root Cause",
  },
  [MessageTagTypeGql.TIMELINE_EVENT]: {
    dot: "bg-rim-text-faint",
    badge: "bg-rim-text-faint/15 text-rim-text-faint",
    label: "Timeline Event",
  },
};

function formatDuration(start: string, end: string | null): string {
  const endTime = end ? new Date(end).getTime() : Date.now();
  const diff = Math.floor((endTime - new Date(start).getTime()) / 1000);
  if (diff < 0) return "0s";
  const hours = Math.floor(diff / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function PhaseSection({
  phase,
  taggedMessages,
}: {
  phase: IncidentPhase;
  taggedMessages: IncidentMessageTag[];
}) {
  const phaseTags = taggedMessages.filter((t) => t.phase === phase.phase);

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 border-b border-rim-line pb-2">
        <span className="text-sm font-medium text-rim-text">{PHASE_LABELS[phase.phase]}</span>
        <span className="text-xs text-rim-text-faint">
          {formatDuration(phase.startedAt, phase.endedAt ?? null)}
        </span>
        {phase.endedAt && (
          <span className="rounded bg-rim-success/15 px-1.5 py-0.5 text-[10px] text-rim-success">
            completed
          </span>
        )}
      </div>
      {phase.note && <p className="mt-1 text-xs text-rim-text-muted">{phase.note}</p>}
      {phaseTags.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {phaseTags.map((tag) => {
            if (!tag.tagType) return null;
            const style = TAG_TYPE_STYLES[tag.tagType];
            return (
              <div
                key={`${tag.messageId}-${tag.tagType}`}
                className="flex items-center gap-2 rounded border border-rim-line bg-rim-void px-2.5 py-1.5"
              >
                <span
                  className={cn(
                    "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
                    style.badge,
                  )}
                >
                  {style.label}
                </span>
                <span className="truncate text-xs text-rim-text-muted">
                  msg:{tag.messageId.slice(0, 8)}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {phaseTags.length === 0 && (
        <p className="mt-2 text-xs text-rim-text-faint">No tagged messages in this phase.</p>
      )}
    </div>
  );
}

interface IncidentTimelinePanelProps {
  onClose: () => void;
}

export function IncidentTimelinePanel({ onClose }: IncidentTimelinePanelProps) {
  const incident = useIncidentStore((s) => s.activeIncident);
  const { data: timeline, isPending, isError } = useIncidentTimeline(incident?.id ?? null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  return (
    <div
      className="flex h-full flex-col border-l border-rim-line bg-rim-panel"
      onKeyDown={handleKeyDown}
    >
      <div className="flex items-center justify-between border-b border-rim-line px-4 py-2">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-rim-accent" />
          <h3 className="text-sm font-medium text-rim-text">Incident Timeline</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close timeline"
          className="rounded p-1 text-rim-text-muted transition hover:text-rim-text"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {isPending && <p className="text-sm text-rim-text-muted">Loading timeline...</p>}
        {isError && <p className="text-sm text-rim-danger">Failed to load timeline.</p>}
        {!isPending && !isError && timeline && (
          <>
            <div className="mb-4 rounded-lg border border-rim-line bg-rim-void p-3">
              <p className="text-sm font-medium text-rim-text">{timeline.incident.title}</p>
              <p className="mt-1 text-xs text-rim-text-faint">
                Started {new Date(timeline.incident.startedAt).toLocaleString()}
              </p>
            </div>
            {timeline.phases.map((phase) => (
              <PhaseSection key={phase.id} phase={phase} taggedMessages={timeline.taggedMessages} />
            ))}
            {timeline.phases.length === 0 && (
              <p className="text-sm text-rim-text-muted">No phases recorded yet.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
