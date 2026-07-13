import { create } from "zustand";

import type { IncidentSeverity, IncidentStatus, IncidentPhaseName } from "../api/useIncident";
import type { EscalationRunStatusGql } from "../../../core/graphql/generated/schema-types";

interface AcknowledgedByUser {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

interface EscalationRunState {
  currentStepIndex: number;
  nextFireAt: string | null;
  status: EscalationRunStatusGql;
}

interface ActiveIncidentState {
  id: string;
  title: string;
  status: IncidentStatus;
  severity: IncidentSeverity;
  currentPhase: IncidentPhaseName;
  startedAt: string;
  /** `null` until acked — set by `acknowledgeIncident` (Track C1c). */
  acknowledgedAt: string | null;
  acknowledgedByUser: AcknowledgedByUser | null;
  /** `null` when no escalation policy is attached, or the run has completed/been cancelled. */
  escalationRun: EscalationRunState | null;
}

interface IncidentStoreState {
  activeIncident: ActiveIncidentState | null;
  showStartDialog: boolean;
  showTimeline: boolean;
  showPostmortem: boolean;

  setActiveIncident: (incident: ActiveIncidentState | null) => void;
  setShowStartDialog: (show: boolean) => void;
  setShowTimeline: (show: boolean) => void;
  setShowPostmortem: (show: boolean) => void;
}

export const useIncidentStore = create<IncidentStoreState>((set) => ({
  activeIncident: null,
  showStartDialog: false,
  showTimeline: false,
  showPostmortem: false,

  setActiveIncident: (incident) => set({ activeIncident: incident }),
  setShowStartDialog: (show) => set({ showStartDialog: show }),
  setShowTimeline: (show) => set({ showTimeline: show }),
  setShowPostmortem: (show) => set({ showPostmortem: show }),
}));
