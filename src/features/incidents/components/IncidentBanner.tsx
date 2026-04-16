import { useState, useEffect, useCallback, useRef } from "react";
import { AlertTriangle, ChevronDown, Clock, MessageSquare, X } from "lucide-react";

import { cn } from "../../../shared/ui/cn";
import { useIncidentStore } from "../state/useIncidentStore";
import { useAdvancePhase, useUpdateIncidentStatus, useResolveIncident } from "../api/useIncident";
import type { IncidentSeverity, IncidentPhaseName } from "../api/useIncident";
import { IncidentSeverityGql, IncidentPhaseNameGql, IncidentStatusGql } from "../../../core/graphql/generated/schema-types";

const SEVERITY_STYLES: Record<IncidentSeverity, { badge: string; banner: string }> = {
  [IncidentSeverityGql.SEV_1]: {
    badge: "bg-rim-danger text-white",
    banner: "bg-rim-danger/10 border-b border-rim-danger/30",
  },
  [IncidentSeverityGql.SEV_2]: {
    badge: "bg-rim-warm text-white",
    banner: "bg-rim-danger/10 border-b border-rim-danger/30",
  },
  [IncidentSeverityGql.SEV_3]: {
    badge: "bg-[#eab308] text-black",
    banner: "bg-rim-warm/10 border-b border-rim-warm/30",
  },
  [IncidentSeverityGql.SEV_4]: {
    badge: "bg-rim-accent text-white",
    banner: "bg-rim-warm/10 border-b border-rim-warm/30",
  },
};

const PHASE_LABELS: Record<IncidentPhaseName, string> = {
  [IncidentPhaseNameGql.DETECTION]: "Detection",
  [IncidentPhaseNameGql.TRIAGE]: "Triage",
  [IncidentPhaseNameGql.MITIGATION]: "Mitigation",
  [IncidentPhaseNameGql.RESOLUTION]: "Resolution",
  [IncidentPhaseNameGql.POSTMORTEM]: "Postmortem",
};

const PHASE_ORDER: IncidentPhaseName[] = [
  IncidentPhaseNameGql.DETECTION,
  IncidentPhaseNameGql.TRIAGE,
  IncidentPhaseNameGql.MITIGATION,
  IncidentPhaseNameGql.RESOLUTION,
  IncidentPhaseNameGql.POSTMORTEM,
];

function formatElapsed(startedAt: string): string {
  const diff = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  if (diff < 0) return "0s";
  const hours = Math.floor(diff / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  const seconds = diff % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

interface IncidentBannerProps {
  serverId: string;
  conversationId: string;
}

export function IncidentBanner({ serverId, conversationId }: IncidentBannerProps) {
  const incident = useIncidentStore((s) => s.activeIncident);
  const setShowTimeline = useIncidentStore((s) => s.setShowTimeline);
  const setShowPostmortem = useIncidentStore((s) => s.setShowPostmortem);
  const [elapsed, setElapsed] = useState("");
  const [phaseMenuOpen, setPhaseMenuOpen] = useState(false);
  const [noteTarget, setNoteTarget] = useState<IncidentPhaseName | null>(null);
  const [phaseNote, setPhaseNote] = useState("");
  const phaseMenuRef = useRef<HTMLDivElement>(null);
  const noteInputRef = useRef<HTMLInputElement>(null);

  const advancePhase = useAdvancePhase();
  const updateStatus = useUpdateIncidentStatus();
  const resolveIncident = useResolveIncident();

  // Auto-update elapsed time every second
  useEffect(() => {
    if (!incident) return;
    setElapsed(formatElapsed(incident.startedAt));
    const interval = setInterval(() => {
      setElapsed(formatElapsed(incident.startedAt));
    }, 1000);
    return () => clearInterval(interval);
  }, [incident]);

  // Close phase menu on outside click
  useEffect(() => {
    if (!phaseMenuOpen) return;
    function handleClick(e: MouseEvent) {
      if (phaseMenuRef.current && !phaseMenuRef.current.contains(e.target as Node)) {
        setPhaseMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [phaseMenuOpen]);

  const handlePhaseSelected = useCallback(
    (nextPhase: IncidentPhaseName) => {
      setPhaseMenuOpen(false);
      setNoteTarget(nextPhase);
      setPhaseNote("");
      // Focus the note input after render
      requestAnimationFrame(() => noteInputRef.current?.focus());
    },
    [],
  );

  const handleAdvancePhaseConfirm = useCallback(() => {
    if (!incident || !noteTarget) return;
    advancePhase.mutate({
      incidentId: incident.id,
      nextPhase: noteTarget,
      note: phaseNote.trim(),
      serverId,
      conversationId,
    });
    setNoteTarget(null);
    setPhaseNote("");
  }, [incident, noteTarget, phaseNote, advancePhase, serverId, conversationId]);

  const handleAdvancePhaseSkip = useCallback(() => {
    if (!incident || !noteTarget) return;
    advancePhase.mutate({
      incidentId: incident.id,
      nextPhase: noteTarget,
      note: "",
      serverId,
      conversationId,
    });
    setNoteTarget(null);
    setPhaseNote("");
  }, [incident, noteTarget, advancePhase, serverId, conversationId]);

  const handleMitigate = useCallback(() => {
    if (!incident) return;
    updateStatus.mutate({
      incidentId: incident.id,
      status: IncidentStatusGql.MITIGATED,
      serverId,
      conversationId,
    });
  }, [incident, updateStatus, serverId, conversationId]);

  const handleResolve = useCallback(() => {
    if (!incident) return;
    resolveIncident.mutate({
      incidentId: incident.id,
      serverId,
      conversationId,
    });
  }, [incident, resolveIncident, serverId, conversationId]);

  if (!incident) return null;

  const styles = SEVERITY_STYLES[incident.severity];
  const currentPhaseIdx = PHASE_ORDER.indexOf(incident.currentPhase);
  const nextPhases = PHASE_ORDER.slice(currentPhaseIdx + 1);

  return (
    <div className={cn("flex flex-col px-4", styles.banner)}>
      <div className="flex h-10 items-center gap-3">
        <AlertTriangle className="h-4 w-4 shrink-0 text-rim-danger" />

      <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none", styles.badge)}>
        {incident.severity}
      </span>

      <span className="truncate text-sm font-medium text-rim-text">
        {incident.title}
      </span>

      <span className="rounded bg-white/10 px-1.5 py-0.5 text-xs text-rim-text-muted">
        {PHASE_LABELS[incident.currentPhase]}
      </span>

      <span className="flex items-center gap-1 text-xs text-rim-text-faint">
        <Clock className="h-3 w-3" />
        {elapsed}
      </span>

      <div className="ml-auto flex items-center gap-1">
        {/* Timeline button */}
        <button
          type="button"
          onClick={() => setShowTimeline(true)}
          className="rounded px-2 py-1 text-xs text-rim-text-muted transition hover:bg-white/10 hover:text-rim-text"
        >
          Timeline
        </button>

        {/* Postmortem button */}
        <button
          type="button"
          onClick={() => setShowPostmortem(true)}
          className="rounded px-2 py-1 text-xs text-rim-text-muted transition hover:bg-white/10 hover:text-rim-text"
        >
          Postmortem
        </button>

        {/* Advance Phase dropdown */}
        {nextPhases.length > 0 && (
          <div className="relative" ref={phaseMenuRef}>
            <button
              type="button"
              onClick={() => setPhaseMenuOpen(!phaseMenuOpen)}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-rim-text-muted transition hover:bg-white/10 hover:text-rim-text"
            >
              Advance Phase
              <ChevronDown className="h-3 w-3" />
            </button>
            {phaseMenuOpen && (
              <div className="absolute right-0 top-full mt-1 min-w-[140px] rounded-lg border border-rim-line bg-rim-panel py-1 shadow-xl">
                {nextPhases.map((phase) => (
                  <button
                    key={phase}
                    type="button"
                    onClick={() => handlePhaseSelected(phase)}
                    className="w-full px-3 py-1.5 text-left text-xs text-rim-text transition hover:bg-white/5"
                  >
                    {PHASE_LABELS[phase]}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Mitigate button */}
        {incident.status === IncidentStatusGql.ACTIVE && (
          <button
            type="button"
            onClick={handleMitigate}
            className="rounded bg-rim-warm/20 px-2 py-1 text-xs text-rim-warm transition hover:bg-rim-warm/30"
          >
            Mitigate
          </button>
        )}

        {/* Resolve button */}
        {incident.status !== IncidentStatusGql.RESOLVED && (
          <button
            type="button"
            onClick={handleResolve}
            className="rounded bg-rim-success/20 px-2 py-1 text-xs text-rim-success transition hover:bg-rim-success/30"
          >
            Resolve
          </button>
        )}
      </div>
      </div>

      {/* Phase note input — shown when advancing to a new phase */}
      {noteTarget && (
        <div className="flex items-center gap-2 border-t border-white/10 py-2">
          <MessageSquare className="h-3.5 w-3.5 shrink-0 text-rim-text-muted" />
          <span className="text-xs text-rim-text-muted">
            Note for {PHASE_LABELS[noteTarget]}:
          </span>
          <input
            ref={noteInputRef}
            type="text"
            value={phaseNote}
            onChange={(e) => setPhaseNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdvancePhaseConfirm();
              if (e.key === "Escape") { setNoteTarget(null); setPhaseNote(""); }
            }}
            placeholder="Optional phase note..."
            className="w-48 rounded border border-rim-line bg-rim-void px-2 py-0.5 text-xs text-rim-text outline-none placeholder:text-rim-text-faint focus:border-rim-accent"
          />
          <button
            type="button"
            onClick={handleAdvancePhaseConfirm}
            className="rounded bg-rim-accent/20 px-2 py-0.5 text-xs text-rim-accent transition hover:bg-rim-accent/30"
          >
            Advance
          </button>
          <button
            type="button"
            onClick={handleAdvancePhaseSkip}
            className="rounded px-2 py-0.5 text-xs text-rim-text-muted transition hover:bg-white/10"
          >
            Skip note
          </button>
          <button
            type="button"
            onClick={() => { setNoteTarget(null); setPhaseNote(""); }}
            className="rounded p-0.5 text-rim-text-faint transition hover:text-rim-text"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}
